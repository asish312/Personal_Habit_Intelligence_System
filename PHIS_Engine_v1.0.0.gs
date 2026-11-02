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
    if (secret && String(payload.secret || "") !== secret) {
      return phisJson_({ok: false, error: "Unauthorized"});
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

function phisSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error("Set SPREADSHEET_ID in Script Properties or bind this script to a spreadsheet.");
  return active;
}

function setupPHISWorkbook() {
  const ss = phisSpreadsheet_();
  Object.keys(PHIS.HEADERS).forEach(function(key) {
    const name = PHIS.SHEETS[key];
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const expected = PHIS.HEADERS[key];
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
      sheet.setFrozenRows(1);
    } else {
      const actual = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), expected.length))
        .getDisplayValues()[0].slice(0, expected.length);
      if (actual.join("|") !== expected.join("|")) {
        throw new Error("Schema mismatch in " + name + ". Expected: " + expected.join(", "));
      }
    }
  });
  let dashboard = ss.getSheetByName(PHIS.SHEETS.DASHBOARD);
  if (!dashboard) dashboard = ss.insertSheet(PHIS.SHEETS.DASHBOARD);
  phisSeedConfig_();
  phisAudit_("WORKBOOK_SETUP", "", "SUCCESS", "Workbook schemas verified");
  return {ok: true, sheets: Object.keys(PHIS.SHEETS).map(function(k){return PHIS.SHEETS[k];})};
}

function phisSeedConfig_() {
  const sheet = phisSpreadsheet_().getSheetByName(PHIS.SHEETS.CONFIG);
  const existing = phisConfig_();
  const rows = [];
  Object.keys(PHIS.CONFIG_DEFAULTS).forEach(function(key) {
    if (!(key in existing)) rows.push([key, PHIS.CONFIG_DEFAULTS[key], "Default; change value to customize"]);
  });
  if (rows.length) sheet.getRange(sheet.getLastRow()+1, 1, rows.length, 3).setValues(rows);
}

function phisConfig_() {
  const sheet = phisSpreadsheet_().getSheetByName(PHIS.SHEETS.CONFIG);
  if (!sheet || sheet.getLastRow() < 2) return {};
  const values = sheet.getRange(2, 1, sheet.getLastRow()-1, 2).getValues();
  return values.reduce(function(out, row) {
    if (row[0] !== "") out[String(row[0])] = row[1];
    return out;
  }, {});
}

var PHIS_TIMEZONE_CACHE = null;
function phisNormalizeDate_(value) {
  const tz = PHIS_TIMEZONE_CACHE || (PHIS_TIMEZONE_CACHE = String(phisConfig_().TIMEZONE || "Asia/Kolkata"));
  let date;
  if (value instanceof Date) date = value;
  else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date = new Date(value + "T12:00:00");
  } else {
    throw new Error("date must be YYYY-MM-DD");
  }
  if (isNaN(date.getTime())) throw new Error("Invalid date");
  return Utilities.formatDate(date, tz, "yyyy-MM-dd");
}

function phisValidatePayload_(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Payload must be an object");
  const date = phisNormalizeDate_(payload.date);
  const numeric = {
    sleep_hours:[0,24], resting_hr:[20,250], hrv:[1,300], steps:[0,200000],
    exercise_min:[0,1440], weight:[1,500], screen_min:[0,1440],
    habits_done:[0,500], habits_total:[0,500], discipline:[1,5],
    water_l:[0,30], mood:[1,5], energy:[1,5], deep_work:[1,5],
    caffeine:[0,50], alcohol:[0,50]
  };
  Object.keys(numeric).forEach(function(key) {
    if (payload[key] === undefined || payload[key] === null || payload[key] === "") return;
    const n = Number(payload[key]);
    if (!isFinite(n) || n < numeric[key][0] || n > numeric[key][1]) {
      throw new Error("Invalid " + key + ": expected value between " + numeric[key][0] + " and " + numeric[key][1]);
    }
  });
  if (payload.habits_done !== undefined && payload.habits_total !== undefined &&
      payload.habits_done !== "" && payload.habits_total !== "" &&
      Number(payload.habits_done) > Number(payload.habits_total)) {
    throw new Error("habits_done cannot exceed habits_total");
  }
  if (payload.habits !== undefined) {
    if (!Array.isArray(payload.habits)) throw new Error("habits must be an array");
    const ids = {};
    const known = phisGetHabitMap_();
    payload.habits.forEach(function(event) {
      if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("Each habit entry must be an object");
      const id = String(event.habit_id || "").trim();
      if (!id || !known[id]) throw new Error("Unknown habit_id: " + id);
      if (ids[id]) throw new Error("Duplicate habit_id in payload: " + id);
      ids[id] = true;
      if (["done","partial","skipped","missed","not_reported"].indexOf(String(event.status || "")) < 0) {
        throw new Error("Invalid status for habit " + id);
      }
      ["value","target_value","duration_min"].forEach(function(key) {
        if (event[key] === undefined || event[key] === null || event[key] === "") return;
        const n = Number(event[key]);
        if (!isFinite(n) || n < 0 || n > 1000000) throw new Error("Invalid " + key + " for habit " + id);
      });
    });
  }
  return date;
}

function phisPayloadHash_(payload) {
  const clean = {};
  PHIS.OPTIONAL_FIELDS.forEach(function(k) {
    if (payload[k] !== undefined) clean[k] = payload[k];
  });
  clean.date = phisNormalizeDate_(payload.date);
  if (Array.isArray(payload.habits)) clean.habits = payload.habits;
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(clean),
    Utilities.Charset.UTF_8
  ).map(function(b){return ("0"+((b+256)%256).toString(16)).slice(-2);}).join("");
}

