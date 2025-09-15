# backend/app/routes/auth.py
from fastapi import APIRouter, HTTPException, Header, Depends, Request
from pydantic import BaseModel
from typing import Optional, Dict
from datetime import datetime, timedelta, timezone
import json, hmac, hashlib, base64

router = APIRouter(prefix="/auth", tags=["auth"])

# ----- MVP: utilisateurs en mémoire -----
USERS = [
    {"id": 1, "email": "mjpm@example.com", "password": "mjpm123", "role": "mjpm", "name": "MJPM Demo"},
    {"id": 2, "email": "livreur@example.com", "password": "livreur123", "role": "deliverer", "name": "Livreur Demo"},
]

# ----- Secret de signature (mets-le dans une variable d'env à terme)
SECRET_KEY = b"CHANGE_ME_WITH_A_LONG_RANDOM_SECRET"
TOKEN_TTL_MIN = 24 * 60  # 24h

class LoginIn(BaseModel):
    email: str
    password: str

class AuthOut(BaseModel):
    token: str
    user: Dict

def _find_user(email: str, password: str) -> Optional[Dict]:
    for u in USERS:
        if u["email"] == email and u["password"] == password:
            return {k: v for k, v in u.items() if k != "password"}
    return None

# ----- Helpers encodage/decodage token (stateless, signé HMAC-SHA256) -----
def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)

def _sign(msg: bytes) -> str:
    sig = hmac.new(SECRET_KEY, msg, hashlib.sha256).digest()
    return _b64url_encode(sig)

def _make_token(payload: Dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    h = _b64url_encode(json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    p = _b64url_encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    sig = _sign(f"{h}.{p}".encode("ascii"))
    return f"{h}.{p}.{sig}"

def _verify_token(token: str) -> Dict:
    try:
        h, p, s = token.split(".")
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid token format")
    expected = _sign(f"{h}.{p}".encode("ascii"))
    if not hmac.compare_digest(expected, s):
        raise HTTPException(status_code=401, detail="Invalid token signature")
    payload = json.loads(_b64url_decode(p))
    now = datetime.now(timezone.utc).timestamp()
    if "exp" in payload and now > float(payload["exp"]):
        raise HTTPException(status_code=401, detail="Token expired")
    return payload

def _issue_payload_for_user(user: Dict) -> Dict:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=TOKEN_TTL_MIN)
    return {
        "sub": user["id"],
        "email": user["email"],
        "role": user["role"],
        "name": user.get("name", ""),
        "iat": now.timestamp(),
        "exp": exp.timestamp(),
    }

def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    if not authorization.lower().startswith("bearer "):
        return None
    return authorization.split(" ", 1)[1].strip()

# ----- Dépendances -----
def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> Dict:
    """
    Ordre de recherche du token:
    1) Query string ?token=...
    2) Authorization: Bearer <token>
    3) Cookie 'tutelliv_token'
    """
    # ✅ 1) query string
    token = request.query_params.get("token")

    # 2) Authorization header
    if not token:
        token = _extract_bearer(authorization)

    # 3) Cookie
    if not token:
        cookie = request.cookies.get("tutelliv_token")
        if cookie:
            token = cookie

    if not token:
        raise HTTPException(status_code=401, detail="Missing token")

    payload = _verify_token(token)
    return payload

def require_deliverer(user: Dict = Depends(get_current_user)) -> Dict:
    if user.get("role") != "deliverer":
        raise HTTPException(status_code=403, detail="Deliverer role required")
    return user

# ----- Routes -----
@router.post("/login", response_model=AuthOut)
def login(body: LoginIn):
    user = _find_user(body.email, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = _make_token(_issue_payload_for_user(user))
    return {"token": token, "user": user}

@router.get("/me")
def me(user: Dict = Depends(get_current_user)):
    return {"user": user}

@router.post("/logout")
def logout():
    return {"ok": True}
