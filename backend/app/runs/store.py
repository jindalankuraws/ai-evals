"""Runs are kept in memory and lost on restart."""
import time
import uuid
from dataclasses import dataclass, field

# oldest runs are dropped once the cap is hit
MAX_RUNS = 200


@dataclass
class ModelResult:
    """One compared model's answer, accumulated while the run streams."""

    model_id: str
    text: str = ""
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    latency_ms: int | None = None
    error: str | None = None


@dataclass
class RunRecord:
    """Everything about one comparison run, keyed by its run id."""

    run_id: str
    prompt: str
    system_prompt: str
    params: dict
    model_ids: list[str]
    judge_model: str
    created_at: float
    results: dict = field(default_factory=dict)  # model_id -> ModelResult
    status: str = "streaming"  # streaming | complete
    evaluation: dict | None = None  # cached verdict, evaluated once per run
    evaluating: bool = False  # True while a judge call is in flight

    def result_for(self, model_id: str) -> ModelResult:
        """Return (and lazily create) the result slot for one model."""
        if model_id not in self.results:
            self.results[model_id] = ModelResult(model_id=model_id)
        return self.results[model_id]


class RunStore:
    """Process-wide in-memory run store."""

    def __init__(self) -> None:
        self._runs: dict[str, RunRecord] = {}

    def create(
        self,
        *,
        prompt: str,
        system_prompt: str,
        params: dict,
        model_ids: list[str],
        judge_model: str,
    ) -> RunRecord:
        record = RunRecord(
            run_id=uuid.uuid4().hex[:12],
            prompt=prompt,
            system_prompt=system_prompt,
            params=params,
            model_ids=list(model_ids),
            judge_model=judge_model,
            created_at=time.time(),
        )
        self._runs[record.run_id] = record
        while len(self._runs) > MAX_RUNS:
            oldest = min(self._runs, key=lambda rid: self._runs[rid].created_at)
            del self._runs[oldest]
        return record

    def get(self, run_id: str) -> RunRecord | None:
        return self._runs.get(run_id)


store = RunStore()
