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
| WEB_APP_SECRET | Shared-secret request check | Use a long random value; never commit it |
| LLM_API_KEY | AI review / model Q&A | Stored only in Script Properties |
| LLM_ENDPOINT | AI review / model Q&A | OpenAI-compatible Chat Completions URL |
| PUSHOVER_APP_TOKEN | Push notifications | Optional |
| PUSHOVER_USER_KEY | Push notifications | Optional |

Config values:
- \`LLM_MODEL\`, \`LLM_ENDPOINT\`
- \`DAILY_REVIEW_ENABLED\` (default false)
- \`NOTIFICATIONS_ENABLED\` (default false)
- target values, completion threshold, timezone and correlation sample minimum.

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

**Unauthorized request:** confirm WEB_APP_SECRET is supplied in JSON and exactly matches Script Properties. If no secret is configured, the endpoint does not require it.

**No AI review:** confirm DAILY_REVIEW_ENABLED is TRUE and LLM_ENDPOINT, LLM_API_KEY and LLM_MODEL are configured.

**No notification:** confirm NOTIFICATIONS_ENABLED is TRUE and both Pushover credentials are present. Delivery is deduplicated by date.

**Duplicate daily captures:** exact same-day retries are no-ops; changed same-day payload updates the record. Check date/timezone formatting if two different dates appear.

## Release discipline

- Run synthetic tests before every deployment.
- Test schema validation and a single synthetic ingestion.
- Never run preflight with live personal records.
- Create a new Apps Script Web App deployment version after modifying source.
- Keep production spreadsheet private and backed up.
