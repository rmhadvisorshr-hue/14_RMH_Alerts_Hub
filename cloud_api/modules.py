"""The registry of RMH modules the Hub knows about, and the pure rules that depend on it (no database, no network).

Adding a future module = add one entry here, then feed the Hub its events (events.py) and/or notifications (hub.py).
Nothing else in the API or the app hard-codes module names.
"""
import datetime as dt

MODULES = {
    "income_tax": {"label": "Income Tax", "source": "Notice Alert System", "event_codes": ["IT"],
                   # Notice Alert's reminder engine creates exactly these milestones (notification_service.MILESTONES)
                   "reminder_days": [15, 10, 5, 1], "default_reminder_days": [15, 10, 5, 1]},
    "gst": {"label": "GST", "source": "Notice Alert System", "event_codes": ["GST", "SUB"],
            "reminder_days": [15, 10, 5, 1], "default_reminder_days": [15, 10, 5, 1]},
    # The Hub itself schedules DSC reminders, so every interval is available. Defaults keep the pre-Hub behaviour.
    "dsc": {"label": "DSC Tracker", "source": "DSC Tracker", "event_codes": ["DSC"],
            "reminder_days": [30, 15, 10, 7, 5, 1, 0], "default_reminder_days": [30, 7, 1, 0]},
}
CATEGORIES = ("reminder", "new_notice", "due_changed", "expired")
EVENT_MODULE = {code: mid for mid, m in MODULES.items() for code in m["event_codes"]}  # 'IT' -> 'income_tax'
NA_MODULE = {"IT": "income_tax", "GST": "gst"}                                          # Notice Alert notification module codes


def default_prefs() -> dict:
    return {"modules": {m: True for m in MODULES},
            "reminder_days": {m: list(v["default_reminder_days"]) for m, v in MODULES.items()}}


def merge_prefs(stored: dict | None) -> dict:
    """Stored preferences over the defaults; unknown modules (removed from the registry) are dropped."""
    out = default_prefs()
    for m, on in ((stored or {}).get("modules") or {}).items():
        if m in out["modules"] and isinstance(on, bool):
            out["modules"][m] = on
    for m, days in ((stored or {}).get("reminder_days") or {}).items():
        if m in out["reminder_days"] and isinstance(days, list):
            out["reminder_days"][m] = sorted({d for d in days if d in MODULES[m]["reminder_days"]}, reverse=True)
    return out


def validate_prefs(modules: dict, reminder_days: dict) -> str | None:
    """An error message for a preferences update that names an unknown module or an interval the module can't produce."""
    for m, on in modules.items():
        if m not in MODULES:
            return f"Unknown module '{m}'."
        if not isinstance(on, bool):
            return f"modules.{m} must be true or false."
    for m, days in reminder_days.items():
        if m not in MODULES:
            return f"Unknown module '{m}'."
        bad = [d for d in days if d not in MODULES[m]["reminder_days"]]
        if bad:
            return f"{MODULES[m]['label']} cannot send reminders {', '.join(map(str, bad))} day(s) before."
    return None


def wants_push(prefs: dict, module: str, category: str, milestone: int | None) -> tuple[bool, str]:
    """Is this notification pushed to a user with these (merged) preferences? Returns (send, skip_reason).
    Module switch first; then, for a reminder, the interval must be one the user chose for that module."""
    if not prefs["modules"].get(module, False):
        return False, "module_disabled"
    if category == "reminder" and milestone is not None and milestone not in prefs["reminder_days"].get(module, []):
        return False, "interval_not_selected"
    return True, ""


def wanted_offsets(all_prefs: list[dict], module: str) -> set[int]:
    """DSC reminder offsets worth creating: any that at least one user has selected for an enabled module."""
    return {d for p in all_prefs if p["modules"].get(module) for d in p["reminder_days"].get(module, [])}


def dsc_reminders(rows: list[dict], today: dt.date, offsets: set[int]) -> list[dict]:
    """Notifications the DSC records need today: one per (certificate, expiry date, milestone). Pure.
    A renewal changes expiry_date, so the new certificate gets its own fresh set. `expired` fires the day after expiry."""
    out = []
    for r in rows:
        days = (r["expiry_date"] - today).days
        base = {"module": "dsc", "record_type": "dsc", "record_id": r["serial_number"], "event_date": r["expiry_date"],
                "payload": {"holder_name": r["holder_name"], "box_slot": r["box_slot"], "expiry_date": r["expiry_date"].isoformat()}}
        key = f"dsc:{r['serial_number']}:{r['expiry_date'].isoformat()}"
        when = f"{r['holder_name']} — {r['box_slot']} — expires {r['expiry_date']:%d %b %Y}"
        if days in offsets:
            title = ("DSC expires today" if days == 0 else "DSC expires tomorrow" if days == 1 else f"DSC expiring in {days} days")
            out.append({**base, "category": "reminder", "milestone": days, "urgent": days <= 1, "dedupe_key": f"{key}:{days}",
                        "title": title, "body": when})
        elif days == -1:
            out.append({**base, "category": "expired", "milestone": None, "urgent": True, "dedupe_key": f"{key}:expired",
                        "title": "DSC has expired", "body": f"{r['holder_name']} — {r['box_slot']} — expired {r['expiry_date']:%d %b %Y}"})
    return out
