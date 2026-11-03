# PHIS Scalability

## Runtime boundary

PHIS currently uses Apps Script and Google Sheets. Modular source improves maintainability; it does not remove Apps Script execution quotas, trigger limits or spreadsheet limits.

## Safeguards

- Date-keyed daily upsert and date+habit-keyed event upsert.
- Script locking around daily writes.
- Deterministic payload hashes.
- Batched habit event writes where possible.
- Seven-calendar-day rolling windows.
- Correlation and Q&A history should remain bounded.
- AI and push integrations are optional and disabled by default.

## Monitor

Track execution duration, trigger failures, sheet row counts, audit errors and request latency. Consider SQL/Firestore storage when full-sheet scans dominate, multiple writers/users are introduced, retention/access policies become complex, or Apps Script quotas prevent reliable operation.

## Evolution

| Stage | Change | Preserve |
|---|---|---|
| Personal | Google Sheets | API and domain semantics |
| Growing history | Cache lookups and incremental analytics | Stable IDs and metric definitions |
| High volume | SQL/Firestore adapter | Date+ID keys |
| Multi-device | Device identity and conflict policy | Habit identity |
| Rich client | Separate web/mobile client | API contract |

Never silently rename columns. Use explicit schema versions and migrations; back up canonical data and recompute derived sheets after migration.
