"""The Alerts Hub: unified calendar, notification store, per-user preferences, device management and push delivery.

    Notice Alert (IT/GST)  ─┐   na_client (server-to-server, service account)
    dsc_records (this DB)  ─┴─► Hub ─► hub_notifications ─► FCM (per-user prefs, per-device delivery log) ─► phone
"""
import datetime as dt
import json
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from firebase_admin import messaging
from pydantic import BaseModel

import na_client
from core import USER_EMAIL, current_user, cron_auth, db, fcm, today_ist
from events import STATUSES, dsc_event, filter_events, record_ref
from modules import (CATEGORIES, EVENT_MODULE, MODULES, NA_MODULE, dsc_reminders, merge_prefs, validate_prefs, wanted_offsets,
                     wants_push)

router = APIRouter()
PUSH_WINDOW_HOURS = 36  # only recent notifications are pushed, so a backlog or a newly installed phone never gets a blast
REFRESH_MIN_SECONDS = 60

SCHEMA = [
    """ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS id bigserial""",
    """CREATE UNIQUE INDEX IF NOT EXISTS device_tokens_id_key ON device_tokens (id)""",
    """ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS user_email text NOT NULL DEFAULT ''""",
    """ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()""",
    # the app had one shared login before devices were tied to a user: adopt those phones for that login
    # (parameterised in init_schema)
    """CREATE TABLE IF NOT EXISTS hub_notifications (
        id bigserial PRIMARY KEY, dedupe_key text NOT NULL UNIQUE, source text NOT NULL, module text NOT NULL,
        category text NOT NULL, milestone int, urgent boolean NOT NULL DEFAULT false, title text NOT NULL, body text NOT NULL DEFAULT '',
        record_type text NOT NULL DEFAULT '', record_id text NOT NULL DEFAULT '', event_date date,
        payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now())""",
    """CREATE INDEX IF NOT EXISTS hub_notifications_created ON hub_notifications (created_at DESC, id DESC)""",
    """CREATE TABLE IF NOT EXISTS notification_reads (
        user_email text NOT NULL, notification_id bigint NOT NULL REFERENCES hub_notifications(id) ON DELETE CASCADE,
        read_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_email, notification_id))""",
    """CREATE TABLE IF NOT EXISTS notification_prefs (
        user_email text PRIMARY KEY, modules jsonb NOT NULL DEFAULT '{}', reminder_days jsonb NOT NULL DEFAULT '{}',
        updated_at timestamptz NOT NULL DEFAULT now())""",
    """CREATE TABLE IF NOT EXISTS notification_deliveries (
        notification_id bigint NOT NULL REFERENCES hub_notifications(id) ON DELETE CASCADE, device_id bigint NOT NULL,
        status text NOT NULL, reason text NOT NULL DEFAULT '', at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (notification_id, device_id))""",
]


def init_schema(c) -> None:
    for stmt in SCHEMA:
        c.execute(stmt)
    c.execute("UPDATE device_tokens SET user_email=%s WHERE user_email=''", (USER_EMAIL,))


def _iso(v):
    return v.isoformat() if v is not None else None


# ---------------------------------------------------------------- registry, account
@router.get("/auth/me")
def me(user: str = Depends(current_user)):
    return {"email": user}


@router.get("/modules")
def modules(user: str = Depends(current_user)):
    na = na_client.cached("status", na_client.status)
    with db() as c:
        row = c.execute("SELECT * FROM notification_prefs WHERE user_email=%s", (user,)).fetchone()
    prefs = merge_prefs(row)
    return {"modules": [{
        "id": mid, "label": m["label"], "source": m["source"], "notifications_enabled": prefs["modules"][mid],
        "reminder_days": prefs["reminder_days"][mid], "supported_reminder_days": m["reminder_days"],
        "connection": {"status": "ok", "message": ""} if m["source"] == "DSC Tracker" else na,
    } for mid, m in MODULES.items()],
        "sources": [{"name": "DSC Tracker", "status": "ok", "message": ""}, {"name": "Notice Alert System", **na}]}


