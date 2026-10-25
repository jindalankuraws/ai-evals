"""Adapter for any OpenAI-compatible endpoint set by OPENAI_COMPATIBLE_BASE_URL."""

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