function ingestDailyRecord(payload) {
  const date = phisValidatePayload_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = phisSpreadsheet_().getSheetByName(PHIS.SHEETS.RAW);
    if (!sheet) throw new Error("RAW sheet missing. Run setupPHISWorkbook first.");
    const headers = PHIS.HEADERS.RAW;
    const hash = phisPayloadHash_(payload);
    const values = headers.map(function(h) {
      if (h === "date") return date;
      if (h === "updated_at") return new Date();
      if (h === "source") return payload.source || "shortcut";
      if (h === "payload_hash") return hash;
      if (h === "day_type") return phisDayType_(date);
      return payload[h] === undefined || payload[h] === null ? "" : payload[h];
    });
    const dateCol = headers.indexOf("date") + 1;
    const last = sheet.getLastRow();
    let rowIndex = 0;
    if (last >= 2) {
      const dates = sheet.getRange(2, dateCol, last-1, 1).getValues();
      for (let i = dates.length-1; i >= 0; i--) {
        try { if (phisNormalizeDate_(dates[i][0]) === date) { rowIndex = i+2; break; } } catch (ignored) {}
      }
    }
    let dailyStatus, dailyRow;
    if (rowIndex) {
      const oldHash = String(sheet.getRange(rowIndex, headers.indexOf("payload_hash")+1).getValue() || "");
      if (oldHash === hash) {
        dailyStatus = "unchanged"; dailyRow = rowIndex;
      } else {
        sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
        dailyStatus = "updated"; dailyRow = rowIndex;
      }
    } else {
      sheet.appendRow(values);
      dailyStatus = "created"; dailyRow = sheet.getLastRow();
    }
    if (Array.isArray(payload.habits) && payload.habits.length) {
      phisIngestHabitLogs_(date, payload.habits, payload.source || "shortcut");
    }
    const analyticsStats=computeAnalytics(date);
    const habitStats=computeHabitAnalytics(date);
    const allRaw=phisReadObjects_(PHIS.SHEETS.RAW).sort(function(a,b){
      return phisNormalizeDate_(a.date).localeCompare(phisNormalizeDate_(b.date));
    });
    const latestDate=phisNormalizeDate_(allRaw[allRaw.length-1].date);
    const latestAnalytics=latestDate===date ? analyticsStats : computeAnalytics(latestDate);
    const latestHabitStats=latestDate===date ? habitStats : computeHabitAnalytics(latestDate);
    refreshPHISDashboard(latestDate,latestAnalytics,latestHabitStats);
    phisAudit_("INGEST_" + dailyStatus.toUpperCase(), date, "SUCCESS",
      "Daily record " + dailyStatus + (payload.habits && payload.habits.length ? "; habit events upserted: " + payload.habits.length : ""));
    return {status:dailyStatus, date:date, row:dailyRow};
  } finally {
    lock.releaseLock();
  }
}

function phisDayType_(dateText) {
  const date = new Date(dateText + "T12:00:00Z");
  const day = date.getUTCDay();
  return (day === 0 || day === 6) ? "weekend" : "weekday";
}

function phisReadObjects_(sheetName) {
  const sheet = phisSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const headers = PHIS.HEADERS[Object.keys(PHIS.SHEETS).filter(function(k){return PHIS.SHEETS[k]===sheetName;})[0]];
  if (!headers) throw new Error("Unknown sheet schema: " + sheetName);
  const values = sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues();
  return values.map(function(row) {
    const obj = {};
    headers.forEach(function(h,i){obj[h] = row[i];});
    return obj;
  });
}

