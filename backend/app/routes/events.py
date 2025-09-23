# backend/app/routes/events.py
from __future__ import annotations

import asyncio
from typing import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..events import register_subscriber, unregister_subscriber  # OK ici

router = APIRouter(prefix="/events", tags=["events"])


async def _sse_stream(q: asyncio.Queue[str]) -> AsyncIterator[bytes]:
    """
    Générateur SSE simple basé sur une asyncio.Queue.
    """
    try:
        yield b": connected\n\n"  # ping initial (optionnel)
        while True:
            data = await q.get()
            yield f"data: {data}\n\n".encode("utf-8")
    except asyncio.CancelledError:
        raise
    finally:
        unregister_subscriber(q)


@router.get("/stream")
async def stream_events() -> StreamingResponse:
    """
    Endpoint SSE compatible EventSource côté front.
    """
    q = await register_subscriber()
    return StreamingResponse(
        _sse_stream(q),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
