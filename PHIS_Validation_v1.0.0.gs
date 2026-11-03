/** PHIS_Validation_v1.0.0.gs — Input validation, date normalization and stable payload hashing. Apps Script files share one global scope. */

var PHIS_TIMEZONE_CACHE = null;
function phisNormalizeDate_(value) {
  const tz = PHIS_TIMEZONE_CACHE || (PHIS_TIMEZONE_CACHE = String(phisConfig_().TIMEZONE || "Asia/Kolkata"));
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parts=value.split("-").map(Number);
    const candidate=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));
    if (candidate.getUTCFullYear()!==parts[0] || candidate.getUTCMonth()!==parts[1]-1 ||
        candidate.getUTCDate()!==parts[2]) throw new Error("Invalid calendar date: "+value);
    return value;
  }
  if (!(value instanceof Date) || isNaN(value.getTime())) {
    throw new Error("date must be YYYY-MM-DD");
  }
  return Utilities.formatDate(value, tz, "yyyy-MM-dd");
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
      const definition=known[id];
      const starts=definition.start_date ? phisNormalizeDate_(definition.start_date) : "";
      const ends=definition.end_date ? phisNormalizeDate_(definition.end_date) : "";
      if (starts && date<starts) throw new Error("Habit " + id + " is not active before " + starts);
      if (ends && date>ends) throw new Error("Habit " + id + " is archived after " + ends);
      if (String(definition.active).toLowerCase()==="false" && !ends) {
        throw new Error("Habit " + id + " is archived");
      }
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

function phisDayType_(dateText) {
  const date = new Date(dateText + "T12:00:00Z");
  const day = date.getUTCDay();
  return (day === 0 || day === 6) ? "weekend" : "weekday";
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

function phisDataQuality_(record) {
  const missing = ["date","habits_done","habits_total"].filter(function(k){
    return record[k] === "" || record[k] === null || record[k] === undefined;
  });
  return missing.length ? "PARTIAL: " + missing.join(",") : "OK";
}
