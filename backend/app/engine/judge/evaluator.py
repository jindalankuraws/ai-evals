"""A captured run gets judged one metric at a time, with responses shown under blind letters.

Every judge call is comparative: it sees the user's prompt and all captured
responses under blind letters (A/B/C - the model-id mapping stays on the
server), and scores them on a single 1-5 metric. Scores normalize to 0-1,
get combined with each metric's weight, and the top score wins - unless the
top two finish within TIE_BAND, when one masked pairwise call breaks the
tie. A judge call that fails validation twice is marked an inference error
and its weight is re-normalized across the metrics that did come back.
"""
import asyncio
import json
import random

from pydantic import ValidationError

from app.engine.judge.metrics import Metric, METRICS
from app.engine.judge.prompts import build_metric_prompt, build_pairwise_prompt
from app.engine.judge.schemas import MetricCallVerdict, PairwiseVerdict
from app.providers.base import ProviderAdapter, SharedParams
from app.providers.registry import parse_composite

TIE_BAND = 0.15  # top-two gap within this range goes to the pairwise tie-break
RETRIES = 1  # one extra judge call per metric before declaring an inference error
LETTERS = "ABC"  # enough for MAX_MODELS=3 - extend if the cap ever rises


class EvaluationError(Exception):
    """Run-level failure - no verdict could be produced at all."""


class NotEnoughResponses(EvaluationError):
    """Fewer than two usable responses were captured for the run."""


def _metric_schema() -> dict:
    """OpenRouter json_schema response_format for one metric's verdict."""
    score_item = {
        "type": "object",
        "properties": {
            "model": {"type": "string", "description": "Response letter, e.g. 'A'"},
            "score": {"type": "integer", "minimum": 1, "maximum": 5},
            "rationale": {"type": "string", "description": "Specific evidence"},
        },
        "required": ["model", "score", "rationale"],
        "additionalProperties": False,
    }
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "metric_scores",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {"scores": {"type": "array", "items": score_item}},
                "required": ["scores"],
                "additionalProperties": False,
            },
        },
    }


def _pairwise_schema() -> dict:
    """OpenRouter json_schema response_format for the tie-break verdict."""
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "pairwise_verdict",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "winner": {"type": "string", "enum": ["1", "2"]},
                    "rationale": {"type": "string"},
                },
                "required": ["winner", "rationale"],
                "additionalProperties": False,
            },
        },
    }


def _parse_metric(text: str, expected_letters: set[str]) -> MetricCallVerdict:
    """Strictly validate one metric's raw verdict JSON against the letters."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("judge returned invalid JSON: %s" % exc)
    try:
        verdict = MetricCallVerdict.model_validate(data)
    except ValidationError as exc:
        raise ValueError("judge verdict failed schema validation: %s" % exc)
    got = {s.model for s in verdict.scores}
    if got != expected_letters:
        raise ValueError(
            "judge scored %s but expected %s" % (sorted(got), sorted(expected_letters))
        )
    if len(verdict.scores) != len(expected_letters):
        raise ValueError("judge returned duplicate response letters")
    return verdict


def _parse_pairwise(text: str) -> PairwiseVerdict:
    """Strictly validate the tie-break's raw verdict JSON."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("judge returned invalid JSON: %s" % exc)
    try:
        return PairwiseVerdict.model_validate(data)
    except ValidationError as exc:
        raise ValueError("judge verdict failed schema validation: %s" % exc)


async def _complete(adapter, model_id, user, system, params, schema):
    """Call the judge, retrying once without temperature if the model rejects it."""
    raw = await adapter.complete(model_id, user, system, params, schema)
    if raw.error and params.temperature is not None and "temperature" in raw.error.lower():
        params = SharedParams()
        raw = await adapter.complete(model_id, user, system, params, schema)
    return raw, params


async def _call_metric(
    adapter: ProviderAdapter,
    record,
    metric: Metric,
    responses: list[tuple[str, str]],
    expected_letters: set[str],
    params: SharedParams,
) -> tuple[MetricCallVerdict | None, str | None]:
    """One metric's judge call with a single retry on transport/parse failures."""
    system, user = build_metric_prompt(metric, record.prompt, record.system_prompt, responses)
    schema = _metric_schema()
    last_error = None
    for _ in range(1 + RETRIES):
        raw, params = await _complete(
            adapter, parse_composite(record.judge_model)[1], user, system, params, schema
        )
        if raw.error:
            last_error = raw.error
            continue
        try:
            return _parse_metric(raw.text, expected_letters), None
        except ValueError as exc:
            last_error = str(exc)
    return None, last_error


