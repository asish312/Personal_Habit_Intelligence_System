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
3. Ask for manual screen-time and habit aggregate inputs. For habits, prompt for done and total, then optionally a text list of misses.
4. Ask for discipline rating only if this is a meaningful self-report; do not infer it from Health measurements.
5. Build a Dictionary with the JSON fields. Format the date as \`yyyy-MM-dd\` in the user's configured timezone.
6. Use **Get Contents of URL** → POST → Request Body JSON. Add \`WEB_APP_SECRET\` in the JSON dictionary when configured.
7. Read the JSON response. Show a success message only when \`ok=true\`; otherwise show the returned error and allow a retry.
8. Enable an automation to run near the desired capture time. Keep a manual run path for corrections or missed automations.

## Retry and idempotency

The backend maintains one row per date. Retrying the exact payload is safe. A changed payload for the same date updates the day's row. Keep the returned status (created, updated, unchanged) in the Shortcut UI.

## Question mode

For natural-language questions, POST:

\`\`\`json
{"question":"How did this week compare with last week?"}
\`\`\`

Show or speak the returned \`result\`. For useful model answers, configure the LLM provider. Without credentials, only limited rule-based answers work.

## Privacy

Grant only required Apple Health data permissions. Review which apps can write/read each Health category. Avoid sending more information than needed to the Sheet or AI provider. The owner should review the current Apple Shortcuts and Health permissions UI; exact action labels can vary by iOS version.
