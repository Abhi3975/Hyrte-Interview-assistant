import hashlib
import hmac
import json
import logging
from typing import Any

import httpx

from .config import settings

logger = logging.getLogger("inference.emitter")


class EventEmitter:
    """Posts proctor events to the backend's external webhook.

    Authenticates with an HMAC-SHA256 signature over the raw JSON body using the
    shared PROCTOR_WEBHOOK_SECRET — the same zero-trust contract the Electron
    agent and any external provider use. The backend risk engine applies
    weighting + decay; this service only forwards observations as evidence.
    """

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=5.0)

    async def emit(
        self,
        session_id: str,
        event_type: str,
        severity: str = "MEDIUM",
        payload: dict[str, Any] | None = None,
    ) -> bool:
        body = json.dumps(
            {
                "sessionId": session_id,
                "type": event_type,
                "severity": severity,
                "payload": payload or {},
                "provider": "inference-service",
            },
            separators=(",", ":"),
        )
        signature = hmac.new(
            settings.proctor_webhook_secret.encode(),
            body.encode(),
            hashlib.sha256,
        ).hexdigest()

        try:
            res = await self._client.post(
                f"{settings.api_base_url}/api/proctoring/webhook",
                content=body,
                headers={
                    "content-type": "application/json",
                    "x-proctor-signature": f"sha256={signature}",
                },
            )
            return res.status_code < 300
        except httpx.HTTPError as exc:  # network hiccup — never crash the pipeline
            logger.warning("Failed to emit %s: %s", event_type, exc)
            return False

    async def aclose(self) -> None:
        await self._client.aclose()


emitter = EventEmitter()
