"""The thinnest adapter in the codebase: it only re-points the OpenAI wire format at a different base URL.

Anything that speaks the OpenAI chat completions dialect (vLLM, Ollama's
OpenAI shim, LM Studio, llama.cpp server) works: point
``OPENAI_COMPATIBLE_BASE_URL`` at it in .env (e.g. ``http://localhost:11434/v1``).
The API key is optional because most local servers don't check auth.
"""
import httpx

from app.core.config import settings
from app.providers.openai import OpenAIAdapter


class OpenAICompatibleAdapter(OpenAIAdapter):
    """Same wire format as OpenAI, different base URL and optional auth."""

    # local servers vary; the optional usage chunk is not worth 422s on
    # implementations that reject unknown fields
    supports_stream_options = False
    provider_name = "OpenAI-compatible"

    def _headers(self) -> dict:
        if settings.openai_compatible_api_key:
            return {"Authorization": "Bearer " + settings.openai_compatible_api_key}
        return {}

    def _base_url(self) -> str:
        base = settings.openai_compatible_base_url.rstrip("/")
        return base + "/chat/completions"
