/** PHIS_Analytics_v1.0.0.gs — Daily trends, streaks, rolling windows and correlations. Apps Script files share one global scope. */

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
