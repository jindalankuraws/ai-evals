"""FastAPI application entry point for AI Evals."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes_models import router as models_router
from app.api.routes_runs import router as runs_router
from app.providers.registry import PROVIDERS, is_configured, provider_status


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Log which providers are configured, so a missing .env entry is obvious."""
    ready = [p["slug"] for p in PROVIDERS if is_configured(p["slug"])]
    print("providers configured: %s" % (", ".join(ready) or "none"))
    yield


app = FastAPI(title="AI Evals", version="0.1.0", lifespan=lifespan)

# the Vite dev server is the only origin that talks to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(models_router)
app.include_router(runs_router)


@app.get("/health")
def health():
    """Liveness check for the frontend and any monitoring."""
    return {"status": "ok", "providers": provider_status()}