async def _call_pairwise(
    adapter: ProviderAdapter,
    record,
    prompt: str,
    system_prompt: str,
    first_text: str,
    second_text: str,
    params: SharedParams,
) -> tuple[PairwiseVerdict | None, str | None]:
    """The tie-break judge call with a single retry."""
    system, user = build_pairwise_prompt(prompt, system_prompt, first_text, second_text)
    schema = _pairwise_schema()
    last_error = None
    for _ in range(1 + RETRIES):
        raw, params = await _complete(
            adapter, parse_composite(record.judge_model)[1], user, system, params, schema
        )
        if raw.error:
            last_error = raw.error
            continue
        try:
            return _parse_pairwise(raw.text), None
        except ValueError as exc:
            last_error = str(exc)
    return None, last_error


async def evaluate_run(record, adapter: ProviderAdapter) -> dict:
    """Judge one captured run and return the evaluation payload.

    Raises NotEnoughResponses when fewer than two models produced usable
    text, and EvaluationError when every metric's judge call failed.
    On success the payload is stored on the record and returned.
    """
    completed = sorted(
        (r for r in record.results.values() if r.text and not r.error),
        key=lambda r: r.model_id,
    )
    if len(completed) < 2:
        raise NotEnoughResponses(
            "only %d of %d models returned a usable response - at least two "
            "are needed for a comparison" % (len(completed), len(record.model_ids))
        )

    letters = {r.model_id: LETTERS[i] for i, r in enumerate(completed)}
    letter_to_model = {letter: model_id for model_id, letter in letters.items()}
    responses = [(letters[r.model_id], r.text) for r in completed]
    expected_letters = set(letters.values())
    params = SharedParams(temperature=0)

    results = await asyncio.gather(
        *(_call_metric(adapter, record, m, responses, expected_letters, params) for m in METRICS)
    )

    metric_payload = {}
    usable = []  # metrics that scored - their weights share the overall score
    last_metric_error = None
    for metric, (verdict, error) in zip(METRICS, results):
        entry = {"label": metric.label, "weight": metric.weight}
        if verdict is None:
            entry["status"] = "inference_error"
            entry["error"] = error
            last_metric_error = error
        else:
            entry["status"] = "ok"
            entry["scores"] = {
                letter_to_model[s.model]: {
                    "letter": s.model,
                    "score": s.score,
                    "normalized": round((s.score - 1) / 4, 4),
                    "rationale": s.rationale,
                }
                for s in verdict.scores
            }
            usable.append(metric)
        metric_payload[metric.name] = entry

    if not usable:
        raise EvaluationError(
            "every judge call failed for run %s - last error: %s"
            % (record.run_id, last_metric_error)
        )
    total_weight = sum(m.weight for m in usable)

    overall = []
    for model_id in letters:
        weighted = round(
            sum(
                metric_payload[m.name]["scores"][model_id]["normalized"] * m.weight
                for m in usable
            )
            / total_weight,
            4,
        )
        overall.append(
            {"model_id": model_id, "letter": letters[model_id], "weighted_score": weighted}
        )
    overall.sort(key=lambda item: item["weighted_score"], reverse=True)

    winner_model = overall[0]["model_id"]
    tie_break = None
    if len(overall) >= 2 and overall[0]["weighted_score"] - overall[1]["weighted_score"] <= TIE_BAND:
        top_id, runner_up_id = overall[0]["model_id"], overall[1]["model_id"]
        first_id, second_id = top_id, runner_up_id
        # randomize the presentation order so position bias can't decide the tie
        if random.random() < 0.5:
            first_id, second_id = second_id, first_id
        text_by_id = {r.model_id: r.text for r in completed}
        verdict, error = await _call_pairwise(
            adapter,
            record,
            record.prompt,
            record.system_prompt,
            text_by_id[first_id],
            text_by_id[second_id],
            params,
        )
        tie_break = {
            "winner": None,
            "rationale": None,
            "error": error,
            "presentation_order": [first_id, second_id],
        }
        if verdict is not None:
            tie_break["winner"] = first_id if verdict.winner == "1" else second_id
            tie_break["rationale"] = verdict.rationale
            winner_model = tie_break["winner"]
        # if the tie-break call itself failed, the weighted winner stands

    evaluation = {
        "run_id": record.run_id,
        "judge_model": record.judge_model,
        "letters": {letter: model_id for model_id, letter in letters.items()},
        "metrics": metric_payload,
        "overall": overall,
        "winner": winner_model,
        "tie_break": tie_break,
    }
    record.evaluation = evaluation
    return evaluation