"""Verdict shapes the judge model must emit.

MetricCallVerdict is the raw JSON one judge call returns for one metric
across all compared responses. Pydantic validates it strictly - a malformed
verdict costs the call one retry before the metric is marked an inference
error.
"""
from typing import Literal

from pydantic import BaseModel, Field


class ScoredResponse(BaseModel):
    """One response's score on one metric, with the judge's reasoning."""

    model: str = Field(description="Response letter, e.g. 'A'")
    score: int = Field(ge=1, le=5)
    rationale: str = Field(min_length=1)


class MetricCallVerdict(BaseModel):
    """What the judge returns for one metric across every compared response."""

    scores: list[ScoredResponse] = Field(min_length=1)


class PairwiseVerdict(BaseModel):
    """The tie-break call: which of two responses is better overall."""

    winner: Literal["1", "2"]
    rationale: str = Field(min_length=1)