function phisValidNumber_(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function phisMean_(values) {
  const nums = values.map(phisValidNumber_).filter(function(v){return v !== null;});
  return nums.length ? nums.reduce(function(a,b){return a+b;},0)/nums.length : "";
}

function phisCorrelation_(pairs) {
  if (pairs.length < 2) return null;
  const xs = pairs.map(function(p){return p[0];});
  const ys = pairs.map(function(p){return p[1];});
  const mx = phisMean_(xs), my = phisMean_(ys);
  let num=0, dx=0, dy=0;
  for (let i=0;i<pairs.length;i++) {
    const a=xs[i]-mx, b=ys[i]-my;
    num += a*b; dx += a*a; dy += b*b;
  }
  const den = Math.sqrt(dx*dy);
  return den ? num/den : null;
}

function computeAnalytics(targetDate) {
  const records = phisReadObjects_(PHIS.SHEETS.RAW).sort(function(a,b){
    return phisNormalizeDate_(a.date).localeCompare(phisNormalizeDate_(b.date));
  });
  if (!records.length) return {ok:false, error:"No daily records"};
  const date = targetDate ? phisNormalizeDate_(targetDate) : phisNormalizeDate_(records[records.length-1].date);
  const idx = records.map(function(r){return phisNormalizeDate_(r.date);}).lastIndexOf(date);
  if (idx < 0) throw new Error("No RAW record for " + date);
  const current = records[idx];
  function dayOrdinal_(value) {
    const normalized=phisNormalizeDate_(value);
    const parts=normalized.split("-").map(Number);
    return Math.floor(Date.UTC(parts[0],parts[1]-1,parts[2])/86400000);
  }
  const targetOrdinal=dayOrdinal_(date);
  const last7Start=targetOrdinal-6;
  const previous7Start=targetOrdinal-13;
  const last7 = records.filter(function(r){
    const ordinal=dayOrdinal_(r.date);
    return ordinal>=last7Start && ordinal<=targetOrdinal;
  });
  const previous7 = records.filter(function(r){
    const ordinal=dayOrdinal_(r.date);
    return ordinal>=previous7Start && ordinal<last7Start;
  });
  const streakThreshold = Number(phisConfig_().COMPLETION_STREAK_THRESHOLD || 0.8);
  function completion(r) {
    const total=phisValidNumber_(r.habits_total), done=phisValidNumber_(r.habits_done);
    return total && done !== null ? done/total : null;
  }
  let streak=0, longest=0, run=0;
  // Historical queries are evaluated only through their requested date.
  for (let i=idx;i>=0;i--) {
    if (i < idx && dayOrdinal_(records[i+1].date)-dayOrdinal_(records[i].date)!==1) break;
    const rate=completion(records[i]);
    if (rate !== null && rate >= streakThreshold) streak++;
    else break;
  }
  for (let i=0;i<=idx;i++) {
    if (i>0 && dayOrdinal_(records[i].date)-dayOrdinal_(records[i-1].date)!==1) run=0;
    const rate=completion(records[i]);
    if (rate !== null && rate >= streakThreshold) {run++; longest=Math.max(longest,run);}
    else run=0;
  }
  const fields = [
    ["sleep_hours","sleep_avg_7d","sleep_wow_change"],
    ["steps","steps_avg_7d","steps_wow_change"],
    ["screen_min","screen_avg_7d","screen_wow_change"],
    ["discipline","discipline_avg_7d","discipline_wow_change"]
  ];
  const metric = {};
  fields.forEach(function(f){
    const currentValues=last7.map(function(r){return r[f[0]];});
    const previousValues=previous7.map(function(r){return r[f[0]];});
    const currentAvg=phisMean_(currentValues), previousAvg=phisMean_(previousValues);
    metric[f[1]]=currentAvg;
    metric[f[2]]=(currentAvg!=="" && previousAvg!=="") ? currentAvg-previousAvg : "";
  });
  const correlations = [];
  const recordsThroughTarget=records.slice(0,idx+1);
  const candidateInputs=["sleep_hours","steps","exercise_min","screen_min","water_l","mood","energy"];
  const outcomes=["discipline","deep_work"];
  candidateInputs.forEach(function(input){
    outcomes.forEach(function(outcome){
      const pairs=recordsThroughTarget.filter(function(r){
        return r.day_type===current.day_type;
      }).map(function(r){return [phisValidNumber_(r[input]),phisValidNumber_(r[outcome])];})
        .filter(function(p){return p[0]!==null && p[1]!==null;});
      const corr=phisCorrelation_(pairs);
      if (corr!==null) correlations.push({input:input,outcome:outcome,r: corr,n:pairs.length});
    });
  });
  correlations.sort(function(a,b){return Math.abs(b.r)-Math.abs(a.r);});
  const minN=Number(phisConfig_().MIN_CORRELATION_SAMPLES || 14);
  const strongest=correlations.filter(function(c){return c.n>=minN;})[0] || null;
  const output = [
    date, completion(current) === null ? "" : completion(current), streak, longest,
    metric.sleep_avg_7d, metric.steps_avg_7d, metric.screen_avg_7d,
    metric.discipline_avg_7d, metric.sleep_wow_change, metric.steps_wow_change,
    metric.screen_wow_change, metric.discipline_wow_change,
    strongest ? strongest.input + " vs " + strongest.outcome + " (r=" + strongest.r.toFixed(2) + ")" : "",
    strongest ? strongest.n : 0, phisDataQuality_(current)
  ];
  phisUpsertByDate_(PHIS.SHEETS.ANALYTICS, date, output);
  return {
    date:date, completion_rate:output[1], current_streak:streak, longest_streak:longest,
    rolling_averages: {
      sleep_hours:metric.sleep_avg_7d, steps:metric.steps_avg_7d,
      screen_min:metric.screen_avg_7d, discipline:metric.discipline_avg_7d
    },
    week_over_week_change: {
      sleep_hours:metric.sleep_wow_change, steps:metric.steps_wow_change,
      screen_min:metric.screen_wow_change, discipline:metric.discipline_wow_change
    },
    strongest_correlation:strongest, data_quality:output[14]
  };
}

function phisDataQuality_(record) {
  const missing = ["date","habits_done","habits_total"].filter(function(k){
    return record[k] === "" || record[k] === null || record[k] === undefined;
  });
  return missing.length ? "PARTIAL: " + missing.join(",") : "OK";
}

function phisUpsertByDate_(sheetName, date, row) {
  const sheet=phisSpreadsheet_().getSheetByName(sheetName);
  const last=sheet.getLastRow();
  if (last>=2) {
    const dates=sheet.getRange(2,1,last-1,1).getValues();
    for (let i=dates.length-1;i>=0;i--) {
      let rowDate="";
      try { rowDate=phisNormalizeDate_(dates[i][0]); } catch (ignored) {}
      if (rowDate===date) {
        sheet.getRange(i+2,1,1,row.length).setValues([row]);
        sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).sort({column:1,ascending:true});
        return i+2;
      }
    }
  }
  sheet.appendRow(row);
  if (sheet.getLastRow()>2) sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).sort({column:1,ascending:true});
  return sheet.getLastRow();
}