# ---------------------------------------------------------------- calendar
@router.get("/calendar/events")
def calendar_events(frm: str | None = Query(None, alias="from"), to: str | None = None, module: str | None = None,
                    client: str | None = None, status: str | None = None, type: str | None = None, q: str | None = None,
                    user: str = Depends(current_user)):
    """Every module's events in Notice Alert's event shape, optionally filtered (module, client, status, type, q, from, to). `app_module` is the Hub module id; `sources` says, per module,
    whether its data could be loaded (so an unconfigured/unreachable source is visible, never silently empty)."""
    for v in (frm, to):
        if v:
            try:
                dt.date.fromisoformat(v)
            except ValueError:
                raise HTTPException(400, "from/to must be YYYY-MM-DD")
    if module is not None and module not in MODULES:
        raise HTTPException(400, f"module must be one of: {', '.join(MODULES)}")
    if status is not None and status not in STATUSES:
        raise HTTPException(400, f"status must be one of: {', '.join(STATUSES)}")
    today = today_ist()
    with db() as c:
        rows = c.execute("SELECT * FROM dsc_records WHERE (%s::date IS NULL OR expiry_date >= %s::date) "
                         "AND (%s::date IS NULL OR expiry_date <= %s::date)", (frm, frm, to, to)).fetchall()
    events = [dsc_event(r, today) for r in rows]
    sources = {"dsc": {"status": "ok", "message": ""}}
    try:
        events += na_client.events(frm, to)
        sources["income_tax"] = sources["gst"] = {"status": "ok", "message": ""}
    except na_client.NaError as e:
        sources["income_tax"] = sources["gst"] = {"status": e.status, "message": e.message}
    for e in events:
        e["app_module"] = EVENT_MODULE.get(e["module"], e["module"].lower())
        e["record_ref"] = record_ref(e)
    events = filter_events(events, module=module, client=client, status=status, etype=type, q=q)
    events.sort(key=lambda e: (e["event_date"], e["title"]))
    return {"events": events, "sources": sources, "today": today.isoformat()}


# ---------------------------------------------------------------- notifications
def _shape(r: dict) -> dict:
    return {"id": r["id"], "module": r["module"], "category": r["category"], "milestone": r["milestone"], "urgent": r["urgent"],
            "title": r["title"], "body": r["body"], "record_type": r["record_type"], "record_id": r["record_id"],
            "event_date": _iso(r["event_date"]), "payload": r["payload"], "created_at": _iso(r["created_at"]),
            "is_read": r["is_read"], "record_available": r["record_available"]}


@router.get("/notifications")
def list_notifications(status: str = "all", module: str | None = None, category: str | None = None,
                       limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0), user: str = Depends(current_user)):
    if status not in ("all", "unread", "read"):
        raise HTTPException(400, "status must be all, unread or read")
    if module is not None and module not in MODULES:
        raise HTTPException(400, "unknown module")
    if category is not None and category not in CATEGORIES:
        raise HTTPException(400, f"category must be one of {', '.join(CATEGORIES)}")
    where = ["(%(module)s::text IS NULL OR n.module = %(module)s)", "(%(category)s::text IS NULL OR n.category = %(category)s)"]
    if status == "unread":
        where.append("r.notification_id IS NULL")
    elif status == "read":
        where.append("r.notification_id IS NOT NULL")
    p = {"u": user, "module": module, "category": category, "limit": limit, "offset": offset}
    frm = ("FROM hub_notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_email=%(u)s "
           "LEFT JOIN dsc_records d ON n.module='dsc' AND d.serial_number=n.record_id AND d.expiry_date=n.event_date ")
    with db() as c:
        total = c.execute(f"SELECT count(*) AS n {frm} WHERE {' AND '.join(where)}", p).fetchone()["n"]
        rows = c.execute(f"SELECT n.*, (r.notification_id IS NOT NULL) AS is_read, "
                         f"CASE WHEN n.module='dsc' THEN d.serial_number IS NOT NULL ELSE NULL END AS record_available "
                         f"{frm} WHERE {' AND '.join(where)} ORDER BY n.created_at DESC, n.id DESC LIMIT %(limit)s OFFSET %(offset)s", p).fetchall()
        unread = _unread(c, user)
    return {"items": [_shape(r) for r in rows], "total": total, "unread": unread}


