"""AI Evals backend — FastAPI app entry point."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes_models import router as models_router
from app.api.routes_runs import router as runs_router
from app.core.config import settings

app = FastAPI(title="AI Evals", version="0.1.0")

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
    has_key = bool(settings.openrouter_api_key)
    return {"status": "ok", "openrouter_configured": has_key}
