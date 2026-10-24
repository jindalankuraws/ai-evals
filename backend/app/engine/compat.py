"""No run gets sent until every shared param is supported by every model in it.

The UI does its own live validation, but the backend is the final gatekeeper:
POST /api/run re-checks the models x params matrix and rejects with a 422 if
anything is incompatible. Nothing is silently dropped.

Model ids here are composite (``provider::model``); the family gate works on
the bare model part so families stay consistent across providers - e.g.
``openai::gpt-4o`` and ``openrouter::openai/gpt-4o`` are the same family.
"""
from app.catalog import get_catalog
from app.models.schemas import RunRequest
from app.providers.registry import is_configured, parse_composite

# our shared param fields -> the names the catalogs use in supported_parameters
PARAM_TO_CATALOG_KEY = {
    "temperature": "temperature",
    "top_p": "top_p",
    "max_tokens": "max_tokens",
}


# structured-output support: the judge must be able to emit our verdict JSON
STRUCTURED_OUTPUT_KEYS = {"structured_outputs", "response_format"}


def _family(model_id: str) -> str:
    """The model family a composite id belongs to.

    Within OpenRouter the vendor prefix of the bare id is the family
    (``anthropic/claude-...``). Native providers are single-family, so the
    provider slug itself is the family - except OpenAI-compatible endpoints,
    where ids are arbitrary and the bare id is the only safe family.
    """
    provider, model = parse_composite(model_id)
    if "/" in model:
        return model.split("/", 1)[0]
    if provider == "openai-compatible":
        return model
    return provider


async def _catalog_errors(req: RunRequest) -> list[str]:
    """Human-readable setup problems for models/providers we can't serve."""
    problems: list[str] = []
    catalog = {m["id"]: m for m in await get_catalog()}
    for model_id in [*req.model_ids, req.judge_model]:
        if model_id in catalog:
            continue
        provider, _ = parse_composite(model_id)
        if not is_configured(provider):
            problems.append(
                "Provider '%s' is not configured - set its key in .env and "
                "restart the backend before using %s." % (provider, model_id)
            )
        else:
            problems.append("Unknown model: %s" % model_id)
    return problems


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
        return (await _catalog_errors(req)) or ["Unknown judge model: %s" % req.judge_model]

    supported = entry.get("supported_parameters") or []
    if not STRUCTURED_OUTPUT_KEYS & set(supported):
        problems.append(
            "%s does not support structured outputs, so it cannot emit judge "
            "verdicts - pick a different judge model." % req.judge_model
        )

    judge_family = _family(req.judge_model)
    for model_id in req.model_ids:
        if _family(model_id) == judge_family:
            problems.append(
                "%s is the same family as compared model %s - the judge must "
                "be outside every compared model's family." % (req.judge_model, model_id)
            )

    return problems


async def find_conflicts(req: RunRequest) -> list[str]:
    """Return one human-readable message per incompatibility (empty list = OK)."""
    catalog = {m["id"]: m for m in await get_catalog()}
    problems: list[str] = []
    if any(model_id not in catalog for model_id in req.model_ids):
        problems.extend(await _catalog_errors(req))

    for model_id in req.model_ids:
        entry = catalog.get(model_id)
        if entry is None:
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
                    "%s does not support '%s' - clear the param for all models, "
                    "or remove the model." % (model_id, key)
                )

    return problems