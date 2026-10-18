"""Model catalog endpoint.

Fetches the live model list from OpenRouter and keeps it in memory for a few
minutes, so page loads don't hit OpenRouter every time. The
supported_parameters field per model is what Phase 2's param-compatibility
checks will be built on.
"""
import time

import httpx
from fastapi import APIRouter, HTTPException

from app.core.config import settings

router = APIRouter(prefix="/api", tags=["models"])

CACHE_TTL_SECONDS = 300
_cache = {"fetched_at": 0.0, "models": []}


@router.get("/models")
async def list_models():
    """Return the chat-capable part of the OpenRouter catalog (cached)."""
    now = time.time()
    if _cache["models"] and now - _cache["fetched_at"] < CACHE_TTL_SECONDS:
        return _cache["models"]

    headers = {}
    if settings.openrouter_api_key:
        headers["Authorization"] = "Bearer " + settings.openrouter_api_key
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get("https://openrouter.ai/api/v1/models", headers=headers)

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail="OpenRouter model catalog failed: HTTP %d" % resp.status_code,
        )

    models = []
    for m in resp.json().get("data", []):
        architecture = m.get("architecture") or {}
        output = architecture.get("output_modalities") or ["text"]
        if "text" not in output:
            continue  # skip image/audio generators — this app compares text answers
        models.append({
            "id": m.get("id"),
            "name": m.get("name"),
            "context_length": m.get("context_length"),
            "pricing": m.get("pricing"),
            "supported_parameters": m.get("supported_parameters") or [],
        })

    models.sort(key=lambda m: (m["name"] or "").lower())
    _cache["models"] = models
    _cache["fetched_at"] = now
    return models
