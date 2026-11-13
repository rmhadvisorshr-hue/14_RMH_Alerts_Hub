"""Cloud sync API: FastAPI + Neon Postgres. Run: uvicorn main:app --host 0.0.0.0 --port $PORT
The Neon DATABASE_URL lives only in this service's environment, never in the .exe / .apk."""
import datetime as dt
import hmac
import json
import os
from pathlib import Path
from contextlib import asynccontextmanager
from zoneinfo import ZoneInfo

import jwt
import psycopg
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import credentials, initialize_app, messaging
from psycopg.rows import dict_row
from pydantic import BaseModel, field_validator

load_dotenv()
load_dotenv(Path(__file__).parent.parent / ".env.local")  # written by `neon deploy` (repo root); real env vars win
DATABASE_URL = os.environ["DATABASE_URL"]
JWT_SECRET = os.environ["JWT_SECRET"]
USER_EMAIL = os.environ["APP_USER_EMAIL"].strip().lower()
USER_PASSWORD = os.environ["APP_USER_PASSWORD"]
TOKEN_DAYS = 90  # long-lived so the offline-first desktop app rarely asks to log in again
EXPIRING_DAYS = 30
ALERT_DAYS = (30, 7, 1, 0)  # push-alert milestones, in days left (IST)
IST = ZoneInfo("Asia/Kolkata")

COLS = ["serial_number", "holder_name", "issuer", "issue_date", "expiry_date",
        "box_slot", "client_phone", "status", "notes"]
SCHEMA = """CREATE TABLE IF NOT EXISTS dsc_records (
    serial_number text PRIMARY KEY, holder_name text NOT NULL, issuer text NOT NULL DEFAULT '',
    issue_date date NOT NULL, expiry_date date NOT NULL, box_slot text NOT NULL,
    client_phone text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'In Office',
    notes text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now())"""
DEVICE_SCHEMA = """CREATE TABLE IF NOT EXISTS device_tokens (
    fcm_token text PRIMARY KEY, device_label text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now())"""
UPSERT = (f"INSERT INTO dsc_records ({','.join(COLS)}) VALUES ({','.join(f'%({c})s' for c in COLS)}) "
          f"ON CONFLICT (serial_number) DO UPDATE SET "
          f"{','.join(f'{c}=EXCLUDED.{c}' for c in COLS[1:])}, updated_at=now()")


def db():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)  # `with db() as c` commits on exit


@asynccontextmanager
async def lifespan(_app):
    with db() as c:
        c.execute(SCHEMA)
        c.execute(DEVICE_SCHEMA)
    yield


app = FastAPI(title="RMH DSC Cloud API", lifespan=lifespan)
# Bearer-token auth (no cookies), so any origin is safe; the Android webview origin is https://localhost.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
bearer = HTTPBearer()


def current_user(cred: HTTPAuthorizationCredentials = Depends(bearer)) -> str:
    try:
        return jwt.decode(cred.credentials, JWT_SECRET, algorithms=["HS256"])["sub"]
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")


class Login(BaseModel):
    email: str
    password: str


class Record(BaseModel):  # extra fields (updated_at, days_remaining, ...) are ignored
    serial_number: str
    holder_name: str
    issuer: str = ""
    issue_date: dt.date
    expiry_date: dt.date
    box_slot: str
    client_phone: str = ""
    status: str = "In Office"
    notes: str = ""

    @field_validator("serial_number")
    @classmethod
    def _serial(cls, v):
        v = v.strip().upper()
        if not v:
            raise ValueError("serial_number required")
        return v

    @field_validator("status")
    @classmethod
    def _status(cls, v):
        if v not in ("In Office", "Handed to Client"):
            raise ValueError("status must be 'In Office' or 'Handed to Client'")
        return v


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/auth/login")
def login(b: Login):
    ok_email = hmac.compare_digest(b.email.strip().lower().encode(), USER_EMAIL.encode())
    ok_pass = hmac.compare_digest(b.password.encode(), USER_PASSWORD.encode())
    if not (ok_email and ok_pass):  # both compared, so timing doesn't reveal which was wrong
        raise HTTPException(401, "Wrong email or password")
    exp = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=TOKEN_DAYS)
    return {"token": jwt.encode({"sub": USER_EMAIL, "exp": exp}, JWT_SECRET, algorithm="HS256"), "email": USER_EMAIL}


@app.get("/records")
def list_records(_: str = Depends(current_user)):
    with db() as c:
        rows = c.execute("SELECT *, updated_at::text AS updated_at FROM dsc_records ORDER BY expiry_date").fetchall()
    today = dt.datetime.now(IST).date()
    for r in rows:
        d = (r["expiry_date"] - today).days
        r["days_remaining"] = d
        r["expiry_status"] = "Expired" if d < 0 else "Expiring Soon" if d <= EXPIRING_DAYS else "Active"
    return rows


