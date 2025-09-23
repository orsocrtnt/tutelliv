# backend/app/events.py
from __future__ import annotations

import asyncio
import json
from typing import Any, List

from fastapi.encoders import jsonable_encoder

# Bus d'événements simple en mémoire
SUBSCRIBERS: List[asyncio.Queue[str]] = []


def _json_dumps(obj: Any) -> str:
    """
    Sérialisation JSON sûre pour FastAPI/Pydantic :
    - jsonable_encoder -> datetime, UUID, etc. deviennent JSON-compatibles
    - ensure_ascii=False -> accents lisibles
    """
    safe = jsonable_encoder(obj)
    return json.dumps(safe, ensure_ascii=False)


def publish_event(event: str, payload: Any) -> None:
    """
    Publie {type, payload} en JSON sans planter sur les datetime.
    """
    data = _json_dumps({"type": event, "payload": payload})
    for q in list(SUBSCRIBERS):
        try:
            q.put_nowait(data)
        except Exception:
            # On ignore les subscribers HS pour ne pas casser l'API
            pass


# Facultatif : si tu as un endpoint SSE qui s'abonne
async def register_subscriber() -> asyncio.Queue[str]:
    q: asyncio.Queue[str] = asyncio.Queue(maxsize=200)
    SUBSCRIBERS.append(q)
    return q


def unregister_subscriber(q: asyncio.Queue[str]) -> None:
    try:
        SUBSCRIBERS.remove(q)  # type: ignore[arg-type]
    except ValueError:
        pass
