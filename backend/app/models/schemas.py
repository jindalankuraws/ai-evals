"""Request/response DTOs for the API."""
from pydantic import BaseModel, Field

from app.providers.base import SharedParams


class RunRequest(BaseModel):
    """Everything the UI sends for one run; the judge is fixed when the run starts."""

    model_ids: list[str] = Field(min_length=2, max_length=3)
    judge_model: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    system_prompt: str = ""
    params: SharedParams = SharedParams()
