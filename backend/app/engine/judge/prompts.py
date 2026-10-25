"""Builds the judge prompts: comparative, blind letters, one metric per call."""
from app.engine.judge.metrics import Metric

JUDGE_SYSTEM = (
    "You are a strict, consistent evaluator of AI model responses. "
    "You will be shown the user's prompt and several responses labelled "
    "A, B, C, ... You will score every response on ONE dimension using a "
    "1-5 scale and the rubric you are given. Judge each response on its own "
    "merits, but compare them against each other so the best response on "
    "this dimension gets the highest score. Cite specific evidence from a "
    "response in every rationale. Respond only with the requested JSON."
)


def build_metric_prompt(
    metric: Metric,
    prompt: str,
    system_prompt: str,
    responses: list[tuple[str, str]],
) -> tuple[str, str]:
    """Return (system, user) for one metric's call; responses are (letter, text) pairs."""
    lines = [
        "Dimension: %s" % metric.label,
        "",
        "What this measures: %s" % metric.description,
        "",
        "Scoring rubric (1-5):",
        "  1 = %s" % metric.score_1,
        "  5 = %s" % metric.score_5,
        "  Scores 2-4 fall between the anchors: closer to 1 means closer to the '1' behaviour.",
        "",
        "User prompt:",
        prompt or "(no prompt)",
    ]
    if system_prompt:
        lines += ["", "System prompt given to the models:", system_prompt]
    lines += ["", "Responses to score:"]
    for letter, text in responses:
        lines += ["", "--- Response %s ---" % letter, text]
    lines += [
        "",
        "Score every response above on the %s dimension. Return JSON exactly like:" % metric.label,
        '{"scores": [{"model": "A", "score": 4, "rationale": "..."}, ...]}',
        "Include every response letter exactly once.",
    ]
    return JUDGE_SYSTEM, "\n".join(lines)


def build_pairwise_prompt(prompt: str, system_prompt: str, first_text: str, second_text: str) -> tuple[str, str]:
    """Return (system, user) for the tie-break; the caller randomizes which answer comes first."""
    lines = [
        "Two AI responses to the same user prompt ended in a tie on a weighted score. "
        "Decide which response is better overall for this user.",
        "",
        "User prompt:",
        prompt or "(no prompt)",
    ]
    if system_prompt:
        lines += ["", "System prompt given to the models:", system_prompt]
    lines += [
        "",
        "--- Response 1 ---",
        first_text,
        "",
        "--- Response 2 ---",
        second_text,
        "",
        "Consider all dimensions together: correctness, instruction following, "
        "helpfulness, clarity and conciseness. Return JSON exactly like:",
        '{"winner": "1", "rationale": "..."}',
        'where "winner" is "1" or "2".',
    ]
    return JUDGE_SYSTEM, "\n".join(lines)