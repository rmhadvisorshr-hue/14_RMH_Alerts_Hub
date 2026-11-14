# RMH Alerts Hub - architecture

```
Notice Alert System (Income Tax, GST)  ─┐  server-to-server, one service account (cloud_api/na_client.py)
DSC Tracker data (dsc_records, Neon)   ─┴─►  cloud_api  ─►  FCM  ─►  RMH Advisors mobile app (mobile/ + android/)
```

The phone talks **only** to `cloud_api`. Notice Alert keeps its own database, users and web app; the Hub reads its
calendar events and notifications over HTTP and never writes to it. DSC data stays in `dsc_records` (one source of truth,
one expiry rule: `events.expiry_status`).

## cloud_api files
| File | Role |
|---|---|
| `main.py` | login, DSC records (`/records*`), app wiring - behaviour unchanged |
| `core.py` | env config, DB connection, bearer auth, cron secret, Firebase init |
| `modules.py` | module registry (`income_tax`, `gst`, `dsc`), preference rules, DSC reminder planning (pure, tested) |
| `events.py` | DSC certificate -> calendar event |
| `na_client.py` | Notice Alert client (sign-in, events, notifications, status) |
| `hub.py` | unified calendar, notification store, preferences, devices, push dispatch |

## API (all bearer-token except `/health`, `/auth/login`, and `send-daily` which uses `CRON_SECRET`)
| Endpoint | Purpose |
|---|---|
| `GET /calendar/events?from&to&module&client&status&type&q` | every module's events (Notice Alert's event shape + `DSC`), filtered server-side (AND). Each event has `module` (source code IT/GST/SUB/DSC), `app_module`, `event_type` (issue, response_due, hearing, limitation, submission, expiry), `event_date`, `status`, `record_ref` ({type: notice/submission/dsc, id}); response also has `sources` (per-module connection status) and `today` |
| `GET /modules` | registry, per-user switch and reminder days, supported intervals, connection status |
| `GET /notifications?status&module&category&limit&offset` | history with per-user read state, `record_available` |
| `GET /notifications/unread-count`, `POST /notifications/{id}/read`, `POST /notifications/read-all` | read/unread |
| `POST /notifications/refresh` | pull Notice Alert now (app open; throttled 60 s) |
| `GET/PUT /preferences` | per-user module switches and reminder days, validated against what each module can produce |
| `GET /devices`, `DELETE /devices/{id}`, `POST /devices/register`, `POST /devices/unregister` | device management (tokens are tied to the login) |
| `POST /notifications/send-daily` | cron: create DSC reminders, ingest Notice Alert notifications, dispatch pushes |
| `POST /notifications/test` | test push to the caller's own devices |
| `GET /auth/me` | account |

New tables (created automatically, additive): `hub_notifications`, `notification_reads`, `notification_prefs`,
`notification_deliveries`; `device_tokens` gains `id`, `user_email`, `created_at`. Existing phones are adopted by the shared login.

## Rules the code enforces
- A module switch / reminder interval only affects **push delivery**. Events stay on the calendar and notifications stay in history.
- Pushes are sent once per (notification, device), only for notifications < 36 h old and created after the device registered; skips are logged in `notification_deliveries` with a reason.
- DSC reminders: one per (serial, expiry date, interval) - a renewal re-arms them. Intervals the user selected only; "expired" fires the day after expiry.
- Notice Alert's reminder engine is **not** duplicated: its notifications are ingested as-is (15/10/5/1-day milestones), so those are the only intervals selectable for Income Tax and GST.

## Configuration (cloud_api environment)
Existing: `DATABASE_URL`, `JWT_SECRET`, `APP_USER_EMAIL`, `APP_USER_PASSWORD`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `CRON_SECRET`.
New: `NOTICE_ALERT_API_URL`, `NOTICE_ALERT_EMAIL`, `NOTICE_ALERT_PASSWORD` - a dedicated Notice Alert user for the Hub. Unset = Income Tax/GST show as "not connected" in the app (DSC keeps working).
The Notice Alert backend must be reachable from the Hub (it is not deployed anywhere this repo knows about).

## Adding a future module
1. Add an entry to `MODULES` in `modules.py` (label, source, `reminder_days`, defaults).
2. Provide events (`/calendar/events`) and notifications (`_store` in `hub.py`) for it.
3. Add its event code to `MODULES` in `mobile/src/lib/calendarUi.js`.
The preferences screen, module list and notification filters are driven by the registry / API.

## Tests
`cd cloud_api && pip install -r requirements.txt pytest && pytest` · `cd mobile && npm test`
