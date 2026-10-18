"""OpenRouter model catalog — fetched live, cached in memory.

Kept out of the route module so both the /api/models endpoint and the
run-time compatibility checks (engine/compat.py) share one cache.
"""
import time

import httpx

from app.core.config import settings

CACHE_TTL_SECONDS = 300
_cache = {"fetched_at": 0.0, "models": []}


async def get_catalog() -> list[dict]:
    """Return the chat-capable part of the OpenRouter catalog (cached)."""
    now = time.time()
    if _cache["models"] and now - _cache["fetched_at"] < CACHE_TTL_SECONDS:
        return _cache["models"]

    headers = {}
    if settings.openrouter_api_key:
        headers["Authorization"] = "Bearer " + settings.openrouter_api_key
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get("https://openrouter.ai/api/v1/models", headers=headers)

    if resp.status_code != 200:
        raise RuntimeError("OpenRouter model catalog failed: HTTP %d" % resp.status_code)

    models = []
    for m in resp.json().get("data", []):
        architecture = m.get("architecture") or {}
        output = architecture.get("output_modalities") or ["text"]
        if "text" not in output:
            continue  # skip image/audio generators — this app compares text answers
        models.append({
            "id": m.get("id"),
            "name": m.get("name"),
            "context_length": m.get("context_length"),
            "pricing": m.get("pricing"),
            "supported_parameters": m.get("supported_parameters") or [],
        })

    models.sort(key=lambda m: (m["name"] or "").lower())
    _cache["models"] = models
    _cache["fetched_at"] = now
    return models