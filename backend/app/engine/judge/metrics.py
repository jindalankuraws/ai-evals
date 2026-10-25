"""Five weighted metrics, each with written anchors for a score of 1 and 5."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Metric:
    """One grading dimension: what it measures, what it weighs, and its rubric."""

    name: str  # stable key used in API payloads
    label: str  # human-readable name
    weight: float
    description: str  # one line: what the judge is scoring on this metric
    score_1: str  # anchored description of a score of 1
    score_5: str  # anchored description of a score of 5


METRICS: list[Metric] = [
    Metric(
        name="correctness",
        label="Correctness",
        weight=3.0,
        description=(
            "Are the response's claims factually right and internally consistent? "
            "A wrong answer matters more than a rambling one, so this is the heaviest metric."
        ),
        score_1="Predominantly wrong, fabricated, or self-contradictory.",
        score_5=(
            "All claims are verifiably accurate; no hallucinations and no contradictions; "
            "any code the response includes would run and correctly solve the task."
        ),
    ),
    Metric(
        name="instruction_following",
        label="Instruction Following",
        weight=3.0,
        description=(
            "Does the response satisfy every explicit constraint (format, length, tone, "
            "structure) and the reasonable implicit ones (role, language)?"
        ),
        score_1="Ignores the prompt's core instructions - wrong format or length entirely.",
        score_5=(
            "Satisfies every explicit constraint and the reasonable implicit ones, "
            "with nothing missing."
        ),
    ),
    Metric(
        name="helpfulness",
        label="Helpfulness",
        weight=2.0,
        description=(
            "Does the response actually solve the user's problem with complete, "
            "actionable content?"
        ),
        score_1="Does not address the actual question.",
        score_5=(
            "Directly solves the user's problem with complete, actionable content "
            "and anticipates the obvious follow-up."
        ),
    ),
    Metric(
        name="clarity",
        label="Clarity",
        weight=1.5,
        description="Is the response well-organized, easy to follow, and free of ambiguity?",
        score_1="Incoherent or unreadable.",
        score_5=(
            "Perfectly organized with a logical flow, zero ambiguity, "
            "and an easy-to-skim structure."
        ),
    ),
    Metric(
        name="conciseness",
        label="Conciseness",
        weight=1.0,
        description=(
            "Does the response avoid padding and repetition, at a length "
            "appropriate to the ask?"
        ),
        score_1="Extreme padding or repetition to the point of being unusable.",
        score_5="No filler at all; every sentence earns its place and the length fits the ask.",
    ),
]