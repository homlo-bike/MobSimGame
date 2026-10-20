"""Login endpoints. Tokens and passwords are never logged."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from ..auth import LoggedIn, SessionSigner, check_credentials
from ..config import Settings
from ..logging_config import get_logger
from ..security import RateLimiter, client_key

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
log = get_logger(__name__)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=500)


class Session(BaseModel):
    username: str
    token: str | None = None
    expires_at: int | None = None


@router.post("/login")
def login(body: LoginRequest, request: Request) -> Session:
    settings: Settings = request.app.state.settings
    limiter: RateLimiter = request.app.state.login_limiter
    client = client_key(request)
    if not limiter.allow(client):
        log.warning("login rate limited", extra={"client": client})
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many login attempts")
    if not check_credentials(settings, body.username, body.password):
        log.warning("login failed", extra={"client": client})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong username or password")
    signer: SessionSigner = request.app.state.session_signer
    token, expires = signer.issue(body.username)
    log.info("login succeeded", extra={"client": client})
    return Session(username=body.username, token=token, expires_at=expires)


@router.get("/me")
def me(user: LoggedIn) -> Session:
    return Session(username=user)
