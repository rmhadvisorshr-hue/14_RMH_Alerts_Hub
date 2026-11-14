import datetime as dt

import modules as m
from events import dsc_event, expiry_status

TODAY = dt.date(2026, 11, 14)
REC = {"serial_number": "ABC1", "holder_name": "Asha Traders", "issuer": "eMudhra", "box_slot": "B2-S4", "expiry_date": TODAY + dt.timedelta(days=7),
       "client_phone": "9999999999", "status": "In Office", "notes": ""}


def rec(days, serial="ABC1"):
    return {**REC, "serial_number": serial, "expiry_date": TODAY + dt.timedelta(days=days)}


def test_expiry_status_is_the_single_rule():
    assert [expiry_status(d) for d in (-1, 0, 30, 31)] == ["Expired", "Expiring Soon", "Expiring Soon", "Active"]


def test_dsc_event_shape_matches_notice_alert_events():
    e = dsc_event(REC, TODAY)
    assert (e["module"], e["event_type"], e["status"], e["days_left"], e["event_date"]) == ("DSC", "expiry", "Pending", 7, "2026-11-21")
    assert e["id"] == "dsc:ABC1" and e["customer_name"] == "Asha Traders" and e["box_slot"] == "B2-S4"


def test_expired_dsc_event_is_overdue_and_labelled_expired():
    e = dsc_event(rec(-3), TODAY)
    assert (e["status"], e["status_label"], e["days_left"]) == ("Overdue", "Expired", -3)


def test_defaults_enable_everything_and_keep_old_dsc_schedule():
    p = m.default_prefs()
    assert all(p["modules"].values()) and p["reminder_days"]["dsc"] == [30, 7, 1, 0] and p["reminder_days"]["gst"] == [15, 10, 5, 1]


def test_merge_prefs_ignores_unknown_and_unsupported():
    p = m.merge_prefs({"modules": {"gst": False, "bogus": True}, "reminder_days": {"gst": [15, 30], "dsc": [5, 30]}})
    assert p["modules"]["gst"] is False and "bogus" not in p["modules"]
    assert p["reminder_days"]["gst"] == [15] and p["reminder_days"]["dsc"] == [30, 5]


def test_validate_prefs_rejects_unsupported_interval_and_unknown_module():
    assert "30" in m.validate_prefs({}, {"gst": [30]})
    assert m.validate_prefs({"nope": True}, {}) and m.validate_prefs({"gst": "yes"}, {})
    assert m.validate_prefs({"gst": False}, {"dsc": [30, 0]}) is None


def test_disabling_a_module_stops_its_push_but_not_others():
    p = m.merge_prefs({"modules": {"gst": False}})
    assert m.wants_push(p, "gst", "new_notice", None) == (False, "module_disabled")
    assert m.wants_push(p, "income_tax", "new_notice", None)[0] is True


def test_reminder_push_follows_selected_intervals():
    p = m.merge_prefs({"reminder_days": {"dsc": [7]}})
    assert m.wants_push(p, "dsc", "reminder", 7)[0] is True
    assert m.wants_push(p, "dsc", "reminder", 30) == (False, "interval_not_selected")
    assert m.wants_push(p, "dsc", "expired", None)[0] is True  # not an interval reminder


def test_wanted_offsets_union_of_enabled_users_only():
    a = m.merge_prefs({"reminder_days": {"dsc": [30]}})
    b = m.merge_prefs({"reminder_days": {"dsc": [1]}, "modules": {"dsc": False}})
    assert m.wanted_offsets([a, b], "dsc") == {30}


def test_dsc_reminders_fire_on_selected_offsets_and_expired_day():
    rows = [rec(30, "A"), rec(7, "B"), rec(1, "C"), rec(0, "D"), rec(-1, "E"), rec(5, "F")]
    got = {r["record_id"]: r for r in m.dsc_reminders(rows, TODAY, {30, 7, 1, 0})}
    assert set(got) == {"A", "B", "C", "D", "E"}  # F (5 days) was not selected
    assert got["C"]["title"] == "DSC expires tomorrow" and got["C"]["urgent"] and got["D"]["title"] == "DSC expires today"
    assert got["E"]["category"] == "expired" and got["A"]["urgent"] is False


def test_dsc_reminder_dedupe_key_is_stable_and_tied_to_expiry_date():
    a = m.dsc_reminders([rec(7)], TODAY, {7})[0]["dedupe_key"]
    assert a == m.dsc_reminders([rec(7)], TODAY, {7})[0]["dedupe_key"]  # re-running the job creates nothing new
    renewed = {**rec(7), "expiry_date": TODAY + dt.timedelta(days=7 + 365)}
    assert m.dsc_reminders([renewed], TODAY + dt.timedelta(days=365), {7})[0]["dedupe_key"] != a  # a renewal re-arms
