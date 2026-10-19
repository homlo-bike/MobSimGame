from __future__ import annotations

import json
import logging
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.logging_config import (
    REDACTED,
    configure_logging,
    effective_level,
    get_logger,
    parse_level,
    redact,
)
from tests.conftest import Upstream


def lines(err: str) -> list[dict[str, object]]:
    return [json.loads(line) for line in err.splitlines() if line.startswith("{")]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("debug", "debug"),
        ("DEBUG", "debug"),
        ("info", "info"),
        ("log", "info"),
        ("warning", "warning"),
        ("warn", "warning"),
        ("error", "error"),
        (" Error ", "error"),
        ("verbose", None),
        (None, None),
    ],
)
def test_parse_level_and_aliases(raw: str | None, expected: str | None) -> None:
    assert parse_level(raw) == expected


def test_settings_level_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOG_LEVEL", "warn")
    assert Settings().log_level == "warning"
    monkeypatch.setenv("MOBSIM_LOG_LEVEL", "error")  # project-specific variable wins
    assert Settings().log_level == "error"
    monkeypatch.setenv("MOBSIM_LOG_LEVEL", "loud")
    with pytest.raises(ValueError, match="Unknown log level"):
        Settings()


def test_debug_is_suppressed_in_production() -> None:
    assert effective_level("debug", "production") == ("info", True)
    assert effective_level("debug", "development") == ("debug", False)
    assert effective_level("warning", "production") == ("warning", False)


def test_minimum_level_filters(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("warning", "json", "development")
    log = get_logger("test")
    log.debug("d")
    log.info("i")
    log.warning("w")
    log.error("e")
    assert [r["level"] for r in lines(capsys.readouterr().err)] == ["warning", "error"]


def test_production_never_emits_debug(capsys: pytest.CaptureFixture[str]) -> None:
    used = configure_logging("debug", "auto", "production")
    assert used == "info"
    get_logger("test").debug("secret internals")
    records = lines(capsys.readouterr().err)  # auto → JSON in production
    assert all(r["level"] != "debug" for r in records)
    assert any("debug logging is disabled in production" in str(r["msg"]) for r in records)


def test_json_format_is_structured(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("debug", "json", "development")
    get_logger("app.api.projects").info("project shared", extra={"project_id": "abc", "size_bytes": 12})
    rec = lines(capsys.readouterr().err)[-1]
    assert rec["level"] == "info"
    assert rec["logger"] == "mobsim.api.projects"
    assert rec["msg"] == "project shared"
    assert rec["project_id"] == "abc"
    assert str(rec["ts"]).endswith("Z")


def test_text_format_is_readable(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("info", "auto", "development")  # auto → text outside production
    get_logger("demo").warning("slow upstream", extra={"host": "example.org"})
    line = capsys.readouterr().err.strip().splitlines()[-1]
    assert " WARNING " in line
    assert "mobsim.demo  slow upstream" in line
    assert 'host="example.org"' in line


def test_sensitive_values_are_redacted(capsys: pytest.CaptureFixture[str]) -> None:
    assert redact({"edit_token": "x", "nested": {"Authorization": "Bearer abc"}, "ok": 1}) == {
        "edit_token": REDACTED,
        "nested": {"Authorization": REDACTED},
        "ok": 1,
    }
    configure_logging("info", "json", "development")
    get_logger("t").info(
        "calling with Bearer abc.def-123", extra={"client_secret": "s3cr3t", "api_key": "k", "host": "h"}
    )
    raw = capsys.readouterr().err
    assert "s3cr3t" not in raw and "abc.def-123" not in raw
    rec = lines(raw)[-1]
    assert rec["client_secret"] == REDACTED and rec["api_key"] == REDACTED and rec["host"] == "h"


def test_configure_is_idempotent(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("info", "json", "development")
    configure_logging("info", "json", "development")
    get_logger("t").info("once")
    assert len([r for r in lines(capsys.readouterr().err) if r["msg"] == "once"]) == 1
    assert len([h for h in logging.getLogger("mobsim").handlers if h.get_name() == "mobsim"]) == 1


def test_request_logging_with_request_id(
    make_client: Callable[[Settings], TestClient], settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    c = make_client(settings.model_copy(update={"log_level": "info", "log_format": "json"}))
    res = c.get("/api/v1/providers?secret_query=hidden")
    assert len(res.headers["x-request-id"]) == 16
    supplied = c.get("/api/v1/providers", headers={"X-Request-ID": "proxy-id-12345"})
    assert supplied.headers["x-request-id"] == "proxy-id-12345"
    bad = c.get("/api/v1/providers", headers={"X-Request-ID": "<script>"})
    assert bad.headers["x-request-id"] != "<script>"
    c.get("/api/health")  # health checks are debug-level: not shown at info
    raw = capsys.readouterr().err
    handled = [r for r in lines(raw) if r["msg"] == "request handled"]
    assert len(handled) == 3
    assert handled[0]["path"] == "/api/v1/providers"
    assert handled[0]["status"] == 200 and isinstance(handled[0]["duration_ms"], float)
    assert "hidden" not in raw  # query strings are never logged
    assert all(r["path"] != "/api/health" for r in handled)


def test_rejected_and_failed_requests_use_higher_levels(
    make_client: Callable[[Settings], TestClient], settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    c = make_client(settings.model_copy(update={"rate_limit_per_minute": 1, "log_format": "json"}))
    c.get("/api/v1/providers")
    c.get("/api/v1/providers")
    rejected = [r for r in lines(capsys.readouterr().err) if r["msg"] == "request rejected"]
    assert rejected and rejected[0]["level"] == "warning" and rejected[0]["status"] == 429


def test_startup_milestone_logged(
    make_client: Callable[[Settings], TestClient], settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    with make_client(settings.model_copy(update={"log_format": "json"})):
        pass
    msgs = [r["msg"] for r in lines(capsys.readouterr().err)]
    assert "API started" in msgs and "API stopped" in msgs


def test_outbound_retries_log_warning_then_error(
    make_client: Callable[[Settings], TestClient],
    settings: Settings,
    upstream: Upstream,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import httpx

    async def no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr("app.providers.base.asyncio.sleep", no_sleep)
    upstream.handlers["nominatim.openstreetmap.org"] = lambda r: httpx.Response(503)
    c = make_client(settings.model_copy(update={"log_format": "json"}))
    c.get("/api/v1/geocode", params={"q": "private search text"})
    records = lines(capsys.readouterr().err)
    retries = [r for r in records if r["msg"] == "outbound request failed; retrying"]
    final = [r for r in records if r["msg"] == "outbound request failed after retries"]
    assert retries and all(r["level"] == "warning" and r["host"] == "nominatim.openstreetmap.org" for r in retries)
    assert final and final[0]["level"] == "error"
    assert not any("private search text" in json.dumps(r) for r in records)
