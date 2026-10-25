"""Run endpoints: start a run, read it back, and judge it once."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.core.sse import event
from app.engine.compat import find_conflicts, judge_conflicts
from app.engine.judge import EvaluationError, NotEnoughResponses, evaluate_run
from app.engine.orchestrator import fan_out
from app.models.schemas import RunRequest
from app.providers import registry
from app.runs.store import store

router = APIRouter(prefix="/api", tags=["runs"])


@router.post("/run")
async def run(req: RunRequest):
    """Stream every model's completion, tagged by model, as the response body."""

    # same settings for every model: each shared param must be supported by all of them
    conflicts = await find_conflicts(req)
    # judge check: exists, supports structured outputs, outside compared families
    conflicts += await judge_conflicts(req)
    if conflicts:
        raise HTTPException(status_code=422, detail=conflicts)

    record = store.create(
        prompt=req.prompt,
        system_prompt=req.system_prompt,
        params=req.params.model_dump(),
        model_ids=req.model_ids,
        judge_model=req.judge_model,
    )

    async def generate():
        # first event: the run handle the frontend keeps for the evaluate call
        yield event("run", {"run_id": record.run_id, "judge_model": record.judge_model})

        async for tagged in fan_out(registry.adapter_for, req.model_ids, req.prompt, req.system_prompt, req.params):
            ev = tagged.event
            result = record.result_for(tagged.model_id)
            if ev.kind == "token":
                result.text += ev.text
                yield event("token", {"model_id": tagged.model_id, "text": ev.text})
            elif ev.kind == "done":
                result.finish_reason = ev.finish_reason
                result.prompt_tokens = ev.prompt_tokens
                result.completion_tokens = ev.completion_tokens
                result.latency_ms = ev.latency_ms
                yield event("done", {
                    "model_id": tagged.model_id,
                    "finish_reason": ev.finish_reason,
                    "prompt_tokens": ev.prompt_tokens,
                    "completion_tokens": ev.completion_tokens,
                    "latency_ms": ev.latency_ms,
                })
            elif ev.kind == "error":
                result.error = ev.error or "unknown error"
                yield event("error", {"model_id": tagged.model_id, "message": ev.error or "unknown error"})
        record.status = "complete"
        yield event("end", {})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    """Read one run back: prompt, params, judge and per-model results."""
    record = store.get(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Unknown run: %s" % run_id)

    return {
        "run_id": record.run_id,
        "prompt": record.prompt,
        "system_prompt": record.system_prompt,
        "params": record.params,
        "model_ids": record.model_ids,
        "judge_model": record.judge_model,
        "status": record.status,
        "results": [
            {
                "model_id": r.model_id,
                "text": r.text,
                "finish_reason": r.finish_reason,
                "prompt_tokens": r.prompt_tokens,
                "completion_tokens": r.completion_tokens,
                "latency_ms": r.latency_ms,
                "error": r.error,
            }
            for r in record.results.values()
        ],
    }


@router.post("/runs/{run_id}/evaluate")
async def evaluate_run_endpoint(run_id: str):
    """Judge a captured run with its bound judge model and return the verdict."""
    record = store.get(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Unknown run: %s" % run_id)
    if record.status != "complete":
        raise HTTPException(
            status_code=409,
            detail="Run %s is not complete yet. Evaluation needs the final responses." % run_id,
        )
    if record.evaluating:
        raise HTTPException(
            status_code=409, detail="An evaluation is already in progress for run %s." % run_id
        )
    if record.evaluation is not None:
        return record.evaluation  # evaluated once per run, so return the cached verdict
    record.evaluating = True
    try:
        return await evaluate_run(record, registry.adapter_for(record.judge_model))
    except NotEnoughResponses as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except EvaluationError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    finally:
        record.evaluating = False
