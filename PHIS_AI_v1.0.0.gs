/** PHIS_AI_v1.0.0.gs — Optional AI review and history Q&A. Apps Script files share one global scope. */

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