def _unread(c, user: str) -> dict:
    rows = c.execute("SELECT n.module, count(*) AS n FROM hub_notifications n LEFT JOIN notification_reads r "
                     "ON r.notification_id=n.id AND r.user_email=%s WHERE r.notification_id IS NULL GROUP BY n.module", (user,)).fetchall()
    by = {r["module"]: r["n"] for r in rows}
    return {"total": sum(by.values()), "by_module": by}


@router.get("/notifications/unread-count")
def unread_count(user: str = Depends(current_user)):
    with db() as c:
        return _unread(c, user)


@router.post("/notifications/read-all")
def read_all(module: str | None = None, user: str = Depends(current_user)):
    if module is not None and module not in MODULES:
        raise HTTPException(400, "unknown module")
    with db() as c:
        n = c.execute("INSERT INTO notification_reads (user_email, notification_id) SELECT %s, id FROM hub_notifications "
                      "WHERE (%s::text IS NULL OR module=%s) ON CONFLICT DO NOTHING", (user, module, module)).rowcount
    return {"updated": n}


@router.post("/notifications/{notification_id}/read")
def read_one(notification_id: int, user: str = Depends(current_user)):
    with db() as c:
        if not c.execute("SELECT 1 FROM hub_notifications WHERE id=%s", (notification_id,)).fetchone():
            raise HTTPException(404, "Notification not found")
        c.execute("INSERT INTO notification_reads (user_email, notification_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (user, notification_id))
    return {"id": notification_id, "is_read": True}


# ---------------------------------------------------------------- preferences
class Prefs(BaseModel):
    modules: dict[str, bool] = {}
    reminder_days: dict[str, list[int]] = {}


@router.get("/preferences")
def get_prefs(user: str = Depends(current_user)):
    with db() as c:
        row = c.execute("SELECT * FROM notification_prefs WHERE user_email=%s", (user,)).fetchone()
    return {**merge_prefs(row), "supported_reminder_days": {m: v["reminder_days"] for m, v in MODULES.items()}}


@router.put("/preferences")
def put_prefs(body: Prefs, user: str = Depends(current_user)):
    """Partial update: only the modules / intervals sent are changed. Rejects anything the module cannot honour."""
    err = validate_prefs(body.modules, body.reminder_days)
    if err:
        raise HTTPException(400, err)
    with db() as c:
        row = c.execute("SELECT * FROM notification_prefs WHERE user_email=%s FOR UPDATE", (user,)).fetchone()
        merged = merge_prefs(row)
        merged["modules"].update(body.modules)
        merged["reminder_days"].update({m: sorted(set(d), reverse=True) for m, d in body.reminder_days.items()})
        c.execute("INSERT INTO notification_prefs (user_email, modules, reminder_days) VALUES (%s, %s, %s) "
                  "ON CONFLICT (user_email) DO UPDATE SET modules=EXCLUDED.modules, reminder_days=EXCLUDED.reminder_days, updated_at=now()",
                  (user, json.dumps(merged["modules"]), json.dumps(merged["reminder_days"])))
    return {**merged, "supported_reminder_days": {m: v["reminder_days"] for m, v in MODULES.items()}}


# ---------------------------------------------------------------- devices
class Device(BaseModel):
    fcm_token: str
    device_label: str = ""


@router.post("/devices/register")
def register_device(d: Device, user: str = Depends(current_user)):
    with db() as c:
        row = c.execute("INSERT INTO device_tokens (fcm_token, device_label, user_email) VALUES (%s, %s, %s) "
                        "ON CONFLICT (fcm_token) DO UPDATE SET device_label=EXCLUDED.device_label, user_email=EXCLUDED.user_email, "
                        "updated_at=now() RETURNING id", (d.fcm_token, d.device_label[:100], user)).fetchone()
    return {"registered": True, "id": row["id"]}


@router.post("/devices/unregister")  # called on logout so a logged-out phone stops getting alerts
def unregister_device(d: Device, user: str = Depends(current_user)):
    with db() as c:
        n = c.execute("DELETE FROM device_tokens WHERE fcm_token=%s AND user_email=%s", (d.fcm_token, user)).rowcount
    return {"removed": n}


@router.get("/devices")
def list_devices(user: str = Depends(current_user)):
    with db() as c:
        rows = c.execute("SELECT id, device_label, created_at, updated_at FROM device_tokens WHERE user_email=%s "
                         "ORDER BY updated_at DESC", (user,)).fetchall()
    return [{"id": r["id"], "label": r["device_label"] or "Android device", "registered_at": _iso(r["created_at"]),
             "last_seen": _iso(r["updated_at"])} for r in rows]


@router.delete("/devices/{device_id}")
def remove_device(device_id: int, user: str = Depends(current_user)):
    with db() as c:
        n = c.execute("DELETE FROM device_tokens WHERE id=%s AND user_email=%s", (device_id, user)).rowcount
    if not n:
        raise HTTPException(404, "Device not found")
    return {"removed": n}


# ---------------------------------------------------------------- producing notifications
def _store(c, rows: list[dict]) -> list[int]:
    """Insert notifications that don't exist yet (dedupe_key is unique, so repeats are no-ops). Returns the new ids."""
    ids = []
    for r in rows:
        got = c.execute("INSERT INTO hub_notifications (dedupe_key, source, module, category, milestone, urgent, title, body, record_type, "
                        "record_id, event_date, payload, created_at) VALUES (%(dedupe_key)s, %(source)s, %(module)s, %(category)s, "
                        "%(milestone)s, %(urgent)s, %(title)s, %(body)s, %(record_type)s, %(record_id)s, %(event_date)s, %(payload)s, "
                        "COALESCE(%(created_at)s, now())) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id",
                        {**r, "payload": json.dumps(r["payload"], default=str), "created_at": r.get("created_at")}).fetchone()
        if got:
            ids.append(got["id"])
    return ids


def na_rows(items: list[dict]) -> list[dict]:
    """Notice Alert notifications -> Hub notifications. Notifications of an unknown module are skipped, not guessed."""
    out = []
    for n in items:
        mod = NA_MODULE.get(n.get("module"))
        if mod is None or n.get("kind") not in CATEGORIES:
            continue
        out.append({
            "dedupe_key": f"na:{n['id']}", "source": "notice_alert", "module": mod, "category": n["kind"], "milestone": n.get("milestone"),
            "urgent": n["kind"] == "reminder" and (n.get("milestone") or 99) <= 1, "title": n["title"], "body": n["message"],
            "record_type": "notice", "record_id": n.get("notice_id") or "", "event_date": n.get("due_date"), "created_at": n.get("created_at"),
            "payload": {k: n.get(k) for k in ("notice_id", "client_id", "client_name", "client_ref", "notice_ref", "notice_type",
                                               "period", "issue_date", "due_date")} | {"na_module": n["module"]}})
    return out


def _all_prefs(c) -> dict[str, dict]:
    users = {r["user_email"] for r in c.execute("SELECT user_email FROM device_tokens WHERE user_email<>''")} | {USER_EMAIL}
    stored = {r["user_email"]: r for r in c.execute("SELECT * FROM notification_prefs")}
    return {u: merge_prefs(stored.get(u)) for u in users | set(stored)}


def generate() -> dict:
    """Create today's DSC reminders and pull Notice Alert's notifications. Idempotent."""
    out = {"dsc_created": 0, "notice_alert": "ok", "notice_alert_created": 0}
    with db() as c:
        offsets = wanted_offsets(list(_all_prefs(c).values()), "dsc")
        recs = c.execute("SELECT serial_number, holder_name, box_slot, expiry_date FROM dsc_records").fetchall()
        out["dsc_created"] = len(_store(c, [{**x, "source": "dsc"} for x in dsc_reminders(recs, today_ist(), offsets)]))
    try:
        rows = na_rows(na_client.notifications())
        with db() as c:
            out["notice_alert_created"] = len(_store(c, rows))
    except na_client.NaError as e:
        out["notice_alert"] = e.status
    return out


def _message(token: str, n: dict) -> messaging.Message:
    data = {"notification_id": str(n["id"]), "module": n["module"], "category": n["category"], "record_type": n["record_type"],
            "record_id": n["record_id"]}
    if n["module"] == "dsc":
        data |= {"tab": "expiring", "serial_number": n["record_id"]}  # what app versions before the Hub understand
    return messaging.Message(token=token, notification=messaging.Notification(title=n["title"], body=n["body"]), data=data,
                             android=messaging.AndroidConfig(priority="high"))


def dispatch() -> dict:
    """Send every recent notification to every device that should get it, once. Skips (and records why) the ones the
    owner's preferences exclude. A device registered after a notification was created never receives it."""
    with db() as c:
        devices = c.execute("SELECT id, fcm_token, user_email, created_at FROM device_tokens WHERE user_email<>''").fetchall()
        prefs = _all_prefs(c)
        notes = c.execute("SELECT * FROM hub_notifications WHERE created_at >= now() - make_interval(hours => %s)", (PUSH_WINDOW_HOURS,)).fetchall()
        done = {(r["notification_id"], r["device_id"]) for r in c.execute(
            "SELECT notification_id, device_id FROM notification_deliveries WHERE notification_id = ANY(%s::bigint[])", ([n["id"] for n in notes],))}
    skipped, to_send = [], []
    for n in notes:
        for d in devices:
            if (n["id"], d["id"]) in done or n["created_at"] < d["created_at"]:
                continue
            ok, why = wants_push(prefs[d["user_email"]], n["module"], n["category"], n["milestone"])
            (to_send if ok else skipped).append((n, d, why))
    sent, failed, dead = [], [], set()
    if to_send:
        fcm()
        for i in range(0, len(to_send), 500):  # send_each accepts at most 500 messages
            chunk = to_send[i:i + 500]
            for (n, d, _), r in zip(chunk, messaging.send_each([_message(d["fcm_token"], n) for n, d, _ in chunk])):
                if r.success:
                    sent.append((n["id"], d["id"], "sent", ""))
                elif isinstance(r.exception, (messaging.UnregisteredError, messaging.SenderIdMismatchError)):
                    dead.add(d["id"])  # app uninstalled / token expired
                    failed.append((n["id"], d["id"], "failed", "device_unregistered"))
                # any other error is transient: no row is written, so the next run retries (inside the 36 h window)
    rows = sent + failed + [(n["id"], d["id"], "skipped", why) for n, d, why in skipped]
    with db() as c:
        if rows:
            c.cursor().executemany("INSERT INTO notification_deliveries (notification_id, device_id, status, reason) VALUES (%s,%s,%s,%s) "
                                   "ON CONFLICT DO NOTHING", rows)
        if dead:
            c.cursor().executemany("DELETE FROM device_tokens WHERE id=%s", [(i,) for i in dead])
    return {"devices": len(devices), "sent": len(sent), "skipped": len(skipped), "removed_tokens": len(dead)}


_last_refresh = {"at": 0.0}


@router.post("/notifications/refresh")
def refresh(user: str = Depends(current_user)):
    """Called by the app when it opens: pull Notice Alert now instead of waiting for the daily job. Throttled."""
    if time.time() - _last_refresh["at"] < REFRESH_MIN_SECONDS:
        return {"skipped": "throttled"}
    _last_refresh["at"] = time.time()
    out = generate()
    try:
        out |= dispatch()
    except HTTPException as e:  # push not configured: the in-app notifications are stored regardless
        out["push"] = e.detail
    return out


@router.post("/notifications/send-daily")
def send_daily(_: None = Depends(cron_auth)):
    gen = generate()
    return {"records": gen["dsc_created"], **gen, **dispatch()}


@router.post("/notifications/test")
def send_test(user: str = Depends(current_user)):
    """Push a test message to the caller's own devices (not stored in the history)."""
    fcm()
    with db() as c:
        tokens = [r["fcm_token"] for r in c.execute("SELECT fcm_token FROM device_tokens WHERE user_email=%s", (user,))]
    res = messaging.send_each([messaging.Message(token=t, notification=messaging.Notification(
        title="✅ RMH Alerts test", body="Push notifications are working on this phone."), data={"module": "system"},
        android=messaging.AndroidConfig(priority="high")) for t in tokens]) if tokens else None
    return {"devices": len(tokens), "sent": res.success_count if res else 0}
