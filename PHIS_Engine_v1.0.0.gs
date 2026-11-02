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
    AUDIT: "AUDIT_LOG"
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
    AUDIT: ["timestamp", "event", "date", "status", "details"]
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
    if (payload.question) {
      const answer = answerQuestion(String(payload.question));
      return phisJson_({ok: true, result: answer});
    }
    if (payload.action === "health") {
      return phisJson_({ok: true, app: "PHIS", version: PHIS.VERSION});
    }
    if (payload.action === "daily_review") {
      return phisJson_({ok: true, result: runDailyReview(payload.date || "")});
    }
    const secret = PropertiesService.getScriptProperties().getProperty("WEB_APP_SECRET");
    if (secret && payload.secret !== secret) return phisJson_({ok: false, error: "Unauthorized"});
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

function phisNormalizeDate_(value) {
  const tz = String(phisConfig_().TIMEZONE || "Asia/Kolkata");
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
  return date;
}

function phisPayloadHash_(payload) {
  const clean = {};
  PHIS.OPTIONAL_FIELDS.forEach(function(k) {
    if (payload[k] !== undefined) clean[k] = payload[k];
  });
  clean.date = phisNormalizeDate_(payload.date);
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
      if (h === "day_type") return payload.day_type || phisDayType_(date);
      return payload[h] === undefined || payload[h] === null ? "" : payload[h];
    });
    const dateCol = headers.indexOf("date") + 1;
    const last = sheet.getLastRow();
    let rowIndex = 0;
    if (last >= 2) {
      const dates = sheet.getRange(2, dateCol, last-1, 1).getDisplayValues();
      for (let i = dates.length-1; i >= 0; i--) {
        if (String(dates[i][0]) === date) { rowIndex = i+2; break; }
      }
    }
    if (rowIndex) {
      const oldHash = String(sheet.getRange(rowIndex, headers.indexOf("payload_hash")+1).getValue() || "");
      if (oldHash === hash) {
        phisAudit_("INGEST_REPLAY", date, "NOOP", "Identical daily payload ignored");
        return {status:"unchanged", date:date, row:rowIndex};
      }
      sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
      phisAudit_("INGEST_UPDATE", date, "SUCCESS", "Existing daily record updated");
      return {status:"updated", date:date, row:rowIndex};
    }
    sheet.appendRow(values);
    phisAudit_("INGEST_CREATE", date, "SUCCESS", "Daily record appended");
    return {status:"created", date:date, row:sheet.getLastRow()};
  } finally {
    lock.releaseLock();
  }
}

function phisDayType_(dateText) {
  const date = new Date(dateText + "T12:00:00");
  const day = date.getDay();
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
    return String(a.date).localeCompare(String(b.date));
  });
  if (!records.length) return {ok:false, error:"No daily records"};
  const date = targetDate ? phisNormalizeDate_(targetDate) : phisNormalizeDate_(records[records.length-1].date);
  const idx = records.map(function(r){return phisNormalizeDate_(r.date);}).lastIndexOf(date);
  if (idx < 0) throw new Error("No RAW record for " + date);
  const current = records[idx];
  const start = Math.max(0, idx-6);
  const last7 = records.slice(start, idx+1);
  const previous7 = records.slice(Math.max(0,idx-13), Math.max(0,idx-6));
  const streakThreshold = Number(phisConfig_().COMPLETION_STREAK_THRESHOLD || 0.8);
  function completion(r) {
    const total=phisValidNumber_(r.habits_total), done=phisValidNumber_(r.habits_done);
    return total && done !== null ? done/total : null;
  }
  let streak=0, longest=0, run=0;
  for (let i=records.length-1;i>=0;i--) {
    const rate=completion(records[i]);
    if (rate !== null && rate >= streakThreshold) { streak++; }
    else if (i === records.length-1 || String(records[i].date) <= date) break;
  }
  records.forEach(function(r){
    const rate=completion(r);
    if (rate !== null && rate >= streakThreshold) {run++; longest=Math.max(longest,run);}
    else run=0;
  });
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
  const candidateInputs=["sleep_hours","steps","exercise_min","screen_min","water_l","mood","energy"];
  const outcomes=["discipline","deep_work"];
  candidateInputs.forEach(function(input){
    outcomes.forEach(function(outcome){
      const pairs=records.filter(function(r){
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
    const dates=sheet.getRange(2,1,last-1,1).getDisplayValues();
    for (let i=dates.length-1;i>=0;i--) {
      if (String(dates[i][0])===date) {
        sheet.getRange(i+2,1,1,row.length).setValues([row]); return i+2;
      }
    }
  }
  sheet.appendRow(row); return sheet.getLastRow();
}

function runDailyJob() {
  const raw=phisReadObjects_(PHIS.SHEETS.RAW);
  if (!raw.length) return {ok:false, error:"No daily data"};
  const date=phisNormalizeDate_(raw[raw.length-1].date);
  const stats=computeAnalytics(date);
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
  const raw=phisReadObjects_(PHIS.SHEETS.RAW);
  if (!raw.length) return "No habit history is available yet.";
  const analytics=phisReadObjects_(PHIS.SHEETS.ANALYTICS);
  const memory=phisReadObjects_(PHIS.SHEETS.MEMORY);
  const context={
    recent_days:raw.slice(-45),
    analytics:analytics.slice(-30),
    reviews:memory.slice(-30)
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
  Object.keys(PHIS.SHEETS).forEach(function(key){
    const sheet=ss.getSheetByName(PHIS.SHEETS[key]);
    if (!sheet) errors.push("Missing sheet: "+PHIS.SHEETS[key]);
    else {
      const header=sheet.getRange(1,1,1,PHIS.HEADERS[key].length).getDisplayValues()[0];
      if (header.join("|")!==PHIS.HEADERS[key].join("|")) errors.push("Header mismatch: "+PHIS.SHEETS[key]);
    }
  });
  return {ok:errors.length===0,errors:errors,version:PHIS.VERSION};
}
