"""Fetches, caches and merges the model catalog; every model goes through one normalization pass."""
import asyncio
import time

import httpx

from app.core.config import settings
from app.providers.registry import is_configured

CACHE_TTL_SECONDS = 300
FAIL_TTL_SECONDS = 60  # a failed fetch is retried at most once a minute
FETCH_TIMEOUT_SECONDS = 10.0
_cache: dict[str, tuple[float, list[dict]]] = {}  # slug -> (fetched_at, models)
_failures: dict[str, tuple[float, str]] = {}  # slug -> (failed_at, error)
_anthropic_max_tokens: dict[str, int] = {}  # bare model id -> max_tokens ceiling

# OpenAI's /v1/models lists everything; skip audio, image, embedding and legacy models
_OPENAI_SKIP = (
    "whisper", "tts", "dall-e", "davinci", "babbage", "curie", "ada",
    "embedding", "moderation", "audio", "speech", "transcribe", "realtime",
    "image", "search-api", "gpt-3.5-turbo-instruct",
)

# params we can drive on OpenAI chat models; structured outputs ship native
_OPENAI_PARAMS = ["temperature", "top_p", "max_tokens", "structured_outputs"]


def _entry(provider, model_id, name, context_length, pricing, supported):
    return {
        "id": "%s::%s" % (provider, model_id),
        "provider": provider,
        "name": name,
        "context_length": context_length,
        "pricing": pricing,
        "supported_parameters": supported,
    }


async def _fetch_openrouter(client: httpx.AsyncClient) -> list[dict]:
    headers = {"Authorization": "Bearer " + settings.openrouter_api_key}
    resp = await client.get("https://openrouter.ai/api/v1/models", headers=headers)
    if resp.status_code != 200:
        raise RuntimeError("OpenRouter catalog HTTP %d" % resp.status_code)

    entries = []
    for m in resp.json().get("data", []):
        arch = m.get("architecture") or {}
        modalities = arch.get("output_modalities") or ["text"]
        if "text" not in modalities:
            continue  # image/audio generators have no place in a text comparison
        entries.append(
            _entry(
                "openrouter",
                m.get("id"),
                m.get("name"),
                m.get("context_length"),
                m.get("pricing"),
                m.get("supported_parameters") or [],
            )
        )
    return entries


async def _fetch_openai(client: httpx.AsyncClient) -> list[dict]:
    resp = await client.get(
        "https://api.openai.com/v1/models",
        headers={"Authorization": "Bearer " + settings.openai_api_key},
    )
    if resp.status_code != 200:
        raise RuntimeError("OpenAI catalog HTTP %d" % resp.status_code)

    entries = []
    for m in resp.json().get("data", []):
        model_id = m.get("id") or ""
        if any(model_id.startswith(skip) or skip in model_id for skip in _OPENAI_SKIP):
            continue
        entries.append(
            _entry("openai", model_id, model_id, None, None, _OPENAI_PARAMS)
        )
    return entries


async def _fetch_anthropic(client: httpx.AsyncClient) -> list[dict]:
    # Anthropic's listing is paginated: fetch until has_more is false
    entries = []
    after_id = None
    while True:
        url = "https://api.anthropic.com/v1/models?limit=1000"
        if after_id:
            url += "&after_id=" + after_id
        resp = await client.get(
            url,
            headers={
                "x-api-key": settings.anthropic_api_key,
                "anthropic-version": "2023-06-01",
            },
        )
        if resp.status_code != 200:
            raise RuntimeError("Anthropic catalog HTTP %d" % resp.status_code)
        data = resp.json()
        for m in data.get("data", []):
            if m.get("max_tokens"):
                _anthropic_max_tokens[m.get("id")] = m["max_tokens"]
            entries.append(
                _entry(
                    "anthropic",
                    m.get("id"),
                    m.get("display_name") or m.get("id"),
                    None,
                    None,
                    _OPENAI_PARAMS,  # the judge path enforces JSON via the prompt
                )
            )
        if not data.get("has_more"):
            break
        last = data.get("data")[-1]
        after_id = (last or {}).get("id")
    return entries


def anthropic_max_tokens(model_id: str) -> int | None:
    """The max_tokens ceiling Anthropic lists for a bare model id, if known."""
    return _anthropic_max_tokens.get(model_id)


async def _fetch_openai_compatible(client: httpx.AsyncClient) -> list[dict]:
    base = settings.openai_compatible_base_url.rstrip("/")
    headers = {}
    if settings.openai_compatible_api_key:
        headers["Authorization"] = "Bearer " + settings.openai_compatible_api_key
    resp = await client.get(base + "/models", headers=headers)
    if resp.status_code != 200:
        raise RuntimeError("OpenAI-compatible catalog HTTP %d" % resp.status_code)

    entries = []
    for m in resp.json().get("data", []):
        model_id = m.get("id") or ""
        if not model_id:
            continue
        # local servers rarely support the structured-output flag; don't claim it
        entries.append(
            _entry(
                "openai-compatible",
                model_id,
                model_id,
                None,
                None,
                ["temperature", "top_p", "max_tokens"],
            )
        )
    return entries


_FETCHERS = {
    "openrouter": _fetch_openrouter,
    "openai": _fetch_openai,
    "anthropic": _fetch_anthropic,
    "openai-compatible": _fetch_openai_compatible,
}


def _error_text(exc: Exception) -> str:
    """One short, human-readable reason for a failed catalog fetch."""
    if isinstance(exc, httpx.TimeoutException):
        return "connection timeout"
    if isinstance(exc, httpx.HTTPError):
        return "connection error"
    msg = str(exc) or exc.__class__.__name__
    if "HTTP 401" in msg:
        return "key rejected (401)"
    if "HTTP 403" in msg:
        return "forbidden (403)"
    return msg.lower()


async def get_catalog_report() -> tuple[list[dict], dict[str, dict]]:
    """Merged catalog plus a per-provider fetch status; a provider that fails is skipped, not fatal."""
    async def load(slug: str) -> tuple[str, str, list[dict], str | None]:
        cached = _cache.get(slug)
        if cached and time.time() - cached[0] < CACHE_TTL_SECONDS:
            return slug, "ok", cached[1], None
        failed = _failures.get(slug)
        if failed and time.time() - failed[0] < FAIL_TTL_SECONDS:
            return slug, "failed", [], failed[1]
        try:
            async with httpx.AsyncClient(timeout=FETCH_TIMEOUT_SECONDS) as client:
                models = await _FETCHERS[slug](client)
            _cache[slug] = (time.time(), models)
            _failures.pop(slug, None)
            return slug, "ok", models, None
        except (RuntimeError, httpx.HTTPError) as exc:
            error = _error_text(exc)
            _failures[slug] = (time.time(), error)
            return slug, "failed", [], error

    configured = [slug for slug in _FETCHERS if is_configured(slug)]
    results = await asyncio.gather(*(load(slug) for slug in configured))

    status: dict[str, dict] = {
        slug: {"state": "unconfigured", "model_count": 0, "error": None}
        for slug in _FETCHERS
        if not is_configured(slug)
    }
    merged: list[dict] = []
    for slug, state, models, error in results:
        status[slug] = {"state": state, "model_count": len(models), "error": error}
        if state == "ok":
            merged.extend(models)
    return merged, status


async def get_catalog() -> list[dict]:
    """Merged catalog across every configured provider (models only)."""
    models, _ = await get_catalog_report()
    return models
