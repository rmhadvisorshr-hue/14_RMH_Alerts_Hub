import datetime as dt

import httpx
import pytest
from fastapi.testclient import TestClient

import hub
import na_client
from core import current_user

NA_EVENT = {"id": "ev1", "module": "IT", "event_type": "response_due", "type_label": "Response Due", "event_date": "2026-12-01",
            "title": "Income Tax – Response Due – X", "status": "Pending", "days_left": 17, "notice_id": "n1", "customer_name": "X"}


@pytest.fixture(autouse=True)
def na_env(monkeypatch):
    for k, v in (("NOTICE_ALERT_API_URL", "http://na.test"), ("NOTICE_ALERT_EMAIL", "svc@x"), ("NOTICE_ALERT_PASSWORD", "p")):
        monkeypatch.setenv(k, v)
    na_client.clear_cache()
    na_client._token.update(value="", until=0.0)
    yield
    na_client._transport = None


def mock_na(handler):
    calls = []

    def h(req):
        calls.append(req)
        if req.url.path == "/api/auth/login":
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 900})
        return handler(req)

    na_client._transport = httpx.MockTransport(h)
    return calls


def test_not_configured_is_explicit(monkeypatch):
    monkeypatch.delenv("NOTICE_ALERT_API_URL")
    with pytest.raises(na_client.NaError) as e:
        na_client.events()
    assert e.value.status == "not_configured"
    assert na_client.status()["status"] == "not_configured"


def test_events_log_in_once_and_use_bearer_token():
    calls = mock_na(lambda req: httpx.Response(200, json=[NA_EVENT]))
    assert na_client.events() == [NA_EVENT]
    na_client.clear_cache()
    na_client.events()
    assert [c.url.path for c in calls].count("/api/auth/login") == 1
    assert calls[1].headers["authorization"] == "Bearer tok"


def test_rejected_service_account():
    na_client._transport = httpx.MockTransport(lambda req: httpx.Response(401, json={"error": "no"}))
    with pytest.raises(na_client.NaError) as e:
        na_client.events()
    assert e.value.status == "unauthorized"


def test_unreachable():
    def down(req):
        raise httpx.ConnectError("down")

    na_client._transport = httpx.MockTransport(down)
    with pytest.raises(na_client.NaError) as e:
        na_client.events()
    assert e.value.status == "unreachable"


def test_notifications_pages_until_total():
    def handler(req):
        off = int(req.url.params["offset"])
        return httpx.Response(200, json={"items": [{"id": f"n{off + i}"} for i in range(2)], "total": 4})

    mock_na(handler)
    assert [n["id"] for n in na_client.notifications(limit=2)] == ["n0", "n1", "n2", "n3"]


def test_na_rows_maps_modules_and_skips_unknown():
    items = [{"id": "a", "module": "IT", "kind": "reminder", "milestone": 1, "title": "Notice due tomorrow", "message": "m", "notice_id": "n1",
              "due_date": "2026-12-01", "created_at": "2026-11-14T04:00:00+00:00", "client_name": "X"},
             {"id": "b", "module": "GST", "kind": "new_notice", "milestone": None, "title": "New notice", "message": "m", "notice_id": "n2"},
             {"id": "c", "module": "TDS", "kind": "reminder", "title": "?", "message": "?"}]
    rows = hub.na_rows(items)
    assert [(r["dedupe_key"], r["module"], r["category"], r["urgent"]) for r in rows] == [
        ("na:a", "income_tax", "reminder", True), ("na:b", "gst", "new_notice", False)]
    assert rows[0]["record_id"] == "n1" and rows[0]["payload"]["na_module"] == "IT"


class FakeDb:
    def __init__(self, rows):
        self.rows = rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        return self

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return None


@pytest.fixture
def client():
    import main
    main.app.dependency_overrides[current_user] = lambda: "staff@example.com"
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def dsc_row(days):
    return {"serial_number": "S1", "holder_name": "Asha", "issuer": "", "box_slot": "B1-S1", "client_phone": "", "status": "In Office",
            "notes": "", "expiry_date": dt.date.today() + dt.timedelta(days=days)}


def test_calendar_merges_dsc_and_notice_alert_events(client, monkeypatch):
    monkeypatch.setattr(hub, "db", lambda: FakeDb([dsc_row(5)]))
    mock_na(lambda req: httpx.Response(200, json=[NA_EVENT]))
    body = client.get("/calendar/events").json()
    assert {e["app_module"] for e in body["events"]} == {"dsc", "income_tax"}
    assert body["sources"]["income_tax"]["status"] == "ok"
    assert [e["event_date"] for e in body["events"]] == sorted(e["event_date"] for e in body["events"])


def test_calendar_still_serves_dsc_when_notice_alert_is_down(client, monkeypatch):
    monkeypatch.setattr(hub, "db", lambda: FakeDb([dsc_row(5)]))
    monkeypatch.delenv("NOTICE_ALERT_API_URL")
    body = client.get("/calendar/events").json()
    assert [e["app_module"] for e in body["events"]] == ["dsc"]
    assert body["sources"]["gst"]["status"] == "not_configured" and body["sources"]["dsc"]["status"] == "ok"


def test_calendar_rejects_bad_dates(client):
    assert client.get("/calendar/events?from=nope").status_code == 400


def test_preferences_reject_unsupported_interval(client):
    r = client.put("/preferences", json={"reminder_days": {"gst": [30]}})
    assert r.status_code == 400 and "30" in r.json()["detail"]
    assert client.put("/preferences", json={"modules": {"unknown": False}}).status_code == 400


def test_endpoints_require_login():
    import main
    c = TestClient(main.app)
    for path in ("/calendar/events", "/notifications", "/preferences", "/devices", "/modules"):
        assert c.get(path).status_code in (401, 403), path
    assert c.post("/notifications/send-daily", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_calendar_filters_and_record_refs(client, monkeypatch):
    monkeypatch.setattr(hub, "db", lambda: FakeDb([dsc_row(5)]))
    mock_na(lambda req: httpx.Response(200, json=[NA_EVENT, {**NA_EVENT, "id": "ev2", "module": "GST", "customer_name": "Y", "notice_id": "n2", "notice_ref": "ZZ-9", "status": "Overdue"}]))
    allv = client.get("/calendar/events").json()["events"]
    refs = {e["app_module"]: e["record_ref"] for e in allv}
    assert refs["dsc"] == {"type": "dsc", "id": "S1"} and refs["income_tax"] == {"type": "notice", "id": "n1", "module": "IT"}
    assert [e["id"] for e in client.get("/calendar/events?module=gst").json()["events"]] == ["ev2"]
    assert [e["id"] for e in client.get("/calendar/events?status=Overdue").json()["events"]] == ["ev2"]
    assert [e["id"] for e in client.get("/calendar/events?q=zz-9").json()["events"]] == ["ev2"]
    assert [e["id"] for e in client.get("/calendar/events?client=X").json()["events"]] == ["ev1"]
    assert client.get("/calendar/events?module=nope").status_code == 400 and client.get("/calendar/events?status=Late").status_code == 400


def test_routes_the_app_calls_are_registered():
    import main
    paths = set(main.app.openapi()["paths"])
    for p in ("/calendar/events", "/modules", "/notifications", "/notifications/unread-count", "/notifications/refresh", "/preferences",
              "/devices", "/auth/me", "/records", "/auth/login", "/devices/register", "/notifications/send-daily"):
        assert p in paths, p
