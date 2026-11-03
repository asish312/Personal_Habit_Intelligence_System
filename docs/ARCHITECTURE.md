# PHIS Architecture

## Runtime layers

| Layer | Module | Contract |
|---|---|---|
| API | Engine | Authenticate, route, serialize |
| Validation | Validation | Reject invalid input before writes |
| Domain | Habits | Identity, cadence and event semantics |
| Ingestion | Ingestion | Daily record lifecycle |
| Storage | Storage | Google Sheets persistence |
| Analytics | Analytics + Habits | Rebuildable derived metrics |
| Presentation | Dashboard | Reporting only |
| Integrations | AI, Notifications | Optional external providers |
| Scheduling | Scheduler | Daily orchestration |

## Request lifecycle

1. doPost parses and authenticates.
2. Validation checks date, numeric bounds, habit IDs and statuses.
3. Ingestion locks and upserts RAW by local date.
4. Habit events upsert by date + habit ID.
5. Analytics derive snapshots from canonical records.
6. Dashboard refreshes for the latest recorded date.
7. API returns a structured result.

## Extension checklist

1. Define canonical identity and schema.
2. Validate before persistence.
3. Add domain logic in a dedicated module.
4. Use storage helpers rather than writing sheets from API routing.
5. Derive analytics from canonical facts.
6. Add synthetic create/replay/correction/invalid-input tests.
7. Update data contract, API and operations docs.
8. Isolate providers behind adapters and Script Properties.

All .gs files share one global scope; top-level names must be unique.
