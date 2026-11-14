"""Cloud sync API: FastAPI + Neon Postgres. Run: uvicorn main:app --host 0.0.0.0 --port $PORT
The Neon DATABASE_URL lives only in this service's environment, never in the .exe / .apk.

DSC records + login live here; the unified calendar, notifications, preferences and devices live in hub.py."""
import datetime as dt
import hmac
from contextlib import asynccontextmanager

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

import hub
from core import JWT_SECRET, TOKEN_DAYS, USER_EMAIL, USER_PASSWORD, current_user, db, today_ist
from events import expiry_status

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


@asynccontextmanager
async def lifespan(_app):
    with db() as c:
        c.execute(SCHEMA)
        c.execute(DEVICE_SCHEMA)
        hub.init_schema(c)
    yield


app = FastAPI(title="RMH Alerts Hub API", lifespan=lifespan)
# Bearer-token auth (no cookies), so any origin is safe; the Android webview origin is https://localhost.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(hub.router)


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
    today = today_ist()
    for r in rows:
        d = (r["expiry_date"] - today).days
        r["days_remaining"] = d
        r["expiry_status"] = expiry_status(d)
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
