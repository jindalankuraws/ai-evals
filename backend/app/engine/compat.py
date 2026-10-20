"""Apple-to-apple guard — shared params must be supported by every model in a run.

The UI does its own live validation, but the backend is the final gatekeeper:
POST /api/run re-checks the models x params matrix and rejects with a 422 if
anything is incompatible. Nothing is silently dropped.
"""
from app.catalog import get_catalog
from app.models.schemas import RunRequest

# our shared param fields -> the names OpenRouter uses in supported_parameters
PARAM_TO_CATALOG_KEY = {
    "temperature": "temperature",
    "top_p": "top_p",
    "max_tokens": "max_tokens",
}


# structured-output support: the judge must be able to emit our verdict JSON
STRUCTURED_OUTPUT_KEYS = {"structured_outputs", "response_format"}


def _family(model_id: str) -> str:
    """OpenRouter ids look like 'vendor/model' — the vendor is the family."""
    return model_id.split("/", 1)[0] if "/" in model_id else model_id


async def judge_conflicts(req: RunRequest) -> list[str]:
    """Return one human-readable message per judge violation (empty = OK).

    The judge is bound to the run at trigger time, so it is checked before
    any tokens are spent: it must exist, support structured outputs (it has
    to emit our verdict JSON), and sit outside every compared model's family
    so no model grades its own siblings.
    """
    catalog = {m["id"]: m for m in await get_catalog()}
    problems: list[str] = []

    entry = catalog.get(req.judge_model)
    if entry is None:
        return ["Unknown judge model: %s" % req.judge_model]

    supported = entry.get("supported_parameters") or []
    if not STRUCTURED_OUTPUT_KEYS & set(supported):
        problems.append(
            "%s does not support structured outputs, so it cannot emit judge "
            "verdicts — pick a different judge model." % req.judge_model
        )

    judge_family = _family(req.judge_model)
    for model_id in req.model_ids:
        if _family(model_id) == judge_family:
            problems.append(
                "%s is the same family as compared model %s — the judge must "
                "be outside every compared model's family." % (req.judge_model, model_id)
            )

    return problems


async def find_conflicts(req: RunRequest) -> list[str]:
    """Return one human-readable message per incompatibility (empty list = OK)."""
    catalog = {m["id"]: m for m in await get_catalog()}
    problems: list[str] = []

    for model_id in req.model_ids:
        entry = catalog.get(model_id)
        if entry is None:
            problems.append("Unknown model: %s" % model_id)
            continue

        supported = entry.get("supported_parameters") or []
        set_params = {
            field: value
            for field, value in req.params.model_dump().items()
            if value is not None
        }
        for field in set_params:
            key = PARAM_TO_CATALOG_KEY[field]
            if key not in supported:
                problems.append(
                    "%s does not support '%s' — clear the param for all models, "
                    "or remove the model." % (model_id, key)
                )

    return problems