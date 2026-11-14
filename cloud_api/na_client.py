"""Server-to-server client for the Notice Alert System API (Income Tax + GST events and notifications).

The Hub signs in as ONE dedicated Notice Alert user (NOTICE_ALERT_EMAIL / NOTICE_ALERT_PASSWORD) and reads that user's
company data; the phone never talks to Notice Alert and never sees these credentials. Nothing is invented: when the
connection is not configured or Notice Alert is unreachable, callers get an explicit status, never sample data.
"""
import os
import threading
import time

import httpx

TIMEOUT = 20
CACHE_SECONDS = 60
_lock = threading.Lock()
_token = {"value": "", "until": 0.0}
_cache: dict[str, tuple[float, object]] = {}
_transport = None  # tests inject httpx.MockTransport here


class NaError(Exception):
    def __init__(self, status: str, message: str):
        super().__init__(message)
        self.status, self.message = status, message  # status: not_configured | unauthorized | unreachable | error


def _cfg() -> tuple[str, str, str]:
    return (os.environ.get("NOTICE_ALERT_API_URL", "").strip().rstrip("/"),
            os.environ.get("NOTICE_ALERT_EMAIL", "").strip(), os.environ.get("NOTICE_ALERT_PASSWORD", ""))


def configured() -> bool:
    return all(_cfg())


def _client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT, transport=_transport)


def _login(c: httpx.Client, base: str, email: str, password: str) -> str:
    r = c.post(f"{base}/api/auth/login", json={"email": email, "password": password, "client": "mobile", "device_label": "RMH Alerts Hub"})
    if r.status_code in (400, 401, 403):
        raise NaError("unauthorized", "Notice Alert rejected the Hub's service account.")
    r.raise_for_status()
    body = r.json()
    _token["value"], _token["until"] = body["access_token"], time.time() + max(30, int(body.get("expires_in", 900)) - 60)
    return _token["value"]


def _get(path: str, params: dict | None = None) -> object:
    base, email, password = _cfg()
    if not (base and email and password):
        raise NaError("not_configured", "NOTICE_ALERT_API_URL, NOTICE_ALERT_EMAIL and NOTICE_ALERT_PASSWORD are not set on the Hub.")
    try:
        with _client() as c, _lock:
            tok = _token["value"] if time.time() < _token["until"] else _login(c, base, email, password)
            r = c.get(f"{base}{path}", params=params, headers={"Authorization": f"Bearer {tok}"})
            if r.status_code == 401:  # token expired/revoked early: sign in once more
                r = c.get(f"{base}{path}", params=params, headers={"Authorization": f"Bearer {_login(c, base, email, password)}"})
            if r.status_code in (401, 403):
                raise NaError("unauthorized", "Notice Alert rejected the Hub's service account.")
            r.raise_for_status()
            return r.json()
    except NaError:
        raise
    except httpx.HTTPStatusError as e:
        raise NaError("error", f"Notice Alert answered {e.response.status_code}.")
    except httpx.HTTPError:
        raise NaError("unreachable", "Notice Alert could not be reached.")


def cached(key: str, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    val = fn()
    _cache[key] = (time.time(), val)
    return val


def clear_cache() -> None:
    _cache.clear()


def events(frm: str | None = None, to: str | None = None) -> list[dict]:
    params = {k: v for k, v in (("from", frm), ("to", to)) if v}
    return cached(f"events:{frm}:{to}", lambda: _get("/api/calendar/events", params))  # type: ignore[return-value]


def notifications(limit: int = 100, max_pages: int = 5) -> list[dict]:
    """Newest first. Pages through up to max_pages * limit items."""
    out: list[dict] = []
    for page in range(max_pages):
        body = _get("/api/notifications", {"status": "all", "limit": limit, "offset": page * limit})
        out += body["items"]  # type: ignore[index]
        if len(out) >= body["total"] or not body["items"]:  # type: ignore[index]
            break
    return out


def status() -> dict:
    """{'status': 'ok'|'not_configured'|..., 'message'} - one cheap authenticated call."""
    if not configured():
        return {"status": "not_configured", "message": NaError("not_configured", "NOTICE_ALERT_API_URL, NOTICE_ALERT_EMAIL and NOTICE_ALERT_PASSWORD are not set on the Hub.").message}
    try:
        _get("/api/notifications/unread-count")
        return {"status": "ok", "message": ""}
    except NaError as e:
        return {"status": e.status, "message": e.message}
