"""Model + provider catalog endpoints.

The catalog is fetched live per provider and cached in a shared module for a
few minutes, so page loads don't hit provider APIs every time. Every model
carries a ``provider`` field and a composite id (``provider::model``) that
routes_runs dispatches on. The supported_parameters field per model is what
the param-compatibility checks are built on.
"""
from fastapi import APIRouter, HTTPException

from app.catalog import get_catalog_report
from app.providers import registry

router = APIRouter(prefix="/api", tags=["models"])


@router.get("/providers")
async def list_providers():
    """Which inference providers exist and which are configured right now."""
    return {"providers": registry.provider_status()}


@router.get("/models")
async def list_models():
    """Merged catalog plus per-provider fetch status (cached per provider).

    The status map tells the picker why a configured provider shows no
    models - bad key, timeout, whatever the provider returned.
    """
    models, provider_status = await get_catalog_report()
    return {"models": models, "provider_status": provider_status}
