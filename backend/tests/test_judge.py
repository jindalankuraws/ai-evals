import json
import re

import pytest

from app.engine.judge.evaluator import _extract_json, evaluate_run
from app.providers.base import Completion, ProviderAdapter
from app.runs.store import RunStore

SCORES = {"first answer": 5, "second answer": 3, "third answer": 1}


class FakeJudge(ProviderAdapter):
    """Scores each answer by its text, and can reject any call that sets temperature."""

    def __init__(self, reject_temperature=False):
        self.reject_temperature = reject_temperature
        self.temperatures = []

    async def stream_completion(self, model_id, prompt, system_prompt, params):
        raise NotImplementedError

    async def complete(self, model_id, prompt, system_prompt, params, response_format=None):
        self.temperatures.append(params.temperature)
        if self.reject_temperature and params.temperature is not None:
            return Completion(error="Unsupported value: 'temperature' does not support 0")
        pairs = re.findall(r"--- Response (\w) ---\n(.*)", prompt)
        scores = [{"model": letter, "score": SCORES[text], "rationale": "ok"} for letter, text in pairs]
        return Completion(text=json.dumps({"scores": scores}))


def make_record():
    texts = {"m1": "first answer", "m2": "second answer", "m3": "third answer"}
    record = RunStore().create(
        prompt="Explain recursion.",
        system_prompt="",
        params={},
        model_ids=list(texts),
        judge_model="openrouter::other/judge",
    )
    for model_id, text in texts.items():
        record.result_for(model_id).text = text
    return record


@pytest.mark.asyncio
async def test_judge_retries_without_temperature():
    judge = FakeJudge(reject_temperature=True)
    evaluation = await evaluate_run(make_record(), judge, seed=1)

    assert all(m["status"] == "ok" for m in evaluation["metrics"].values())
    assert evaluation["winner"] == "m1"
    assert judge.temperatures.count(0) == 5
    assert judge.temperatures.count(None) == 5


@pytest.mark.asyncio
async def test_letters_map_back_with_shuffled_order():
    evaluation = await evaluate_run(make_record(), FakeJudge(), seed=7)

    assert evaluation["letters"]["A"] != "m1"
    expected = {"m1": 5, "m2": 3, "m3": 1}
    for metric in evaluation["metrics"].values():
        assert {model_id: s["score"] for model_id, s in metric["scores"].items()} == expected
        for model_id, s in metric["scores"].items():
            assert evaluation["letters"][s["letter"]] == model_id


def test_extract_json_handles_fences_and_prose():
    assert _extract_json('```json\n{"a": 1}\n```') == '{"a": 1}'
    assert _extract_json('```\n{"a": 1}\n```') == '{"a": 1}'
    assert _extract_json('Here are the scores: {"a": {"b": 2}} Hope that helps.') == '{"a": {"b": 2}}'
    assert _extract_json('{"a": 1}') == '{"a": 1}'
