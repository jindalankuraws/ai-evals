"""Model and provider catalog endpoints."""
from fastapi import APIRouter

from app.catalog import get_catalog_report
from app.providers import registry

router = APIRouter(prefix="/api", tags=["models"])


@router.get("/providers")
async def list_providers():
    """Which inference providers exist and which are configured right now."""
    return {"providers": registry.provider_status()}


@router.get("/models")
async def list_models():
    """Merged catalog plus each provider's fetch status, so the picker can say why a provider has no models."""
    models, provider_status = await get_catalog_report()
    return {"models": models, "provider_status": provider_status}
