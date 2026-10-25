"""Checks shared params and the judge against the catalog before any tokens are spent."""
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
    """Family of a composite id: the OpenRouter vendor prefix, the bare id for OpenAI-compatible, else the provider."""
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
                "Provider '%s' is not configured. Set its key in .env and "
                "restart the backend before using %s." % (provider, model_id)
            )
        else:
            problems.append("Unknown model: %s" % model_id)
    return problems


async def judge_conflicts(req: RunRequest) -> list[str]:
    """Return one message per judge problem: unknown, no structured outputs, or same family as a compared model."""
    catalog = {m["id"]: m for m in await get_catalog()}
    problems: list[str] = []

    entry = catalog.get(req.judge_model)
    if entry is None:
        return (await _catalog_errors(req)) or ["Unknown judge model: %s" % req.judge_model]

    supported = entry.get("supported_parameters") or []
    if not STRUCTURED_OUTPUT_KEYS & set(supported):
        problems.append(
            "%s does not support structured outputs, so it cannot emit judge "
            "verdicts. Pick a different judge model." % req.judge_model
        )

    judge_family = _family(req.judge_model)
    for model_id in req.model_ids:
        if _family(model_id) == judge_family:
            problems.append(
                "%s is the same family as compared model %s. The judge must "
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
                    "%s does not support '%s'. Clear the param for all models, "
                    "or remove the model." % (model_id, key)
                )

    return problems