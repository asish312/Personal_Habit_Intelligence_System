# Personal Habit Intelligence System (PHIS)

**Capture less. Understand more. Build consistency from evidence.**

PHIS is a personal habit and daily-life intelligence system built around iPhone Shortcuts, Apple Health, Google Apps Script and Google Sheets. It records daily inputs, validates and deduplicates them, calculates trends, produces optional AI reviews, sends configured notifications and answers questions against recorded history.

> **Current implementation status:** Apps Script engine and synthetic preflight harness are included. The Google Sheet, Apps Script deployment, iPhone Shortcut, Apple Health permissions, model API and push credentials must be configured by the owner. A committed source file is not a live deployment.

## Architecture

\`\`\`mermaid
flowchart TD
  A["iPhone / Apple Health / manual capture"] --> B["iOS Shortcut JSON"]
  B --> C["Apps Script Web App"]
  C --> D["Validation + idempotent daily upsert"]
  D --> E[("RAW — canonical daily records")]
  E --> F["Analytics engine"]
  F --> G[("ANALYTICS — derived metrics")]
  F --> H["Optional LLM daily review"]
  H --> I[("MEMORY — AI summaries")]
  F --> J["Threshold notification"]
  E --> K["Natural-language Q&A"]
  G --> K
  I --> K
  L["CONFIG + Script Properties"] --> F
  L --> H
  L --> J
\`\`\`

## Repository contents

| File | Purpose |
|---|---|
| \`PHIS_Engine_v1.0.0.gs\` | Apps Script API, workbook setup, ingestion, analytics, review, Q&A and alerts |
| \`PHIS_Preflight_Tests_v1.0.0.gs\` | Synthetic disposable-spreadsheet regression tests |
| \`README.md\` | Architecture, deployment and operating guide |
| \`docs/DATA_CONTRACT.md\` | Field definitions and metric semantics |
| \`docs/IOS_SHORTCUT_IMPLEMENTATION.md\` | Capture payload and Shortcut build steps |
| \`docs/ANALYTICS_SPEC.md\` | Dashboard and metric definitions |
| \`docs/OPERATIONS.md\` | Deployment, security, testing and troubleshooting |

## Workbook

Run \`setupPHISWorkbook()\` once in Apps Script. It creates and validates:

- **RAW** — canonical daily records; one row per date, append on first capture and update on subsequent capture.
- **ANALYTICS** — computed values only; never a manual input surface.
- **MEMORY** — AI-generated summaries and scores, kept separate from measured facts.
- **CONFIG** — targets and feature flags.
- **AUDIT_LOG** — system actions and ingestion outcomes.
- **HABIT_MASTER** — habit definitions, cadence, schedule and targets.
- **HABIT_LOG** — one status per habit per date; corrections update the existing key.
- **HABIT_ANALYTICS** — per-habit adherence, status counts and streak snapshots.
- **DASHBOARD** — KPI cards and automatically refreshed trend charts.

Daily measurements and subjective fields remain one summary record per date. Habit tracking has a separate Habit Master + Habit Log model, allowing per-habit analysis without inferring individual completion from aggregate daily totals. Missing scheduled logs count as not reported, not missed; skipped and missed remain distinct.

## Install

1. Create a private Google Sheet for PHIS.
2. Open **Extensions → Apps Script**.
3. Add \`PHIS_Engine_v1.0.0.gs\` and \`PHIS_Preflight_Tests_v1.0.0.gs\`.
4. In Apps Script Project Settings → Script Properties set \`SPREADSHEET_ID\` to the Sheet ID (optional when bound to the target workbook).
5. Run \`setupPHISWorkbook()\` and approve the requested Google permissions.
6. Run \`phisValidateWorkbook()\` and then \`PHIS_RUN_ALL_PREFLIGHT_TESTS()\`. Tests use a disposable synthetic spreadsheet.
7. Deploy → New deployment → Web app. Execute as yourself; choose access appropriate for the Shortcut and security model. Copy the \`/exec\` URL.
8. Set a long random \`WEB_APP_SECRET\` in Script Properties before using the API. All POST operations fail closed until it is configured. Do not put secrets in this repository.
9. Configure an LLM only when ready: Script Properties \`LLM_API_KEY\`, \`LLM_ENDPOINT\`; Config values \`LLM_MODEL\` and \`LLM_ENDPOINT\`. The provider endpoint must be OpenAI-compatible Chat Completions.
10. Configure Pushover Script Properties \`PUSHOVER_APP_TOKEN\` and \`PUSHOVER_USER_KEY\`; set \`NOTIFICATIONS_ENABLED\` to TRUE only after testing.
11. Run \`setupPHISTriggers()\` to install the daily 6 AM project-timezone trigger.
12. Deploy a new Web App version after every code change; saving Apps Script source does not update an existing deployment.

## API

### Health

\`GET /exec?action=health\`

### Submit or update a daily record

\`POST /exec\` with JSON content type:

\`\`\`json
{
  "date": "2026-06-25",
  "sleep_hours": 6.4,
  "resting_hr": 58,
  "hrv": 42,
  "steps": 8200,
  "exercise_min": 30,
  "screen_min": 310,
  "habits_done": 5,
  "habits_total": 7,
  "discipline": 3,
  "source": "ios-shortcut"
}
\`\`\`

Same date + same payload is an idempotent no-op. Same date + changed payload updates that date's row. Individual habit events upsert by date + habit ID. The model prevents duplicate daily captures while allowing corrections. It is not an immutable event ledger: edits are allowed and audit events record the operation.

### Retrieve the habit catalogue

POST `{"action":"habit_list"}` to retrieve active habit definitions for a Shortcut selector. Use `{"action":"habit_list","include_archived":true}` only for history or administration.

### Create or update a habit

POST this action to the web app and include the configured shared secret in the JSON body:

```json
{
  "action": "habit_upsert",
  "habit": {
    "habit_name": "Morning walk",
    "category": "Movement",
    "cadence": "weekdays",
    "start_date": "2026-06-25",
    "target_value": 20,
    "unit": "minutes",
    "preferred_time": "07:00"
  }
}
```

The response returns a stable `habit_id`. Retain that ID in the Shortcut. Partial updates preserve omitted settings. An archived habit is excluded from the active catalogue and cannot receive events after its end date. Supported cadence values: `daily`, `weekdays`, `weekends`, `weekly` and `custom`. For weekly/custom schedules, `schedule_days` is a comma-separated list using Sunday=0 through Saturday=6. Archive a habit with `{"action":"habit_archive","habit_id":"..."}`.

### Submit per-habit statuses

Include a `habits` array in the daily capture:

```json
{
  "date": "2026-06-25",
  "habits_done": 2,
  "habits_total": 3,
  "habits": [
    {"habit_id": "YOUR_HABIT_ID", "status": "done", "value": 25, "duration_min": 25},
    {"habit_id": "ANOTHER_HABIT_ID", "status": "partial", "value": 10, "notes": "Shortened session"},
    {"habit_id": "THIRD_HABIT_ID", "status": "skipped", "notes": "Travel day"}
  ]
}
```

Valid statuses are `done`, `partial`, `skipped`, `missed` and `not_reported`. Partial completion earns half credit for adherence; streaks require `done`. A missing row for a scheduled date is counted as not reported. The daily aggregate fields remain useful for quick capture but are not used to fabricate individual habit history.

### Ask a question

\`\`\`json
{"question":"What is my current completion streak?"}
\`\`\`

Q&A uses a configured model provider when available. Without provider credentials, a limited rule-based response is returned; arbitrary natural-language reasoning is not available offline.

## Security and privacy

- Keep the spreadsheet private. Health and behaviour history is sensitive personal data.
- Never commit API keys, web app secrets, push tokens, spreadsheet IDs or personal exports.
- Set \`WEB_APP_SECRET\` before use. All POST routes require it; only the non-sensitive GET health check is public.
- Apps Script web apps do not provide a general custom-header authentication mechanism through simple Shortcuts requests. The implementation requires a shared secret in every POST JSON payload; the endpoint returns an error until it is configured. Treat the URL and secret as credentials and rotate them if exposed.
- The AI provider receives only the context sent in requests. Review its retention and privacy terms before enabling it.
- AI calorie/macronutrient estimates are uncertain and should not be treated as clinical measurements.

## Known limitations

- The first release includes per-habit tracking and a Google Sheets dashboard, but does not include an app-native interactive web interface.
- Apple Health collection and the iOS Shortcut are documented integration steps, not importable or installed assets in this repository.
- Notification delivery requires Pushover credentials and is off by default.
- AI review and Q&A require a compatible provider endpoint, API key and model.
- Correlations are descriptive, sample-size gated and not proof of causation.
- Apps Script time triggers execute near the configured hour, not at an exact guaranteed minute.

## Development

Use fictional test values only. Run \`PHIS_RUN_ALL_PREFLIGHT_TESTS()\` in Apps Script. Inspect execution logs and verify temporary test spreadsheet cleanup. Validate the production workbook schema before deploying.

## License

No license has been added. All rights remain with the repository owner unless a license is explicitly published.
