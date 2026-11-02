# iOS Shortcut Implementation Guide

This repository contains the Apps Script API, not an importable Apple Shortcut package. Build the Shortcut in Apple's Shortcuts app and test with synthetic values before enabling health access.

## Capture contract

Send a JSON POST to the deployed Apps Script \`/exec\` URL. Recommended first-release Tier 1 fields:

\`\`\`json
{
  "date": "2026-06-25",
  "sleep_hours": 6.4,
  "bedtime": "23:20",
  "wake_time": "06:10",
  "resting_hr": 58,
  "hrv": 42,
  "steps": 8200,
  "exercise_min": 30,
  "weight": 74.1,
  "screen_min": 310,
  "habits_done": 5,
  "habits_total": 7,
  "habits_missed": "Reading; evening walk",
  "discipline": 3,
  "source": "ios-shortcut"
}
\`\`\`

Only include values actually read or explicitly entered. Do not fill unavailable HealthKit values with zero.

## Suggested Shortcut sequence

1. Use **Find Health Samples** for the previous sleep interval / sleep analysis, steps, workouts, resting heart rate, HRV and body mass. Apple Health sample availability depends on device, permissions, source apps and data types.
2. Use **Get Details of Health Samples** and aggregate only the intended local calendar day. Validate units, source and time window.
3. Ask for manual screen-time and habit aggregate inputs. The aggregate done/total values are a quick summary only.
4. POST `{"action":"habit_list"}` to fetch active HABIT_MASTER definitions and build the habit selector. For every habit scheduled today, capture one explicit status: done, partial, skipped or missed. Do not convert an unanswered prompt into missed.
5. Ask for discipline rating only if this is a meaningful self-report; do not infer it from Health measurements.
6. Add a `habits` array with each stable `habit_id` and status. Include optional `value`, `duration_min` and `notes` when relevant.
7. Build a Dictionary with the JSON fields. Format the date as \`yyyy-MM-dd\` in the user's configured timezone.
8. Use **Get Contents of URL** → POST → Request Body JSON. Add \`WEB_APP_SECRET\` in the JSON dictionary when configured.
9. Read the JSON response. Show a success message only when \`ok=true\`; otherwise show the returned error and allow a retry.
10. Enable an automation to run near the desired capture time. Keep a manual run path for corrections or missed automations.

## Retry and idempotency

The backend maintains one daily summary row per date and one habit status per date + habit ID. Retrying an exact payload is safe; a changed payload updates the existing key. Keep the returned daily status (created, updated, unchanged) in the Shortcut UI.

## Question mode

For natural-language questions, POST:

\`\`\`json
{"question":"How did this week compare with last week?"}
\`\`\`

Show or speak the returned \`result\`. For useful model answers, configure the LLM provider. Without credentials, only limited rule-based answers work.

## Privacy

Grant only required Apple Health data permissions. Review which apps can write/read each Health category. Avoid sending more information than needed to the Sheet or AI provider. The owner should review the current Apple Shortcuts and Health permissions UI; exact action labels can vary by iOS version.
