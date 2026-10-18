"""Request/response DTOs for the API."""
from pydantic import BaseModel, Field

from app.providers.base import SharedParams


class RunRequest(BaseModel):
    """Everything the UI sends for one run. Params are shared across all models."""

    model_id: str
    prompt: str = Field(min_length=1)
    system_prompt: str = ""
    params: SharedParams = SharedParams()
