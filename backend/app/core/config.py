from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings, loaded from environment variables or a .env file."""

    openrouter_api_key: str = ""

    # native OpenAI
    openai_api_key: str = ""

    # native Anthropic
    anthropic_api_key: str = ""

    # any OpenAI-compatible endpoint (vLLM, Ollama, LM Studio, ...). The base
    # URL decides whether the provider is configured; the key is optional
    # because local servers usually don't need one.
    openai_compatible_base_url: str = ""
    openai_compatible_api_key: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
