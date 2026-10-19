"""Run endpoints.

Phase 2: POST /api/run takes the prompt + shared params + up to 3 models,
fans the prompt out to all of them concurrently, and streams every answer
back on the same response, tagged with its model id. Nothing is stored yet —
persistence arrives with Phase 7 (deferred).
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.core.sse import event
from app.engine.compat import find_conflicts
from app.engine.orchestrator import fan_out
from app.models.schemas import RunRequest
from app.providers.openrouter import OpenRouterAdapter

router = APIRouter(prefix="/api", tags=["runs"])

adapter = OpenRouterAdapter()


@router.post("/run")
async def run(req: RunRequest):
    """Stream every model's completion, tagged by model, as the response body."""

    # apple-to-apple gate: each shared param must be supported by every model
    conflicts = await find_conflicts(req)
    if conflicts:
        raise HTTPException(status_code=422, detail=conflicts)

    async def generate():
        async for tagged in fan_out(adapter, req.model_ids, req.prompt, req.system_prompt, req.params):
            ev = tagged.event
            if ev.kind == "token":
                yield event("token", {"model_id": tagged.model_id, "text": ev.text})
            elif ev.kind == "done":
                yield event("done", {
                    "model_id": tagged.model_id,
                    "finish_reason": ev.finish_reason,
                    "prompt_tokens": ev.prompt_tokens,
                    "completion_tokens": ev.completion_tokens,
                    "latency_ms": ev.latency_ms,
                })
            elif ev.kind == "error":
                yield event("error", {"model_id": tagged.model_id, "message": ev.error or "unknown error"})
        yield event("end", {})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
