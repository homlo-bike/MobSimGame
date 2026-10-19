"""Centralised logging for the MobSimGame API.

Configured once at start-up from settings:

- ``MOBSIM_LOG_LEVEL`` (or ``LOG_LEVEL``): minimum severity. Levels, most granular
  first: ``debug`` < ``info`` (alias ``log``) < ``warning`` (alias ``warn``) < ``error``.
- ``MOBSIM_LOG_FORMAT``: ``json`` (one JSON object per line), ``text`` (readable,
  timestamped) or ``auto`` (JSON in production, text otherwise).

In production ``debug`` is never enabled: a configured ``debug`` level is raised to
``info`` and a warning is logged. Values under sensitive keys (tokens, secrets,
passwords, authorisation headers, cookies, API keys) are redacted from structured
fields, and bearer tokens are masked in messages.

Usage::

    from app.logging_config import get_logger
    log = get_logger(__name__)
    log.info("project shared", extra={"project_id": pid, "size_bytes": n})
"""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import UTC, datetime
from typing import Any, Literal

LogLevelName = Literal["debug", "info", "warning", "error"]
LogFormat = Literal["json", "text", "auto"]

ROOT_LOGGER = "mobsim"

LEVEL_ALIASES: dict[str, LogLevelName] = {
    "debug": "debug",
    "info": "info",
    "log": "info",
    "warning": "warning",
    "warn": "warning",
    "error": "error",
}

_LEVELS = {"debug": logging.DEBUG, "info": logging.INFO, "warning": logging.WARNING, "error": logging.ERROR}

SENSITIVE_KEY = re.compile(r"(token|secret|passw(or)?d|authori[sz]ation|cookie|api[_-]?key|credential)", re.I)
_BEARER = re.compile(r"(bearer\s+)[A-Za-z0-9._~+/=-]+", re.I)
REDACTED = "[REDACTED]"

# Attributes every LogRecord has; anything else came from ``extra=`` and is a structured field.
_RECORD_ATTRS = set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {
    "message",
    "asctime",
    "taskName",
    "color_message",  # uvicorn duplicates its message with ANSI colours
}


def parse_level(value: str | None) -> LogLevelName | None:
    """Normalise a level name (case-insensitive, accepts ``log`` and ``warn``)."""
    if value is None:
        return None
    return LEVEL_ALIASES.get(value.strip().lower())


def effective_level(requested: LogLevelName, environment: str) -> tuple[LogLevelName, bool]:
    """Return the level to use and whether debug was suppressed for production."""
    if environment == "production" and requested == "debug":
        return "info", True
    return requested, False


def redact(value: Any, key: str | None = None) -> Any:
    """Recursively replace values stored under sensitive keys."""
    if key is not None and SENSITIVE_KEY.search(key):
        return REDACTED
    if isinstance(value, dict):
        return {k: redact(v, str(k)) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [redact(v) for v in value]
    if isinstance(value, str):
        return _BEARER.sub(r"\1" + REDACTED, value)
    return value


def _fields(record: logging.LogRecord) -> dict[str, Any]:
    return {k: redact(v, k) for k, v in vars(record).items() if k not in _RECORD_ATTRS and not k.startswith("_")}


def _timestamp(record: logging.LogRecord) -> str:
    return datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class JsonFormatter(logging.Formatter):
    """One JSON object per line: ts, level, logger, msg, structured fields, exception."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": _timestamp(record),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": redact(record.getMessage()),
            **_fields(record),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    """Readable line: ``2026-10-19T17:00:00.123Z INFO  mobsim.api  message key=value``."""

    def format(self, record: logging.LogRecord) -> str:
        fields = " ".join(f"{k}={json.dumps(v, default=str, ensure_ascii=False)}" for k, v in _fields(record).items())
        line = f"{_timestamp(record)} {record.levelname:<7} {record.name}  {redact(record.getMessage())}"
        if fields:
            line = f"{line}  {fields}"
        if record.exc_info:
            line = f"{line}\n{self.formatException(record.exc_info)}"
        return line


def configure_logging(level: LogLevelName, fmt: LogFormat, environment: str) -> LogLevelName:
    """Configure the ``mobsim`` and uvicorn loggers. Safe to call more than once."""
    used, suppressed = effective_level(level, environment)
    resolved_fmt = ("json" if environment == "production" else "text") if fmt == "auto" else fmt
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter() if resolved_fmt == "json" else TextFormatter())
    handler.set_name("mobsim")

    for name in (ROOT_LOGGER, "uvicorn", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers = [h for h in logger.handlers if h.get_name() != "mobsim"]
        logger.addHandler(handler)
        logger.setLevel(_LEVELS[used])
        logger.propagate = False
    # Requests are logged once by RequestLoggingMiddleware (without query strings).
    logging.getLogger("uvicorn.access").disabled = True

    log = get_logger("logging")
    if suppressed:
        log.warning("debug logging is disabled in production; using info", extra={"requested_level": level})
    log.debug("logging configured", extra={"level": used, "format": resolved_fmt})
    return used


def get_logger(name: str) -> logging.Logger:
    """Logger under the ``mobsim`` namespace (``app.api.projects`` → ``mobsim.api.projects``)."""
    short = name.removeprefix("app.").removeprefix(ROOT_LOGGER + ".")
    return logging.getLogger(f"{ROOT_LOGGER}.{short}" if short and short != ROOT_LOGGER else ROOT_LOGGER)
