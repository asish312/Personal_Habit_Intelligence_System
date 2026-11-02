# PHIS Analytics and Dashboard Specification

## Executive dashboard

Recommended primary KPIs:
- Habit completion rate (clearly labelled reported aggregate).
- Current and longest qualifying streak.
- 7-record rolling averages for sleep, steps, screen time and discipline.
- Week-over-week changes.
- Latest date with captured data and data-quality coverage.

## Analytics views

1. **Daily pulse:** timeline of capture completeness, completion rate and selected measurements.
2. **Consistency heatmap:** calendar cells show reported completion. Unknown days must look different from missed or zero-completion days.
3. **Trend explorer:** selectable 7/30/90 day and yearly views for sleep, steps, screen time, exercise, mood and focus.
4. **Habit adherence:** aggregate completion now; per-habit ranking only after a canonical per-habit event schema exists.
5. **Behaviour patterns:** weekday/weekend comparison, strongest supported correlations, sample size and uncertainty.
6. **Goal progress:** compare observations with CONFIG targets, show missing data separately.
7. **AI review:** daily summary, wins, blockers and one practical next action. Keep original measurements visible.

## Visualisation rules

- Never display missing values as zero.
- Show units and time windows.
- Show sample sizes for comparisons and correlations.
- Do not imply causation from correlations.
- Distinguish reported completion from objective activity measurements.
- Avoid composite scores until weights and validation methodology have been agreed and documented.

## Current engine support

The Apps Script engine persists rolling averages, completion rate, streaks, week-over-week changes and a sample-size-gated Pearson correlation summary. It does not itself create a finished Google Sheets chart dashboard. Charts and dashboard formatting are workbook-layer implementation work and must be validated against the live Sheet.