function runDailyJob() {
  const raw=phisReadObjects_(PHIS.SHEETS.RAW).sort(function(a,b){
    return phisNormalizeDate_(a.date).localeCompare(phisNormalizeDate_(b.date));
  });
  if (!raw.length) return {ok:false, error:"No daily data"};
  const date=phisNormalizeDate_(raw[raw.length-1].date);
  const stats=computeAnalytics(date);
  const habitStats=computeHabitAnalytics(date);
  refreshPHISDashboard(date,stats,habitStats);
  let review={status:"disabled"};
  if (String(phisConfig_().DAILY_REVIEW_ENABLED).toLowerCase()==="true") {
    review=generateDailyReview(date,stats);
  }
  maybeNotify(date,stats,review);
  return {ok:true,date:date,analytics:stats,review:review};
}

function runDailyReview(date) {
  const stats=computeAnalytics(date || "");
  return generateDailyReview(stats.date,stats);
}

function generateDailyReview(date,stats) {
  const raw=phisReadObjects_(PHIS.SHEETS.RAW);
  const day=raw.filter(function(r){return phisNormalizeDate_(r.date)===date;})[0];
  if (!day) throw new Error("No record for review date " + date);
  const config=phisConfig_();
  const endpoint=String(config.LLM_ENDPOINT || PropertiesService.getScriptProperties().getProperty("LLM_ENDPOINT") || "");
  const apiKey=PropertiesService.getScriptProperties().getProperty("LLM_API_KEY");
  const model=String(config.LLM_MODEL || "");
  if (!endpoint || !apiKey || !model) {
    const result={status:"skipped",reason:"Configure LLM_ENDPOINT, LLM_API_KEY and LLM_MODEL"};
    phisAudit_("AI_REVIEW",date,"SKIPPED",result.reason);
    return result;
  }
  const prompt = [
    "You are a candid, evidence-based personal habit analyst.",
    "Use only supplied facts. Do not infer medical diagnoses or claim causation.",
    "Do not invent missing values. Distinguish unknown, missed and not scheduled.",
    "Return strict JSON keys: summary_text, wins, misses, one_line_reality_check, discipline_score, health_score, focus_score, estimated_calories, protein_signal, tags.",
    "Scores must be null unless there is enough relevant evidence. Do not score health from HRV or weight alone.",
    "Daily record: " + JSON.stringify(day),
    "Computed analytics: " + JSON.stringify(stats)
  ].join("\n\n");
  const response=UrlFetchApp.fetch(endpoint,{
    method:"post",
    contentType:"application/json",
    headers:{Authorization:"Bearer "+apiKey},
    payload:JSON.stringify({
      model:model, temperature:0.2,
      messages:[{role:"user",content:prompt}],
      response_format:{type:"json_object"}
    }),
    muteHttpExceptions:true
  });
  const code=response.getResponseCode(), body=response.getContentText();
  if (code<200 || code>=300) throw new Error("LLM request failed ("+code+"): "+body.slice(0,500));
  const parsed=JSON.parse(body);
  const content=parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
  if (!content) throw new Error("LLM response did not contain message content");
  const review=JSON.parse(content);
  const row=[
    date, review.summary_text||"", phisString_(review.wins), phisString_(review.misses),
    review.one_line_reality_check||"", phisNullable_(review.discipline_score),
    phisNullable_(review.health_score), phisNullable_(review.focus_score),
    phisNullable_(review.estimated_calories), review.protein_signal||"",
    phisString_(review.tags), "openai_compatible", model, new Date(), "SUCCESS"
  ];
  phisUpsertByDate_(PHIS.SHEETS.MEMORY,date,row);
  phisAudit_("AI_REVIEW",date,"SUCCESS","Daily review generated");
  return {status:"success",review:review};
}

function phisString_(value) {
  if (Array.isArray(value)) return value.join(" | ");
  return value === null || value === undefined ? "" : String(value);
}
function phisNullable_(value) {
  if (value === null || value === undefined || value === "") return "";
  const n=Number(value); return isFinite(n)?n:"";
}

function maybeNotify(date,stats,review) {
  if (String(phisConfig_().NOTIFICATIONS_ENABLED).toLowerCase()!=="true") return {status:"disabled"};
  const props=PropertiesService.getScriptProperties();
  const token=props.getProperty("PUSHOVER_APP_TOKEN");
  const user=props.getProperty("PUSHOVER_USER_KEY");
  if (!token || !user) {
    phisAudit_("NOTIFICATION",date,"SKIPPED","Missing Pushover credentials");
    return {status:"skipped",reason:"Configure Pushover credentials"};
  }
  const messages=[];
  const threshold=Number(phisConfig_().COMPLETION_STREAK_THRESHOLD || 0.8);
  if (stats.completion_rate!=="" && stats.completion_rate<threshold) {
    messages.push("Habit completion below target: "+Math.round(stats.completion_rate*100)+"%");
  }
  const key="PHIS_LAST_NOTIFICATION_DATE";
  if (!messages.length || props.getProperty(key)===date) return {status:"no_notification"};
  const response=UrlFetchApp.fetch("https://api.pushover.net/1/messages.json",{
    method:"post",payload:{token:token,user:user,message:messages.join("\n"),title:"PHIS daily signal"},
    muteHttpExceptions:true
  });
  const code=response.getResponseCode();
  if (code<200 || code>=300) throw new Error("Pushover notification failed ("+code+")");
  props.setProperty(key,date);
  phisAudit_("NOTIFICATION",date,"SUCCESS",messages.join("; "));
  return {status:"sent",messages:messages};
}

