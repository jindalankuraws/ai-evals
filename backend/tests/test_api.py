from fastapi.testclient import TestClient

from app.engine import compat
from app.main import app

PARAMS = ["temperature", "top_p", "max_tokens", "structured_outputs"]


async def fake_catalog():
    return [
        {"id": "openai::gpt-test", "supported_parameters": PARAMS},
        {"id": "openrouter::meta/llama-test", "supported_parameters": PARAMS},
    ]


def test_unknown_judge_returns_422(monkeypatch):
    monkeypatch.setattr(compat, "get_catalog", fake_catalog)
    client = TestClient(app)

    resp = client.post(
        "/api/run",
        json={
            "model_ids": ["openai::gpt-test", "openrouter::meta/llama-test"],
            "judge_model": "openrouter::nobody/missing-judge",
            "prompt": "hi",
        },
    )

    assert resp.status_code == 422
    assert "openrouter::nobody/missing-judge" in " ".join(resp.json()["detail"])
