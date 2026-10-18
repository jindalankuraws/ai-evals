"""Model catalog endpoint.

The catalog is fetched live from OpenRouter and cached in a shared module for
a few minutes, so page loads don't hit OpenRouter every time. The
supported_parameters field per model is what Phase 2's param-compatibility
checks are built on.
"""
from fastapi import APIRouter, HTTPException

from app.catalog import get_catalog

router = APIRouter(prefix="/api", tags=["models"])


@router.get("/models")
async def list_models():
    """Return the chat-capable part of the OpenRouter catalog (cached)."""
    try:
        return {"models": await get_catalog()}
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
