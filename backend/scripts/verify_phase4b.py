"""Phase 4b end-to-end verification: run a comparison, evaluate it live."""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://localhost:8000"


def post_json(path: str, body=None):
    data = json.dumps(body).encode() if body is not None else b""
    req = urllib.request.Request(BASE + path, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req)


def main() -> int:
    run_body = {
        "model_ids": ["openai/gpt-4o-mini", "google/gemini-2.5-flash"],
        "judge_model": "anthropic/claude-sonnet-4.5",
        "prompt": "Explain recursion to a 10-year-old in exactly two sentences.",
        "params": {"temperature": 0.7, "max_tokens": 150},
    }
    with post_json("/api/run", run_body) as resp:
        run_id = None
        for raw in resp:
            for block in raw.decode().split("\n\n"):
                for line in block.split("\n"):
                    if line.startswith("data:"):
                        payload = json.loads(line[5:].strip())
                        if isinstance(payload, dict) and "run_id" in payload:
                            run_id = payload["run_id"]
    if not run_id:
        print("FAIL: no run_id captured from stream")
        return 1
    print("run_id:", run_id)
    time.sleep(2)

    with post_json("/api/runs/%s/evaluate" % run_id) as resp:
        evaluation = json.loads(resp.read())
    print("HTTP 200 — evaluation received")
    print("winner:", evaluation["winner"])

    # fire-once: a second call must return the identical cached verdict
    with post_json("/api/runs/%s/evaluate" % run_id) as resp:
        second = json.loads(resp.read())
    assert second == evaluation, "fire-once cache violated — second call re-judged"
    print("fire-once verified: second call returned the cached verdict byte-identical")

    print("letters:", evaluation["letters"])
    for name, metric in evaluation["metrics"].items():
        print("  %-22s weight=%s status=%s" % (name, metric["weight"], metric["status"]))
        if metric["status"] == "ok":
            for model_id, score in metric["scores"].items():
                print("      %-28s %s/5  %s" % (model_id, score["score"], score["rationale"][:90]))
    print("overall ranking:", [(o["model_id"], o["weighted_score"]) for o in evaluation["overall"]])
    print("tie_break:", evaluation["tie_break"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
