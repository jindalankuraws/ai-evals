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