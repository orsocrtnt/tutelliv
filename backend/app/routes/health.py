# backend/app/routes/health.py
from fastapi import APIRouter
from pydantic import BaseModel
from datetime import datetime, timezone

router = APIRouter(tags=["health"])

class HealthOut(BaseModel):
    status: str
    service: str = "tutelliv-api"
    version: str = "0.1.0"
    server_time: str

@router.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    """Endpoint de liveness/readiness basique."""
    return HealthOut(
        status="ok",
        server_time=datetime.now(timezone.utc).isoformat()
    )
