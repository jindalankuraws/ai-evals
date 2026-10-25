"""Provider adapter interface; the rest of the app never calls a vendor API directly."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator, Optional

from pydantic import BaseModel, Field


class SharedParams(BaseModel):
    """Inference params applied to every model in a run; anything unset uses the model's default."""

    temperature: Optional[float] = Field(None, ge=0, le=2)
    top_p: Optional[float] = Field(None, gt=0, le=1)
    max_tokens: Optional[int] = Field(None, ge=1)


@dataclass
class StreamEvent:
    """One normalized event from a provider stream."""

    kind: str  # "token" | "done" | "error"
    text: str = ""
    finish_reason: Optional[str] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    latency_ms: Optional[int] = None
    error: Optional[str] = None


@dataclass
class Completion:
    """One whole, non-streamed completion, as the judge consumes it."""

    text: str = ""
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    latency_ms: int | None = None
    error: str | None = None


class ProviderAdapter(ABC):
    """A provider knows how to stream one completion for one model."""

    @abstractmethod
    def stream_completion(
        self,
        model_id: str,
        prompt: str,
        system_prompt: str,
        params: SharedParams,
    ) -> AsyncIterator[StreamEvent]:
        """Yield StreamEvents until the completion finishes or errors."""
        ...

    @abstractmethod
    async def complete(
        self,
        model_id: str,
        prompt: str,
        system_prompt: str,
        params: SharedParams,
        response_format: dict | None = None,
    ) -> Completion:
        """Return one whole completion; response_format is a JSON schema constraint, or None for plain text."""
        ...