function answerQuestion(question) {
  const q=String(question||"").trim();
  if (!q) throw new Error("Question cannot be empty");
  const raw=phisReadObjects_(PHIS.SHEETS.RAW).sort(function(a,b){
    return phisNormalizeDate_(a.date).localeCompare(phisNormalizeDate_(b.date));
  });
  if (!raw.length) return "No habit history is available yet.";
  const analytics=phisReadObjects_(PHIS.SHEETS.ANALYTICS).sort(function(a,b){
    return phisNormalizeDate_(a.date).localeCompare(phisNormalizeDate_(b.date));
  });
  const memory=phisReadObjects_(PHIS.SHEETS.MEMORY).sort(function(a,b){
    return phisNormalizeDate_(a.date).localeCompare(phisNormalizeDate_(b.date));
  });
  const context={
    recent_days:raw.slice(-45),
    analytics:analytics.slice(-30),
    reviews:memory.slice(-30),
    habits:phisReadObjects_(PHIS.SHEETS.HABITS),
    habit_analytics:phisReadObjects_(PHIS.SHEETS.HABIT_ANALYTICS).slice(-100),
    recent_habit_events:phisReadObjects_(PHIS.SHEETS.HABIT_LOG).slice(-120)
  };
  const props=PropertiesService.getScriptProperties();
  const config=phisConfig_();
  const endpoint=String(config.LLM_ENDPOINT || props.getProperty("LLM_ENDPOINT") || "");
  const key=props.getProperty("LLM_API_KEY");
  const model=String(config.LLM_MODEL || "");
  if (!endpoint || !key || !model) {
    return phisRuleBasedAnswer_(q,raw,analytics);
  }
  const response=UrlFetchApp.fetch(endpoint,{
    method:"post",contentType:"application/json",
    headers:{Authorization:"Bearer "+key},
    payload:JSON.stringify({
      model:model,temperature:0.2,
      messages:[
        {role:"system",content:"Answer based only on the supplied PHIS records. State sample sizes and uncertainty. Never claim correlation proves causation. Say when data is insufficient."},
        {role:"user",content:"Question: "+q+"\n\nHistory context: "+JSON.stringify(context)}
      ]
    }),
    muteHttpExceptions:true
  });
  const code=response.getResponseCode();
  if (code<200 || code>=300) throw new Error("Q&A provider failed ("+code+"): "+response.getContentText().slice(0,400));
  const data=JSON.parse(response.getContentText());
  return data.choices[0].message.content;
}

function phisRuleBasedAnswer_(question,raw,analytics) {
  const latest=raw[raw.length-1];
  const latestDate=phisNormalizeDate_(latest.date);
  const latestStats=analytics.filter(function(a){return phisNormalizeDate_(a.date)===latestDate;})[0];
  if (/streak/i.test(question) && latestStats) return "Current completion streak: "+latestStats.current_streak+" day(s).";
  if (/completion|consistency|rate/i.test(question)) {
    const days=raw.slice(-7);
    const rates=days.map(function(r){
      const total=phisValidNumber_(r.habits_total),done=phisValidNumber_(r.habits_done);
      return total?done/total:null;
    }).filter(function(v){return v!==null;});
    return rates.length ? "Average reported habit completion over the latest "+rates.length+" day(s): "+Math.round(100*phisMean_(rates))+"%." : "There is insufficient habit completion data.";
  }
  return "AI Q&A is not configured. Latest record is "+latestDate+". Configure LLM_ENDPOINT, LLM_API_KEY and LLM_MODEL to enable natural-language analysis.";
}

function setupPHISTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger){
    if (["runDailyJob"].indexOf(trigger.getHandlerFunction())>=0) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("runDailyJob").timeBased().everyDays(1).atHour(6).create();
  phisAudit_("TRIGGER_SETUP","","SUCCESS","Daily job scheduled near 6 AM project timezone");
  return {ok:true,trigger:"runDailyJob"};
}

function phisAudit_(event,date,status,details) {
  try {
    const ss=phisSpreadsheet_();
    let sheet=ss.getSheetByName(PHIS.SHEETS.AUDIT);
    if (!sheet) {
      sheet=ss.insertSheet(PHIS.SHEETS.AUDIT);
      sheet.appendRow(PHIS.HEADERS.AUDIT);
    }
    sheet.appendRow([new Date(),event,date,status,String(details||"").slice(0,4000)]);
  } catch (ignored) {}
}

function phisValidateWorkbook() {
  const ss=phisSpreadsheet_(), errors=[];
  Object.keys(PHIS.HEADERS).forEach(function(key){
    const sheet=ss.getSheetByName(PHIS.SHEETS[key]);
    if (!sheet) errors.push("Missing sheet: "+PHIS.SHEETS[key]);
    else {
      const header=sheet.getRange(1,1,1,PHIS.HEADERS[key].length).getDisplayValues()[0];
      if (header.join("|")!==PHIS.HEADERS[key].join("|")) errors.push("Header mismatch: "+PHIS.SHEETS[key]);
    }
  });
  if (!ss.getSheetByName(PHIS.SHEETS.DASHBOARD)) errors.push("Missing sheet: "+PHIS.SHEETS.DASHBOARD);
  return {ok:errors.length===0,errors:errors,version:PHIS.VERSION};
}


/* ------------------------- Habit-level intelligence ---------------------- */

