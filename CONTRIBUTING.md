# Contributing

- Read docs/ARCHITECTURE.md and docs/DATA_CONTRACT.md first.
- Keep each responsibility in its PHIS_*.gs module.
- Apps Script files share one global scope; function names must be unique.
- Keep doGet/doPost thin and validate before writes.
- Use storage helpers and batch range operations.
- Preserve unknown, skipped, missed and not_reported as distinct states.
- Never commit secrets, spreadsheet IDs, exports or .clasp.json.
- Add synthetic preflight coverage for create, replay, correction and invalid input.
- Run npm run check:syntax and PHIS_RUN_ALL_PREFLIGHT_TESTS() before release.