@app.post("/records/upsert")
def upsert(body: Record | list[Record], _: str = Depends(current_user)):
    recs = body if isinstance(body, list) else [body]
    if recs:
        with db() as c:
            c.cursor().executemany(UPSERT, [r.model_dump() for r in recs])
    return {"upserted": len(recs)}


@app.delete("/records/{serial_number}")
def delete(serial_number: str, _: str = Depends(current_user)):
    with db() as c:  # idempotent: deleting a missing row is not an error (desktop retries queued deletes)
        n = c.execute("DELETE FROM dsc_records WHERE serial_number=%s", (serial_number.strip().upper(),)).rowcount
    return {"deleted": n}


# ---------------------------------------------------------------- push notifications (FCM)
_fcm_ready = False


def fcm():
    """Initialise firebase-admin once, from the FIREBASE_SERVICE_ACCOUNT_JSON env var (the whole JSON as a string)."""
    global _fcm_ready
    if not _fcm_ready:
        raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
        if not raw:
            raise HTTPException(503, "Push not configured: set FIREBASE_SERVICE_ACCOUNT_JSON")
        try:  # strict=False tolerates real newlines inside the private_key if it was pasted unescaped
            initialize_app(credentials.Certificate(json.loads(raw, strict=False)))
        except Exception as e:
            raise HTTPException(503, f"FIREBASE_SERVICE_ACCOUNT_JSON is invalid: {e}")
        _fcm_ready = True


class Device(BaseModel):
    fcm_token: str
    device_label: str = ""


@app.post("/devices/register")
def register_device(d: Device, _: str = Depends(current_user)):
    with db() as c:
        c.execute("INSERT INTO device_tokens (fcm_token, device_label) VALUES (%s, %s) "
                  "ON CONFLICT (fcm_token) DO UPDATE SET device_label=EXCLUDED.device_label, updated_at=now()",
                  (d.fcm_token, d.device_label[:100]))
    return {"registered": True}


@app.post("/devices/unregister")  # called on logout so a logged-out phone stops getting alerts
def unregister_device(d: Device, _: str = Depends(current_user)):
    with db() as c:
        n = c.execute("DELETE FROM device_tokens WHERE fcm_token=%s", (d.fcm_token,)).rowcount
    return {"removed": n}


def cron_auth(cred: HTTPAuthorizationCredentials = Depends(bearer)) -> None:
    secret = os.environ.get("CRON_SECRET", "")
    if not secret:
        raise HTTPException(503, "CRON_SECRET is not set on the server")
    if not hmac.compare_digest(cred.credentials.encode(), secret.encode()):
        raise HTTPException(401, "Bad cron secret")


def alert_text(days: int) -> str:
    return "🚨 DSC Expires Today!" if days == 0 else "⚠️ DSC Expires Tomorrow" if days == 1 else f"⚠️ DSC Expiring in {days} Days"


def push_all(items: list[tuple[str, str, dict]]) -> dict:
    """Send every (title, body, data) to every registered device; delete tokens FCM says are dead."""
    fcm()
    with db() as c:
        tokens = [r["fcm_token"] for r in c.execute("SELECT fcm_token FROM device_tokens")]
    msgs = [(t, messaging.Message(
        token=t, notification=messaging.Notification(title=title, body=body), data=data,
        android=messaging.AndroidConfig(priority="high")))
        for title, body, data in items for t in tokens]
    sent, dead = 0, set()
    for i in range(0, len(msgs), 500):  # send_each accepts at most 500 messages
        chunk = msgs[i:i + 500]
        for (tok, _), r in zip(chunk, messaging.send_each([m for _, m in chunk])):
            if r.success:
                sent += 1
            elif isinstance(r.exception, (messaging.UnregisteredError, messaging.SenderIdMismatchError)):
                dead.add(tok)  # app uninstalled / token expired
    if dead:
        with db() as c:
            c.cursor().executemany("DELETE FROM device_tokens WHERE fcm_token=%s", [(t,) for t in dead])
    return {"devices": len(tokens), "sent": sent, "removed_tokens": len(dead)}


@app.post("/notifications/send-daily")
def send_daily(_: None = Depends(cron_auth)):
    today = dt.datetime.now(IST).date()
    with db() as c:
        rows = c.execute("SELECT holder_name, box_slot, expiry_date, serial_number FROM dsc_records "
                         "WHERE expiry_date - %s = ANY(%s) ORDER BY expiry_date, holder_name",
                         (today, list(ALERT_DAYS))).fetchall()
    items = [(alert_text((r["expiry_date"] - today).days),
              f"{r['holder_name']} — {r['box_slot']} — expires {r['expiry_date']:%d %b %Y}",
              {"tab": "expiring", "serial_number": r["serial_number"]}) for r in rows]
    return {"records": len(rows), **(push_all(items) if items else {"devices": None, "sent": 0, "removed_tokens": 0})}


@app.post("/notifications/test")
def send_test(_: str = Depends(current_user)):
    return push_all([("✅ DSC Tracker test", "Push notifications are working on this phone.", {"tab": "expiring"})])
