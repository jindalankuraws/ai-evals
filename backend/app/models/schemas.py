"""Request/response DTOs for the API."""
from pydantic import BaseModel, Field

from app.providers.base import SharedParams


class RunRequest(BaseModel):
    """Everything the UI sends for one run.

    Every model in model_ids gets the same prompt and the same shared params
    — that's the apple-to-apple rule. Hard cap of 3 keeps the side-by-side
    grid sane and the cost per run predictable.
    """

    model_ids: list[str] = Field(min_length=1, max_length=3)
    prompt: str = Field(min_length=1)
    system_prompt: str = ""
    params: SharedParams = SharedParams()
