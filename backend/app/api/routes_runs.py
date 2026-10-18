"""Run endpoints.

Phase 1: POST /api/run takes the prompt + shared params + one model, and
streams the answer back on the same response as SSE-formatted events.
Nothing is stored yet — persistence arrives with Phase 3.
"""
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.core.sse import event
from app.models.schemas import RunRequest
from app.providers.openrouter import OpenRouterAdapter

router = APIRouter(prefix="/api", tags=["runs"])

adapter = OpenRouterAdapter()


@router.post("/run")
async def run(req: RunRequest):
    """Stream one model's completion as the response body."""

    async def generate():
        # Phase 2 note: this is where the single adapter call becomes a
        # concurrent fan-out to N models, multiplexed into this one stream.
        async for ev in adapter.stream_completion(req.model_id, req.prompt, req.system_prompt, req.params):
            if ev.kind == "token":
                yield event("token", {"text": ev.text})
            elif ev.kind == "done":
                yield event("done", {
                    "finish_reason": ev.finish_reason,
                    "prompt_tokens": ev.prompt_tokens,
                    "completion_tokens": ev.completion_tokens,
                    "latency_ms": ev.latency_ms,
                })
            elif ev.kind == "error":
                yield event("error", {"message": ev.error or "unknown error"})
        yield event("end", {})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
