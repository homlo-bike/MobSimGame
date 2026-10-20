"""Login for saving and sharing projects on the server.

One administrator account is configured with MOBSIM_ADMIN_USERNAME and
MOBSIM_ADMIN_PASSWORD. Logging in returns a signed, expiring session token
(HMAC-SHA256) that the browser keeps for the tab and sends as a bearer token.
Viewing shared links needs no login; the browser editor works without one.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status

from .config import Settings
from .logging_config import get_logger

log = get_logger(__name__)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class SessionSigner:
    def __init__(self, settings: Settings) -> None:
        secret = settings.session_secret.get_secret_value() if settings.session_secret else None
        if secret is None:
            log.info("no MOBSIM_SESSION_SECRET set: login sessions end when the API restarts")
        self._key = (secret or secrets.token_urlsafe(32)).encode()
        self.ttl_s = settings.session_ttl_s

    def _sign(self, payload: str) -> str:
        return _b64(hmac.new(self._key, payload.encode(), hashlib.sha256).digest())

    def issue(self, username: str, now: float | None = None) -> tuple[str, int]:
        expires = int((now or time.time()) + self.ttl_s)
        payload = _b64(json.dumps({"u": username, "exp": expires}, separators=(",", ":")).encode())
        return f"{payload}.{self._sign(payload)}", expires

    def verify(self, token: str, now: float | None = None) -> str | None:
        try:
            payload, signature = token.split(".", 1)
            if not hmac.compare_digest(signature, self._sign(payload)):
                return None
            data = json.loads(_unb64(payload))
        except (ValueError, json.JSONDecodeError):
            return None
        if not isinstance(data, dict) or int(data.get("exp", 0)) < (now or time.time()):
            return None
        user = data.get("u")
        return user if isinstance(user, str) else None


def check_credentials(settings: Settings, username: str, password: str) -> bool:
    # Compare both values in constant time, always, so timing reveals neither.
    user_ok = hmac.compare_digest(username.encode(), settings.admin_username.encode())
    pass_ok = hmac.compare_digest(password.encode(), settings.admin_password.get_secret_value().encode())
    return user_ok and pass_ok


def require_login(request: Request, authorization: Annotated[str | None, Header()] = None) -> str:
    """Dependency for endpoints that write to the server."""
    signer: SessionSigner = request.app.state.session_signer
    token = authorization[7:].strip() if authorization and authorization[:7].lower() == "bearer " else None
    user = signer.verify(token) if token else None
    if user is None:
        log.info("login required", extra={"path": request.url.path, "token_supplied": bool(token)})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Log in to save or share projects on the server",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


LoggedIn = Annotated[str, Depends(require_login)]
