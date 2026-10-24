"""Why give Anthropic its own adapter when OpenRouter also serves Claude models? Because the wire format differs.

A few things differ from the OpenAI dialect:
- system prompts travel as a top-level ``system`` field, not a message;
- max_tokens is mandatory, so we fall back to a sane default when the
  caller leaves it unset;
- the streaming SSE shape is event-based (message_start / content_block_delta /
  message_delta / message_stop) instead of the data-only OpenAI chunks.
"""
import json
import time

import httpx

from app.catalog import anthropic_max_tokens
from app.core.config import settings
from app.providers.base import Completion, ProviderAdapter, SharedParams, StreamEvent

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"

# Anthropic hard-requires max_tokens; used when the run leaves it unset and
# the catalog has no ceiling for the model
FALLBACK_MAX_TOKENS = 8192
JUDGE_MAX_TOKENS = 4096


class AnthropicAdapter(ProviderAdapter):
    """Streams one completion via POST /v1/messages."""

    provider_name = "Anthropic"

    def _headers(self) -> dict:
        return {
            "x-api-key": settings.anthropic_api_key,
            "anthropic-version": API_VERSION,
        }

    def _body(self, model_id, prompt, system_prompt, params, default_max_tokens) -> dict:
        body = {
            "model": model_id,
            "max_tokens": params.max_tokens if params.max_tokens is not None else default_max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system_prompt:
            body["system"] = system_prompt
        if params.temperature is not None:
            body["temperature"] = params.temperature
        if params.top_p is not None:
            body["top_p"] = params.top_p
        return body

    async def stream_completion(self, model_id, prompt, system_prompt, params):
        default_max_tokens = anthropic_max_tokens(model_id) or FALLBACK_MAX_TOKENS
        body = self._body(model_id, prompt, system_prompt, params, default_max_tokens)
        body["stream"] = True

        started = time.perf_counter()
        try:
            timeout = httpx.Timeout(300.0, connect=15.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST", API_URL, json=body, headers=self._headers()
                ) as resp:
                    if resp.status_code != 200:
                        raw = (await resp.aread()).decode("utf-8", "replace")
                        yield StreamEvent(
                            kind="error",
                            error="Anthropic returned HTTP %d: %s" % (resp.status_code, raw[:300]),
                        )
                        return

                    stop_reason = None
                    usage = {}
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        try:
                            event = json.loads(line[len("data:"):].strip())
                        except ValueError:
                            continue
                        etype = event.get("type")
                        if etype == "message_start":
                            usage["input_tokens"] = (event.get("message") or {}).get("usage", {}).get("input_tokens")
                        elif etype == "content_block_delta":
                            text = (event.get("delta") or {}).get("text")
                            if text:
                                yield StreamEvent(kind="token", text=text)
                        elif etype == "message_delta":
                            stop_reason = (event.get("delta") or {}).get("stop_reason")
                            usage["output_tokens"] = (event.get("usage") or {}).get("output_tokens")
                        elif etype == "message_stop":
                            break
                        elif etype == "error":
                            err = event.get("error") or {}
                            message = err.get("message") or err.get("type") or "unknown error"
                            yield StreamEvent(kind="error", error="Anthropic stream error: %s" % message)
                            return

                    yield StreamEvent(
                        kind="done",
                        finish_reason=stop_reason,
                        prompt_tokens=usage.get("input_tokens"),
                        completion_tokens=usage.get("output_tokens"),
                        latency_ms=int((time.perf_counter() - started) * 1000),
                    )
        except httpx.HTTPError as exc:
            yield StreamEvent(kind="error", error="Connection to Anthropic failed: %s" % exc)

    async def complete(self, model_id, prompt, system_prompt, params, response_format=None):
        # Anthropic's messages API has no json_schema response_format - the
        # judge prompts already demand JSON in plain text, which works fine.
        body = self._body(model_id, prompt, system_prompt, params, JUDGE_MAX_TOKENS)
        started = time.perf_counter()
        try:
            timeout = httpx.Timeout(300.0, connect=15.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(API_URL, json=body, headers=self._headers())
                if resp.status_code != 200:
                    return Completion(
                        error="Anthropic returned HTTP %d: %s" % (resp.status_code, resp.text[:300])
                    )
                data = resp.json()
                if data.get("error"):
                    err = data["error"]
                    return Completion(error=err.get("message", str(err)))
                text = "".join(
                    block.get("text") or "" for block in data.get("content") or []
                )
                usage = data.get("usage") or {}
                return Completion(
                    text=text,
                    finish_reason=data.get("stop_reason"),
                    prompt_tokens=usage.get("input_tokens"),
                    completion_tokens=usage.get("output_tokens"),
                    latency_ms=int((time.perf_counter() - started) * 1000),
                )
        except httpx.HTTPError as exc:
            return Completion(error="Connection to Anthropic failed: %s" % exc)
