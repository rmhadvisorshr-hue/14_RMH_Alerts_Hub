"""Shared plumbing for the Alerts Hub API: config, database, bearer-token auth, Firebase. Imported by main.py and hub.py."""
import datetime as dt
import hmac
import json
import os
from pathlib import Path
from zoneinfo import ZoneInfo

import jwt
import psycopg
from dotenv import load_dotenv
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import credentials, initialize_app
from psycopg.rows import dict_row

load_dotenv()
load_dotenv(Path(__file__).parent.parent / ".env.local")  # written by `neon deploy` (repo root); real env vars win
DATABASE_URL = os.environ["DATABASE_URL"]
JWT_SECRET = os.environ["JWT_SECRET"]
USER_EMAIL = os.environ["APP_USER_EMAIL"].strip().lower()
USER_PASSWORD = os.environ["APP_USER_PASSWORD"]
TOKEN_DAYS = 90  # long-lived so the offline-first desktop app rarely asks to log in again
IST = ZoneInfo("Asia/Kolkata")
bearer = HTTPBearer()


def db():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)  # `with db() as c` commits on exit


def today_ist() -> dt.date:
    return dt.datetime.now(IST).date()


def current_user(cred: HTTPAuthorizationCredentials = Depends(bearer)) -> str:
    try:
        return jwt.decode(cred.credentials, JWT_SECRET, algorithms=["HS256"])["sub"]
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")


def cron_auth(cred: HTTPAuthorizationCredentials = Depends(bearer)) -> None:
    secret = os.environ.get("CRON_SECRET", "")
    if not secret:
        raise HTTPException(503, "CRON_SECRET is not set on the server")
    if not hmac.compare_digest(cred.credentials.encode(), secret.encode()):
        raise HTTPException(401, "Bad cron secret")


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
