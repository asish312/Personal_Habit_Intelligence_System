/** PHIS_Engine_v1.0.0.gs — API entry points and canonical workbook schemas/configuration. Apps Script files share one global scope. */

/**
 * Personal Habit Intelligence System (PHIS)
 * Google Apps Script backend. Spreadsheet-backed, idempotent and configurable.
 *
 * Install: bind this project to a Google Sheet or set SPREADSHEET_ID in
 * Script Properties. Configure provider secrets in Script Properties.
 * Do not commit secrets or private health data.
 */

const PHIS = Object.freeze({
  VERSION: "1.0.0",
  SHEETS: Object.freeze({
    RAW: "RAW",
    ANALYTICS: "ANALYTICS",
    MEMORY: "MEMORY",
    CONFIG: "CONFIG",
    AUDIT: "AUDIT_LOG",
    HABITS: "HABIT_MASTER",
    HABIT_LOG: "HABIT_LOG",
    HABIT_ANALYTICS: "HABIT_ANALYTICS",
    DASHBOARD: "DASHBOARD"
  }),
  HEADERS: Object.freeze({
    RAW: [
      "date", "sleep_hours", "bedtime", "wake_time", "resting_hr", "hrv",
      "steps", "exercise_min", "weight", "screen_min", "habits_done",
      "habits_total", "habits_missed", "discipline", "day_type", "water_l",
      "mood", "energy", "deep_work", "exercise_time", "caffeine", "alcohol",
      "biggest_win", "biggest_blocker", "meals_raw", "tags", "updated_at",
      "source", "payload_hash"
    ],
    ANALYTICS: [
      "date", "completion_rate", "current_streak", "longest_streak",
      "sleep_avg_7d", "steps_avg_7d", "screen_avg_7d", "discipline_avg_7d",
      "sleep_wow_change", "steps_wow_change", "screen_wow_change",
      "discipline_wow_change", "strongest_correlation", "correlation_n",
      "data_quality"
    ],
    MEMORY: [
      "date", "summary_text", "wins", "misses", "one_line_reality_check",
      "discipline_score", "health_score", "focus_score", "estimated_calories",
      "protein_signal", "tags", "provider", "model", "created_at", "status"
    ],
    CONFIG: ["key", "value", "description"],
    AUDIT: ["timestamp", "event", "date", "status", "details"],
    HABITS: ["habit_id", "habit_name", "category", "cadence", "schedule_days", "active", "target_value", "unit", "preferred_time", "start_date", "end_date", "created_at", "notes"],
    HABIT_LOG: ["date", "habit_id", "habit_name", "status", "value", "target_value", "duration_min", "notes", "source", "updated_at", "payload_hash"],
    HABIT_ANALYTICS: ["as_of_date", "habit_id", "habit_name", "category", "scheduled_days", "done_days", "partial_days", "skipped_days", "missed_days", "not_reported_days", "adherence_rate", "current_streak", "longest_streak", "last_done_date"]
  }),
  OPTIONAL_FIELDS: Object.freeze([
    "sleep_hours", "bedtime", "wake_time", "resting_hr", "hrv", "steps",
    "exercise_min", "weight", "screen_min", "habits_done", "habits_total",
    "habits_missed", "discipline", "water_l", "mood", "energy", "deep_work",
    "exercise_time", "caffeine", "alcohol", "biggest_win", "biggest_blocker",
    "meals_raw", "tags"
  ]),
  CONFIG_DEFAULTS: Object.freeze({
    SLEEP_TARGET_HOURS: 7.5,
    STEPS_TARGET: 8000,
    WATER_TARGET_L: 2.5,
    COMPLETION_STREAK_THRESHOLD: 0.8,
    DAILY_REVIEW_ENABLED: false,
    NOTIFICATIONS_ENABLED: false,
    TIMEZONE: "Asia/Kolkata",
    MIN_CORRELATION_SAMPLES: 14,
    LLM_PROVIDER: "openai_compatible",
    LLM_MODEL: "",
    LLM_ENDPOINT: "",
    PUSH_PROVIDER: "pushover"
  })
});


function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "health";
  if (action === "health") return phisJson_({ok: true, app: "PHIS", version: PHIS.VERSION});
  return phisJson_({ok: false, error: "Unsupported GET action"});
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw) return phisJson_({ok: false, error: "Missing JSON body"});
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return phisJson_({ok: false, error: "Payload must be a JSON object"});
    }
    if (payload.action === "health") {
      return phisJson_({ok: true, app: "PHIS", version: PHIS.VERSION});
    }
    const secret = PropertiesService.getScriptProperties().getProperty("WEB_APP_SECRET");
    if (!secret) {
      return phisJson_({ok: false, error: "Endpoint disabled: configure WEB_APP_SECRET in Script Properties"});
    }
    if (String(payload.secret || "") !== secret) {
      return phisJson_({ok: false, error: "Unauthorized"});
    }
    if (payload.action === "habit_list") {
      return phisJson_({ok: true, result: listHabits(payload.include_archived === true)});
    }
    if (payload.action === "habit_upsert") {
      return phisJson_({ok: true, result: upsertHabitDefinition(payload.habit || {})});
    }
    if (payload.action === "habit_archive") {
      return phisJson_({ok: true, result: archiveHabit(String(payload.habit_id || ""))});
    }
    if (payload.question) {
      const answer = answerQuestion(String(payload.question));
      return phisJson_({ok: true, result: answer});
    }
    if (payload.action === "daily_review") {
      return phisJson_({ok: true, result: runDailyReview(payload.date || "")});
    }
    const result = ingestDailyRecord(payload);
    return phisJson_({ok: true, result: result});
  } catch (err) {
    phisAudit_("REQUEST_ERROR", "", "ERROR", String(err && err.stack || err));
    return phisJson_({ok: false, error: String(err && err.message || err)});
  }
}

function phisJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