function upsertHabitDefinition(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new Error("habit must be an object");
  }
  const lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet=phisSpreadsheet_().getSheetByName(PHIS.SHEETS.HABITS);
    const id=String(definition.habit_id || Utilities.getUuid());
    const rows=phisReadObjects_(PHIS.SHEETS.HABITS);
    const existing=rows.filter(function(r){return String(r.habit_id)===id;})[0];
    const name=String(definition.habit_name !== undefined ? definition.habit_name :
      (existing ? existing.habit_name : "")).trim();
    if (!name) throw new Error("habit_name is required when creating a habit");
    const cadence=String(definition.cadence !== undefined ? definition.cadence :
      (existing ? existing.cadence : "daily")).toLowerCase();
    if (["daily","weekdays","weekends","weekly","custom"].indexOf(cadence)<0) {
      throw new Error("cadence must be daily, weekdays, weekends, weekly or custom");
    }
    const scheduleDays=String(definition.schedule_days !== undefined ? definition.schedule_days :
      (existing ? existing.schedule_days : (cadence==="weekly" ? "1" : "")));
    if ((cadence==="custom" || cadence==="weekly") && !scheduleDays) {
      throw new Error(cadence+" cadence requires schedule_days (0=Sunday ... 6=Saturday)");
    }
    if (scheduleDays && scheduleDays.split(",").some(function(v){
      return !/^[0-6]$/.test(v.trim());
    })) throw new Error("schedule_days must be comma-separated weekdays 0 through 6");
    const tz=String(phisConfig_().TIMEZONE || "Asia/Kolkata");
    const today=Utilities.formatDate(new Date(),tz,"yyyy-MM-dd");
    const active=definition.active===undefined ?
      (existing ? String(existing.active).toLowerCase()==="true" : true) :
      (definition.active===true || String(definition.active).toLowerCase()==="true");
    const wasActive=existing ? String(existing.active).toLowerCase()==="true" : false;
    const endDate=definition.end_date!==undefined ?
      (definition.end_date ? phisNormalizeDate_(definition.end_date) : "") :
      (existing ? (active ? (wasActive ? existing.end_date : "") : (existing.end_date || today)) :
        (active ? "" : today));
    const targetValue=definition.target_value===undefined ?
      (existing ? existing.target_value : "") :
      (definition.target_value===null || definition.target_value==="" ? "" : Number(definition.target_value));
    const row=[
      id,name,
      String(definition.category !== undefined ? definition.category : (existing ? existing.category : "General")),
      cadence,scheduleDays,active,
      targetValue,
      String(definition.unit !== undefined ? definition.unit : (existing ? existing.unit : "")),
      String(definition.preferred_time !== undefined ? definition.preferred_time : (existing ? existing.preferred_time : "")),
      definition.start_date ? phisNormalizeDate_(definition.start_date) : (existing ? existing.start_date : today),
      endDate,
      existing ? existing.created_at : new Date(),
      String(definition.notes !== undefined ? definition.notes : (existing ? existing.notes : ""))
    ];
    if (row[6]!=="" && (!isFinite(row[6]) || row[6]<0)) {
      throw new Error("target_value must be a non-negative number");
    }
    if (existing) {
      const index=rows.findIndex(function(r){return String(r.habit_id)===id;})+2;
      sheet.getRange(index,1,1,row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    phisAudit_("HABIT_" + (existing ? "UPDATE":"CREATE"),"", "SUCCESS",id+" — "+name);
    return {habit_id:id,habit_name:name,status:existing?"updated":"created"};
  } finally {
    lock.releaseLock();
  }
}
function archiveHabit(habitId) {
  if (!habitId) throw new Error("habit_id is required");
  const sheet=phisSpreadsheet_().getSheetByName(PHIS.SHEETS.HABITS);
  const rows=phisReadObjects_(PHIS.SHEETS.HABITS);
  const index=rows.findIndex(function(r){return String(r.habit_id)===habitId;});
  if (index<0) throw new Error("Habit not found: "+habitId);
  sheet.getRange(index+2,6).setValue(false);
  sheet.getRange(index+2,11).setValue(Utilities.formatDate(new Date(),String(phisConfig_().TIMEZONE || "Asia/Kolkata"),"yyyy-MM-dd"));
  phisAudit_("HABIT_ARCHIVE","", "SUCCESS",habitId);
  return {habit_id:habitId,status:"archived"};
}

function phisGetHabitMap_() {
  const out={};
  phisReadObjects_(PHIS.SHEETS.HABITS).forEach(function(h){out[String(h.habit_id)]=h;});
  return out;
}

function phisHabitEventHash_(date,event) {
  const normalized={
    date:date,habit_id:String(event.habit_id),status:String(event.status),
    value:event.value===undefined?"":event.value,
    target_value:event.target_value===undefined?"":event.target_value,
    duration_min:event.duration_min===undefined?"":event.duration_min,
    notes:event.notes||""
  };
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(normalized),Utilities.Charset.UTF_8)
    .map(function(b){return ("0"+((b+256)%256).toString(16)).slice(-2);}).join("");
}

