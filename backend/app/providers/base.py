"""Provider adapter interface.

The rest of the app only talks to this interface — never to a vendor API
directly. OpenRouter ships first; native OpenAI/Anthropic/Bedrock or a
self-hosted LiteLLM adapter can slot in later without touching anything else.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator, Optional

from pydantic import BaseModel, Field


class SharedParams(BaseModel):
    """Inference params shared by every model in a run — the apple-to-apple rule.

    All three are optional: anything unset is left to the model's own default.
    """

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
