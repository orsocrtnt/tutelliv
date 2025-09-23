from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes.beneficiaries import router as beneficiaries_router
from .routes.missions import router as missions_router
from .routes.invoices import router as invoices_router
from .services.estimate import router as estimate_router
from .routes.stats import router as stats_router
from .routes.auth import router as auth_router  # ✅
from .routes.events import router as events_router  # ✅ NEW

app = FastAPI(title="TutelLiv – MVP API", version="0.1.0")

# CORS pour le front (Next.js) — autorise localhost + IP privées (dont 192.168.1.58)
allow_origin_regex = (
    r"^https?://("
    r"localhost"
    r"|127\.0\.0\.1"
    r"|192\.168\.\d{1,3}\.\d{1,3}"
    r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}"
    r")(?:\:\d+)?$"
)

app.add_middleware(
    CORSMiddleware,
    # Pour être explicite, on garde aussi une liste d'origines précises utilisées souvent
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://192.168.1.58:3000",   # ✅ ton cas actuel
    ],
    allow_origin_regex=allow_origin_regex,  # ✅ couvre les autres IP privées si ton IP change
    allow_credentials=True,                 # cookies/headers d’auth
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

# Monte les routes de l’app (auth d'abord, SSE ensuite)
app.include_router(auth_router)           # ✅ Auth d'abord
app.include_router(events_router)         # ✅ SSE
app.include_router(beneficiaries_router)
app.include_router(missions_router)
app.include_router(invoices_router)
app.include_router(estimate_router)
app.include_router(stats_router)
