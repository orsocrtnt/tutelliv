from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes.beneficiaries import router as beneficiaries_router
from .routes.missions import router as missions_router
from .routes.invoices import router as invoices_router
from .services.estimate import router as estimate_router
from .routes.stats import router as stats_router
from .routes.auth import router as auth_router  # ✅

app = FastAPI(title="TutelLiv – MVP API", version="0.1.0")

# CORS pour le front (Next.js)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

# Monte les routes de l’app
app.include_router(auth_router)           # ✅ Auth d'abord
app.include_router(beneficiaries_router)
app.include_router(missions_router)
app.include_router(invoices_router)
app.include_router(estimate_router)
app.include_router(stats_router)
