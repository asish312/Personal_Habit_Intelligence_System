# PHIS Data Contract v1.0.0

## Storage roles

| Sheet | Contract |
|---|---|
| RAW | Canonical daily record, one record per local calendar date |
| ANALYTICS | Deterministic metrics derived from RAW |
| MEMORY | Optional model-generated interpretation, not source facts |
| CONFIG | User-editable targets and feature flags |
| AUDIT_LOG | Operational outcomes and errors |

## Daily identity and update semantics

- The key is \`date\` in \`YYYY-MM-DD\` using the configured project timezone.
- First valid capture creates one row.
- Identical replay of a date and payload is ignored.
- Changed capture for an existing date updates that date's row.
- The date-level record is not an immutable event log; system changes are recorded in AUDIT_LOG.
- Empty/missing fields mean unknown or not captured, never automatically zero or missed.

## Measurements and self-reports

- Apple Health fields are measurements imported by the Shortcut; record missing source values as blank.
- Discipline, mood, energy and deep work are subjective self-reports.
- \`habits_done\` and \`habits_total\` are aggregate daily counts. They cannot explain which habit failed.
- \`habits_missed\` is a user-supplied description, not a complete per-habit event history.
- A scheduled-but-unreported habit is not automatically counted as missed.
- Sleep and HRV are physiological observations, not a diagnosis or direct discipline score.

## Numeric validation

Ranges enforced by the current API:
- sleep hours 0–24; resting heart rate 20–250; HRV 1–300;
- steps 0–200,000; exercise and screen minutes 0–1,440;
- weight 1–500; habits done/total 0–500;
- discipline, mood, energy and deep work 1–5;
- water 0–30 L; caffeine/alcohol servings 0–50.

These are defensive input bounds, not health recommendations.

## Metric definitions

- Completion rate = reported \`habits_done / habits_total\`; blank when denominator is absent or zero.
- Current streak = consecutive available daily records meeting configured completion threshold, evaluated from the latest record backwards. Missing dates/records terminate the run rather than being silently assumed complete.
- Longest streak = longest run of qualifying records in the data currently stored.
- Rolling averages = arithmetic mean of available numeric observations in the latest seven recorded rows (not an imputed calendar-day series).
- Week-over-week change = latest seven-record average minus the preceding seven-record average; blank until both windows contain values.
- Correlation = Pearson r over observations sharing the current record's day type; only shown at or above configured minimum sample size. It is descriptive, not causal.

## AI interpretation rules

AI output is kept in MEMORY. It must:
- distinguish measured facts from interpretation;
- say when evidence is insufficient;
- not invent missing values;
- not diagnose medical conditions;
- not infer health or discipline scores from one physiological metric;
- not claim correlation proves causation;
- label food energy/macros as estimates.
