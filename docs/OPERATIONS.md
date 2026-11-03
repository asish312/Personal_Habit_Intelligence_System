# PHIS Operations Runbook

## Initial setup

1. Create a private Google Sheet.
2. Add the Apps Script engine and preflight source files.
3. Set \`SPREADSHEET_ID\` in Script Properties or bind the script to the Sheet.
4. Run \`setupPHISWorkbook()\`.
5. Run \`phisValidateWorkbook()\`.
6. Run \`PHIS_RUN_ALL_PREFLIGHT_TESTS()\` and confirm all tests pass and the temporary spreadsheet is removed.
7. Deploy the web app and secure the endpoint.
8. Configure integrations only after their credentials and privacy terms are reviewed.
9. Run \`setupPHISTriggers()\` after the daily workflow is tested manually.

## Script Properties

| Name | Required for | Notes |
|---|---|---|
| SPREADSHEET_ID | Standalone script | Optional for bound scripts |
| WEB_APP_SECRET | Required for all POST routes | Use a long random value; the API fails closed until configured; never commit it |
| LLM_API_KEY | AI review / model Q&A | Stored only in Script Properties |
| LLM_ENDPOINT | AI review / model Q&A | OpenAI-compatible Chat Completions URL |
| PUSHOVER_APP_TOKEN | Push notifications | Optional |
| PUSHOVER_USER_KEY | Push notifications | Optional |

Config values:
- \`LLM_MODEL\`, \`LLM_ENDPOINT\`
- \`DAILY_REVIEW_ENABLED\` (default false)
- \`NOTIFICATIONS_ENABLED\` (default false)
- target values, completion threshold, timezone and correlation sample minimum.
- Read active habit definitions using `habit_list`; create/update using `habit_upsert`; archive using `habit_archive`. Partial upserts preserve omitted settings.
- DASHBOARD refreshes after each successful daily capture and during `runDailyJob()`.

## Daily operations

- Ingestion returns created, updated or unchanged.
- Daily analytics run after data exists.
- AI review is skipped until configured.
- Notifications remain disabled until explicitly enabled and credentials are configured.
- Review AUDIT_LOG after errors or repeated updates.
- Verify that the current Apps Script deployment points to the desired source revision.

## Troubleshooting

**Missing RAW sheet:** run \`setupPHISWorkbook()\`.

**Schema mismatch:** do not rename or reorder headers manually. Back up the workbook, compare with PHIS_Engine_v1.0.0.gs and perform a deliberate migration.

**POST disabled / unauthorized:** configure WEB_APP_SECRET in Script Properties and supply the exact value in the JSON body of every POST request. Only GET health is public.

**No AI review:** confirm DAILY_REVIEW_ENABLED is TRUE and LLM_ENDPOINT, LLM_API_KEY and LLM_MODEL are configured.

**No notification:** confirm NOTIFICATIONS_ENABLED is TRUE and both Pushover credentials are present. Delivery is deduplicated by date.

**Duplicate daily captures:** exact same-day retries are no-ops; changed same-day payload updates the record. Habit events upsert by date + habit ID. Check date/timezone formatting if two different dates appear.

**Habit missing from analytics:** confirm its HABIT_MASTER entry, active date range and cadence. Confirm the Shortcut sends its stable habit_id. A scheduled date without a log is shown as not reported, not missed.

**Dashboard stale or missing:** run `refreshPHISDashboard()` manually and verify RAW / ANALYTICS schemas.

## Release discipline

- Run synthetic tests before every deployment.
- Test schema validation and a single synthetic ingestion.
- Never run preflight with live personal records.
- Create a new Apps Script Web App deployment version after modifying source.
- Keep production spreadsheet private and backed up.
