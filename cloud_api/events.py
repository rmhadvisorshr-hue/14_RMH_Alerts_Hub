"""Calendar events. DSC events are derived live from dsc_records (the one source of truth and the one expiry rule);
Income Tax / GST events come from Notice Alert via na_client and keep Notice Alert's own shape and meanings."""
import datetime as dt

EXPIRING_DAYS = 30


def expiry_status(days_remaining: int) -> str:
    """The single DSC expiry rule, used by /records and by the calendar."""
    return "Expired" if days_remaining < 0 else "Expiring Soon" if days_remaining <= EXPIRING_DAYS else "Active"


def dsc_event(r: dict, today: dt.date) -> dict:
    """One DSC certificate -> one calendar event on its expiry date, in the same shape as Notice Alert's events."""
    days = (r["expiry_date"] - today).days
    expired = days < 0
    return {
        "id": f"dsc:{r['serial_number']}", "module": "DSC", "event_type": "expiry", "type_label": "Certificate Expiry",
        "event_date": r["expiry_date"].isoformat(), "title": f"DSC Expiry – {r['holder_name']}",
        "description": "\n".join(x for x in (f"Box/Slot: {r['box_slot']}", f"Issuer: {r['issuer']}" if r.get("issuer") else None,
                                              f"Serial: {r['serial_number']}", r.get("notes") or None) if x),
        "status": "Overdue" if expired else "Pending", "status_label": "Expired" if expired else None, "priority": "Normal",
        "days_left": days, "date_history": [], "notice_id": None, "notice_ref": None, "notice_type": None, "notice_section": None,
        "notice_status": None, "customer_id": None, "customer_name": r["holder_name"], "identifier": r["serial_number"],
        "identifier_label": "Serial no.", "document": {"status": "none", "doc_id": None, "name": None},
        "serial_number": r["serial_number"], "box_slot": r["box_slot"], "client_phone": r.get("client_phone", ""),
        "record_status": r.get("status", ""),
    }


STATUSES = ("Pending", "Overdue", "Completed")
SEARCH_FIELDS = ("title", "customer_name", "notice_ref", "arn", "identifier", "box_slot")


def record_ref(e: dict) -> dict:
    """Where the original record lives, for navigation: a DSC serial, an Income Tax / GST notice, or a GST submission."""
    if e["module"] == "DSC":
        return {"type": "dsc", "id": e["serial_number"]}
    if e["module"] == "SUB":
        return {"type": "submission", "id": e.get("submission_id") or e["id"]}
    return {"type": "notice", "id": e.get("notice_id"), "module": e["module"]}


def filter_events(events: list[dict], *, module: str | None = None, client: str | None = None, status: str | None = None,
                  etype: str | None = None, q: str | None = None) -> list[dict]:
    """Server-side filters (AND). `module` is a Hub module id; `client` matches the customer name exactly;
    `q` searches client, notice reference, ARN, identifier and box/slot, case-insensitively."""
    needle = (q or "").strip().lower()
    return [e for e in events
            if (not module or e["app_module"] == module) and (not client or e.get("customer_name") == client)
            and (not status or e["status"] == status) and (not etype or e["event_type"] == etype)
            and (not needle or any(needle in str(e.get(k) or "").lower() for k in SEARCH_FIELDS))]