function phisIngestHabitLogs_(date,events,source) {
  if (!events.length) return [];
  const sheet=phisSpreadsheet_().getSheetByName(PHIS.SHEETS.HABIT_LOG);
  const headers=PHIS.HEADERS.HABIT_LOG;
  const existing=phisReadObjects_(PHIS.SHEETS.HABIT_LOG);
  const results=[];
  events.forEach(function(event){
    const habit=phisGetHabitMap_()[String(event.habit_id)];
    const hash=phisHabitEventHash_(date,event);
    const row=[
      date,String(event.habit_id),habit.habit_name,String(event.status),
      event.value===undefined?"":Number(event.value),
      event.target_value===undefined?(habit.target_value || ""):Number(event.target_value),
      event.duration_min===undefined?"":Number(event.duration_min),
      String(event.notes || ""),String(source || "shortcut"),new Date(),hash
    ];
    const index=existing.findIndex(function(r){
      return phisNormalizeDate_(r.date)===date && String(r.habit_id)===String(event.habit_id);
    });
    if (index>=0) {
      const rowNumber=index+2;
      const oldHash=String(sheet.getRange(rowNumber,headers.indexOf("payload_hash")+1).getValue() || "");
      if (oldHash===hash) {results.push({habit_id:event.habit_id,status:"unchanged"});return;}
      sheet.getRange(rowNumber,1,1,row.length).setValues([row]);
      results.push({habit_id:event.habit_id,status:"updated"});
    } else {
      sheet.appendRow(row);
      results.push({habit_id:event.habit_id,status:"created"});
    }
  });
  return results;
}

function phisIsHabitScheduled_(habit,dateText) {
  const day=new Date(dateText+"T12:00:00Z").getUTCDay();
  const cadence=String(habit.cadence || "daily");
  const days=String(habit.schedule_days || "").split(",").map(function(v){return Number(v.trim());});
  if (cadence==="daily") return true;
  if (cadence==="weekdays") return day>=1 && day<=5;
  if (cadence==="weekends") return day===0 || day===6;
  if (cadence==="weekly" || cadence==="custom") return days.indexOf(day)>=0;
  return false;
}

function phisAddDays_(dateText,delta) {
  const parts=dateText.split("-").map(Number);
  const d=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]+delta,12));
  return d.toISOString().slice(0,10);
}

function computeHabitAnalytics(asOfDate) {
  const raw=phisReadObjects_(PHIS.SHEETS.RAW).sort(function(a,b){
    return phisNormalizeDate_(a.date).localeCompare(phisNormalizeDate_(b.date));
  });
  const date=asOfDate ? phisNormalizeDate_(asOfDate) : (raw.length ? phisNormalizeDate_(raw[raw.length-1].date) : "");
  if (!date) return {date:"",habits:[]};
  const definitions=phisReadObjects_(PHIS.SHEETS.HABITS);
  const logs=phisReadObjects_(PHIS.SHEETS.HABIT_LOG);
  const logMap={};
  logs.forEach(function(row){
    const logDate=phisNormalizeDate_(row.date);
    if (logDate<=date) logMap[logDate+"|"+String(row.habit_id)]=row;
  });
  const earliestRaw=raw.length ? phisNormalizeDate_(raw[0].date) : date;
  const output=[];
  definitions.forEach(function(habit){
    if (String(habit.active).toLowerCase()==="false" && !habit.end_date) return;
    const start=habit.start_date ? phisNormalizeDate_(habit.start_date) : earliestRaw;
    const end=habit.end_date ? (phisNormalizeDate_(habit.end_date)<date ? phisNormalizeDate_(habit.end_date) : date) : date;
    if (start>end) return;
    let scheduled=0,done=0,partial=0,skipped=0,missed=0,notReported=0;
    let current=0,longest=0,run=0,lastDone="";
    const expected=[];
    for (let day=start;day<=end;day=phisAddDays_(day,1)) {
      if (!phisIsHabitScheduled_(habit,day)) continue;
      scheduled++;
      const event=logMap[day+"|"+String(habit.habit_id)];
      const status=event ? String(event.status) : "not_reported";
      expected.push({date:day,status:status});
      if (status==="done") {done++;lastDone=day;run++;longest=Math.max(longest,run);}
      else {
        if (status==="partial") partial++;
        else if (status==="skipped") skipped++;
        else if (status==="missed") missed++;
        else notReported++;
        run=0;
      }
    }
    for (let i=expected.length-1;i>=0;i--) {
      if (expected[i].status!=="done") break;
      current++;
    }
    const rate=scheduled ? (done + 0.5*partial)/scheduled : "";
    const row=[
      date,String(habit.habit_id),String(habit.habit_name),String(habit.category),
      scheduled,done,partial,skipped,missed,notReported,rate,current,longest,lastDone
    ];
    phisUpsertHabitAnalytics_(date,String(habit.habit_id),row);
    output.push({
      habit_id:String(habit.habit_id),habit_name:String(habit.habit_name),
      scheduled_days:scheduled,done_days:done,partial_days:partial,
      skipped_days:skipped,missed_days:missed,not_reported_days:notReported,
      adherence_rate:rate,current_streak:current,longest_streak:longest,last_done_date:lastDone
    });
  });
  return {date:date,habits:output};
}

function phisUpsertHabitAnalytics_(date,habitId,row) {
  const sheet=phisSpreadsheet_().getSheetByName(PHIS.SHEETS.HABIT_ANALYTICS);
  const last=sheet.getLastRow();
  if (last>=2) {
    const keys=sheet.getRange(2,1,last-1,2).getValues();
    for (let i=keys.length-1;i>=0;i--) {
      let rowDate="";
      try { rowDate=phisNormalizeDate_(keys[i][0]); } catch (ignored) {}
      if (rowDate===date && String(keys[i][1])===habitId) {
        sheet.getRange(i+2,1,1,row.length).setValues([row]);
        return i+2;
      }
    }
  }
  sheet.appendRow(row);
  if (sheet.getLastRow()>2) sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).sort([
    {column:1,ascending:true},{column:2,ascending:true}
  ]);
  return sheet.getLastRow();
}

