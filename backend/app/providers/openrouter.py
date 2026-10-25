"""Streams chat completions through OpenRouter's OpenAI-compatible API."""
import json
import time
from typing import AsyncIterator

import httpx

from app.core.config import settings
from app.providers.base import Completion, ProviderAdapter, SharedParams, StreamEvent

CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"


class OpenRouterAdapter(ProviderAdapter):
    """Streams one completion for one OpenRouter model; failures come back as error events."""

    async def stream_completion(
        self,
        model_id: str,
        prompt: str,
        system_prompt: str,
        params: SharedParams,
    ) -> AsyncIterator[StreamEvent]:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        body = {
            "model": model_id,
            "messages": messages,
            "stream": True,
            # ask OpenRouter to include token usage in the final chunk
            "stream_options": {"include_usage": True},
        }
        # only send the params that were actually set; the rest stay at the
        # model's own default
        if params.temperature is not None:
            body["temperature"] = params.temperature
        if params.top_p is not None:
            body["top_p"] = params.top_p
        if params.max_tokens is not None:
            body["max_tokens"] = params.max_tokens

        headers = {}
        if settings.openrouter_api_key:
            headers["Authorization"] = "Bearer " + settings.openrouter_api_key

        started = time.perf_counter()
        try:
            timeout = httpx.Timeout(300.0, connect=15.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", CHAT_URL, json=body, headers=headers) as resp:
                    if resp.status_code != 200:
                        raw = (await resp.aread()).decode("utf-8", "replace")
                        yield StreamEvent(
                            kind="error",
                            error="OpenRouter returned HTTP %d: %s" % (resp.status_code, raw[:300]),
                        )
                        return

                    finish_reason = None
                    usage = {}
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload = line[len("data:"):].strip()
                        if payload == "[DONE]":
                            break
                        try:
                            chunk = json.loads(payload)
                        except json.JSONDecodeError:
                            continue  # skip keep-alives / partial lines
                        if chunk.get("error"):
                            err = chunk["error"]
                            yield StreamEvent(kind="error", error=err.get("message", str(err)))
                            return
                        if chunk.get("usage"):
                            usage = chunk["usage"]
                        for choice in chunk.get("choices") or []:
                            delta = choice.get("delta") or {}
                            if delta.get("content"):
                                yield StreamEvent(kind="token", text=delta["content"])
                            if choice.get("finish_reason"):
                                finish_reason = choice["finish_reason"]

                    yield StreamEvent(
                        kind="done",
                        finish_reason=finish_reason,
                        prompt_tokens=usage.get("prompt_tokens"),
                        completion_tokens=usage.get("completion_tokens"),
                        latency_ms=int((time.perf_counter() - started) * 1000),
                    )
        except httpx.HTTPError as exc:
            yield StreamEvent(kind="error", error="Connection to OpenRouter failed: %s" % exc)

    async def complete(
        self,
        model_id: str,
        prompt: str,
        system_prompt: str,
        params: SharedParams,
        response_format: dict | None = None,
    ) -> Completion:
        """One non-streamed completion; the judge engine's path into OpenRouter."""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        body = {"model": model_id, "messages": messages}
        if params.temperature is not None:
            body["temperature"] = params.temperature
        if params.top_p is not None:
            body["top_p"] = params.top_p
        if params.max_tokens is not None:
            body["max_tokens"] = params.max_tokens
        if response_format is not None:
            body["response_format"] = response_format

        headers = {}
        if settings.openrouter_api_key:
            headers["Authorization"] = "Bearer " + settings.openrouter_api_key

        started = time.perf_counter()
        try:
            timeout = httpx.Timeout(300.0, connect=15.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(CHAT_URL, json=body, headers=headers)
                if resp.status_code != 200:
                    return Completion(
                        error="OpenRouter returned HTTP %d: %s" % (resp.status_code, resp.text[:300])
                    )
                data = resp.json()
                if data.get("error"):
                    err = data["error"]
                    return Completion(error=err.get("message", str(err)))
                choices = data.get("choices") or []
                if not choices:
                    return Completion(error="OpenRouter returned no choices")
                message = choices[0].get("message") or {}
                usage = data.get("usage") or {}
                return Completion(
                    text=message.get("content") or "",
                    finish_reason=choices[0].get("finish_reason"),
                    prompt_tokens=usage.get("prompt_tokens"),
                    completion_tokens=usage.get("completion_tokens"),
                    latency_ms=int((time.perf_counter() - started) * 1000),
                )
        except httpx.HTTPError as exc:
            return Completion(error="Connection to OpenRouter failed: %s" % exc)
