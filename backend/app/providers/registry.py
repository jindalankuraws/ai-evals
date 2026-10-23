"""Which inference providers exist, whether each one is configured, and how composite model ids get parsed.

A model id in this app is composite: ``provider::model`` (e.g.
``openrouter::anthropic/claude-sonnet-4.5``, ``openai-compatible::qwen3-32b``).
The registry parses those ids, reports which providers are configured (their
key/URL is present in settings), and hands out adapter instances.
"""
from functools import lru_cache

from app.core.config import settings
from app.providers.base import ProviderAdapter

# fixed order - the picker renders providers in this sequence
PROVIDERS = [
    {
        "slug": "openai",
        "label": "OpenAI",
        "api_key_env": "OPENAI_API_KEY",
        "hint": "GPT models via OPENAI_API_KEY",
    },
    {
        "slug": "anthropic",
        "label": "Anthropic",
        "api_key_env": "ANTHROPIC_API_KEY",
        "hint": "Claude models via ANTHROPIC_API_KEY",
    },
    {
        "slug": "openrouter",
        "label": "OpenRouter",
        "api_key_env": "OPENROUTER_API_KEY",
        "hint": "One key, hundreds of hosted models",
    },
    {
        "slug": "openai-compatible",
        "label": "OpenAI-compatible",
        "api_key_env": "OPENAI_COMPATIBLE_API_KEY",
        "hint": "Self-hosted endpoints via OPENAI_COMPATIBLE_BASE_URL",
    },
]


def parse_composite(model_id: str) -> tuple[str, str]:
    """Split ``provider::model`` into (provider, bare model id).

    Bare ids (no ``::``) are treated as OpenRouter models - that's what the
    app shipped with, so old clients and old runs keep working.
    """
    if "::" in model_id:
        provider, model = model_id.split("::", 1)
        return provider, model
    return "openrouter", model_id


def is_configured(slug: str) -> bool:
    """A provider is configured when its key (or URL) is present in settings."""
    if slug == "openai":
        return bool(settings.openai_api_key)
    if slug == "anthropic":
        return bool(settings.anthropic_api_key)
    if slug == "openrouter":
        return bool(settings.openrouter_api_key)
    if slug == "openai-compatible":
        return bool(settings.openai_compatible_base_url)
    return False


def provider_status() -> list[dict]:
    """Everything the picker needs to render the provider step."""
    return [
        {
            "slug": p["slug"],
            "label": p["label"],
            "api_key_env": p["api_key_env"],
            "hint": p["hint"],
            "configured": is_configured(p["slug"]),
        }
        for p in PROVIDERS
    ]


@lru_cache(maxsize=None)
def _adapter_for(slug: str) -> ProviderAdapter | None:
    """One adapter instance per provider, built lazily."""
    if not is_configured(slug):
        return None
    if slug == "openai":
        from app.providers.openai import OpenAIAdapter

        return OpenAIAdapter()
    if slug == "anthropic":
        from app.providers.anthropic import AnthropicAdapter

        return AnthropicAdapter()
    if slug == "openrouter":
        from app.providers.openrouter import OpenRouterAdapter

        return OpenRouterAdapter()
    if slug == "openai-compatible":
        from app.providers.openai_compatible import OpenAICompatibleAdapter

        return OpenAICompatibleAdapter()
    return None


def adapter_for(model_id: str) -> ProviderAdapter:
    """Resolve the adapter for a composite model id, or raise a clear error."""
    slug, _ = parse_composite(model_id)
    adapter = _adapter_for(slug)
    if adapter is None:
        spec = next((p for p in PROVIDERS if p["slug"] == slug), None)
        env = spec["api_key_env"] if spec else "the provider settings"
        raise KeyError(
            "Provider '%s' is not configured - set %s in .env and restart the backend."
            % (slug, env)
        )
    return adapter
