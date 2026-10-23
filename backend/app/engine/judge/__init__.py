"""LLM-as-Judge engine.

`evaluate_run` is the entry point the API route calls; the three moving
parts live beside it - the metric registry (metrics.py), the judge prompt
builder (prompts.py) and the verdict schemas (schemas.py).
"""
from app.engine.judge.evaluator import EvaluationError, NotEnoughResponses, evaluate_run

__all__ = ["EvaluationError", "NotEnoughResponses", "evaluate_run"]