function refreshPHISDashboard(asOfDate,stats,habitStats) {
  const ss=phisSpreadsheet_();
  const dash=ss.getSheetByName(PHIS.SHEETS.DASHBOARD) || ss.insertSheet(PHIS.SHEETS.DASHBOARD);
  dash.getCharts().forEach(function(chart){dash.removeChart(chart);});
  dash.getRange(1,1,dash.getMaxRows(),dash.getMaxColumns()).breakApart();
  dash.clear();
  const raw=phisReadObjects_(PHIS.SHEETS.RAW).sort(function(a,b){
    return phisNormalizeDate_(a.date).localeCompare(phisNormalizeDate_(b.date));
  });
  if (!raw.length) {
    dash.getRange("A1").setValue("Personal Habit Intelligence System");
    dash.getRange("A2").setValue("No daily data yet. Submit a capture to begin.");
    return {ok:true,empty:true};
  }
  const latest=phisNormalizeDate_(asOfDate || raw[raw.length-1].date);
  const analytics=stats || computeAnalytics(latest);
  const habitData=habitStats || computeHabitAnalytics(latest);
  dash.setHiddenGridlines(true);
  dash.getRange("A1:H1").merge().setValue("PERSONAL HABIT INTELLIGENCE SYSTEM");
  dash.getRange("A2:H2").merge().setValue("Behaviour, consistency and recovery — as of "+latest);
  dash.getRange("A1:H1").setBackground("#14213D").setFontColor("#FFFFFF").setFontSize(16).setFontWeight("bold");
  dash.getRange("A2:H2").setBackground("#EAF0F8").setFontColor("#334155").setFontSize(10);
  const labels=["Daily completion","Current streak","7-record avg sleep","7-record avg steps"];
  const values=[
    analytics.completion_rate==="" ? "—" : analytics.completion_rate,
    analytics.current_streak,
    analytics.rolling_averages.sleep_hours==="" ? "—" : analytics.rolling_averages.sleep_hours,
    analytics.rolling_averages.steps==="" ? "—" : analytics.rolling_averages.steps
  ];
  const ranges=[["A4:B4","A5:B6"],["C4:D4","C5:D6"],["E4:F4","E5:F6"],["G4:H4","G5:H6"]];
  ranges.forEach(function(r,i){
    dash.getRange(r[0]).merge().setValue(labels[i]).setBackground("#E9EFF7").setFontColor("#475569").setFontWeight("bold");
    dash.getRange(r[1]).merge().setValue(values[i]).setBackground("#F8FAFC").setFontColor("#0F172A").setFontSize(18).setFontWeight("bold");
  });
  dash.getRange("A8:H8").merge().setValue("PER-HABIT ADHERENCE");
  dash.getRange("A8:H8").setBackground("#14213D").setFontColor("#FFFFFF").setFontWeight("bold");
  let habitTableCount=0;
  if (habitData.habits.length) {
    const top=habitData.habits.slice().sort(function(a,b){
      return (b.adherence_rate||0)-(a.adherence_rate||0);
    }).slice(0,8);
    dash.getRange(9,1,1,4).setValues([["Habit","Adherence","Current streak","Missed / not reported"]]);
    dash.getRange(10,1,top.length,4).setValues(top.map(function(h){
      return [h.habit_name,h.adherence_rate,h.current_streak,h.missed_days+" / "+h.not_reported_days];
    }));
    dash.getRange(9,1,1,4).setFontWeight("bold").setBackground("#E9EFF7");
    dash.getRange(10,2,top.length,1).setNumberFormat("0.0%");
    habitTableCount=top.length;
  } else {
    dash.getRange("A9").setValue("Add habits to HABIT_MASTER and send per-habit status events to activate this view.");
  }
  const analyticsSheet=ss.getSheetByName(PHIS.SHEETS.ANALYTICS);
  const lastA=analyticsSheet.getLastRow();
  if (lastA>=2) {
    const completionChart=dash.newChart().asLineChart()
      .addRange(analyticsSheet.getRange(1,1,lastA,1))
      .addRange(analyticsSheet.getRange(1,2,lastA,1))
      .setNumHeaders(1).setPosition(20,1,0,0)
      .setOption("title","Daily habit completion rate")
      .setOption("vAxis",{viewWindow:{min:0,max:1},format:"0%"})
      .setOption("legend",{position:"none"})
      .build();
    dash.insertChart(completionChart);
    const sleepChart=dash.newChart().asLineChart()
      .addRange(analyticsSheet.getRange(1,1,lastA,1))
      .addRange(analyticsSheet.getRange(1,5,lastA,1))
      .setNumHeaders(1).setPosition(20,9,0,0)
      .setOption("title","7-record average sleep (hours)")
      .setOption("legend",{position:"none"})
      .build();
    dash.insertChart(sleepChart);
  }
  if (habitTableCount>0) {
    const habitChart=dash.newChart().asColumnChart()
      .addRange(dash.getRange(9,1,habitTableCount+1,2))
      .setNumHeaders(1).setPosition(38,1,0,0)
      .setOption("title","Per-habit adherence")
      .setOption("vAxis",{viewWindow:{min:0,max:1},format:"0%"})
      .setOption("legend",{position:"none"})
      .build();
    dash.insertChart(habitChart);
  }
  dash.setColumnWidths(1,8,125);
  dash.setFrozenRows(2);
  return {ok:true,date:latest,habit_count:habitData.habits.length,charts:dash.getCharts().length};
}
