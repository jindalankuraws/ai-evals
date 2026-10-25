"""OpenAI chat completions adapter, also the base for OpenAI-compatible endpoints."""
import json
import time

import httpx

from app.core.config import settings
from app.providers.base import Completion, ProviderAdapter, StreamEvent

API_URL = "https://api.openai.com/v1/chat/completions"


class OpenAIAdapter(ProviderAdapter):
    """Streams one completion via POST /v1/chat/completions."""

    # usage accounting inside streaming responses: OpenAI accepts the
    # stream_options flag, some compatible servers reject unknown fields
    supports_stream_options = True
    provider_name = "OpenAI"

    def _headers(self) -> dict:
        return {"Authorization": "Bearer " + settings.openai_api_key}

    def _base_url(self) -> str:
        return API_URL

    def _body(self, model_id, prompt, system_prompt, params, response_format=None) -> dict:
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
        return body

    async def stream_completion(self, model_id, prompt, system_prompt, params):
        body = self._body(model_id, prompt, system_prompt, params)
        body["stream"] = True
        if self.supports_stream_options:
            body["stream_options"] = {"include_usage": True}

        started = time.perf_counter()
        try:
            timeout = httpx.Timeout(300.0, connect=15.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST", self._base_url(), json=body, headers=self._headers()
                ) as resp:
                    if resp.status_code != 200:
                        raw = (await resp.aread()).decode("utf-8", "replace")
                        yield StreamEvent(
                            kind="error",
                            error="%s returned HTTP %d: %s"
                            % (self.provider_name, resp.status_code, raw[:300]),
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
                        except ValueError:
                            continue
                        choices = chunk.get("choices") or []
                        if choices:
                            delta = choices[0].get("delta") or {}
                            text = delta.get("content")
                            if text:
                                yield StreamEvent(kind="token", text=text)
                            if choices[0].get("finish_reason"):
                                finish_reason = choices[0]["finish_reason"]
                        elif chunk.get("usage"):
                            # usage arrives in a trailing chunk with no choices
                            usage = chunk["usage"]

                    yield StreamEvent(
                        kind="done",
                        finish_reason=finish_reason,
                        prompt_tokens=usage.get("prompt_tokens"),
                        completion_tokens=usage.get("completion_tokens"),
                        latency_ms=int((time.perf_counter() - started) * 1000),
                    )
        except httpx.HTTPError as exc:
            yield StreamEvent(
                kind="error", error="Connection to %s failed: %s" % (self.provider_name, exc)
            )

    async def complete(self, model_id, prompt, system_prompt, params, response_format=None):
        body = self._body(model_id, prompt, system_prompt, params, response_format)
        started = time.perf_counter()
        try:
            timeout = httpx.Timeout(300.0, connect=15.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(self._base_url(), json=body, headers=self._headers())
                if resp.status_code != 200:
                    return Completion(
                        error="%s returned HTTP %d: %s"
                        % (self.provider_name, resp.status_code, resp.text[:300])
                    )
                data = resp.json()
                if data.get("error"):
                    err = data["error"]
                    return Completion(error=err.get("message", str(err)))
                choices = data.get("choices") or []
                if not choices:
                    return Completion(error="%s returned no choices" % self.provider_name)
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
            return Completion(error="Connection to %s failed: %s" % (self.provider_name, exc))
