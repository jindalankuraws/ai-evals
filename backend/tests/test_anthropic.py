import httpx
import pytest

from app.providers import anthropic
from app.providers.base import SharedParams

STREAM = (
    'event: message_start\n'
    'data: {"type": "message_start", "message": {"usage": {"input_tokens": 5}}}\n\n'
    'event: content_block_delta\n'
    'data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Half an"}}\n\n'
    'event: error\n'
    'data: {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}\n\n'
)


@pytest.mark.asyncio
async def test_anthropic_stream_error_is_a_failure(monkeypatch):
    transport = httpx.MockTransport(lambda request: httpx.Response(200, text=STREAM))
    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        anthropic.httpx, "AsyncClient", lambda **kwargs: real_client(transport=transport, **kwargs)
    )

    events = [
        ev
        async for ev in anthropic.AnthropicAdapter().stream_completion(
            "claude-test", "hi", "", SharedParams()
        )
    ]

    assert [ev.kind for ev in events] == ["token", "error"]
    assert events[-1].error == "Anthropic stream error: Overloaded"
