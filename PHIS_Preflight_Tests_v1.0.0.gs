/**
 * Synthetic preflight tests for PHIS. Uses a disposable spreadsheet.
 * Run PHIS_RUN_ALL_PREFLIGHT_TESTS(); does not touch configured production data.
 */
function PHIS_RUN_ALL_PREFLIGHT_TESTS() {
  const testSs=SpreadsheetApp.create("PHIS_Preflight_TEMP_"+new Date().getTime());
  const original=PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  const results=[];
  try {
    PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID",testSs.getId());
    setupPHISWorkbook();
    results.push(phisTest_("Workbook schemas",function(){
      const v=phisValidateWorkbook(); if (!v.ok) throw new Error(v.errors.join("; "));
    }));
    results.push(phisTest_("Daily ingest creates one row",function(){
      const p=phisTestPayload_("2026-01-01");
      const r=ingestDailyRecord(p);
      if (r.status!=="created") throw new Error(JSON.stringify(r));
      const raw=phisReadObjects_(PHIS.SHEETS.RAW);
      if (raw.length!==1) throw new Error("Expected one RAW record");
    }));
    results.push(phisTest_("Exact replay is idempotent",function(){
      const p=phisTestPayload_("2026-01-01");
      const r=ingestDailyRecord(p);
      if (r.status!=="unchanged") throw new Error(JSON.stringify(r));
      if (phisReadObjects_(PHIS.SHEETS.RAW).length!==1) throw new Error("Duplicate row created");
    }));
    results.push(phisTest_("New payload updates same date",function(){
      const p=phisTestPayload_("2026-01-01"); p.steps=9000;
      const r=ingestDailyRecord(p);
      if (r.status!=="updated") throw new Error(JSON.stringify(r));
      if (phisReadObjects_(PHIS.SHEETS.RAW).length!==1) throw new Error("Expected update, not append");
    }));
    results.push(phisTest_("Validation rejects impossible habits",function(){
      const p=phisTestPayload_("2026-01-02"); p.habits_done=8; p.habits_total=3;
      let threw=false; try { ingestDailyRecord(p); } catch(e) { threw=true; }
      if (!threw) throw new Error("Invalid completion accepted");
    }));
    results.push(phisTest_("Analytics computes and persists",function(){
      const p=phisTestPayload_("2026-01-02"); ingestDailyRecord(p);
      const a=computeAnalytics("2026-01-02");
      if (a.date!=="2026-01-02" || a.completion_rate!==0.8) throw new Error(JSON.stringify(a));
      if (phisReadObjects_(PHIS.SHEETS.ANALYTICS).length!==2) throw new Error("Expected analytics for both captured dates");
    }));
    results.push(phisTest_("Habit master, status log and per-habit analytics",function(){
      const created=upsertHabitDefinition({
        habit_name:"Synthetic walk",category:"Movement",cadence:"daily",
        start_date:"2026-01-01",target_value:20,unit:"minutes"
      });
      const day1=phisTestPayload_("2026-01-01");
      day1.habits=[{habit_id:created.habit_id,status:"done",value:25}];
      ingestDailyRecord(day1);
      const day2=phisTestPayload_("2026-01-02");
      day2.habits=[{habit_id:created.habit_id,status:"partial",value:10}];
      ingestDailyRecord(day2);
      const summary=computeHabitAnalytics("2026-01-03").habits[0];
      if (summary.scheduled_days!==3 || summary.done_days!==1 || summary.partial_days!==1 || summary.not_reported_days!==1) {
        throw new Error(JSON.stringify(summary));
      }
      if (summary.adherence_rate!==0.5 || summary.longest_streak!==1 || summary.current_streak!==0) {
        throw new Error(JSON.stringify(summary));
      }
      const dashboard=refreshPHISDashboard("2026-01-02");
      if (!dashboard.ok || dashboard.habit_count!==1) throw new Error(JSON.stringify(dashboard));
    }));
    results.push(phisTest_("Streaks respect calendar gaps and historical cutoffs",function(){
      const later=phisTestPayload_("2026-01-04"); ingestDailyRecord(later);
      const latest=computeAnalytics("2026-01-04");
      if (latest.current_streak!==1) throw new Error("Expected gap to reset streak; got "+latest.current_streak);
      if (latest.longest_streak!==2) throw new Error("Expected longest streak of 2; got "+latest.longest_streak);
      const historical=computeAnalytics("2026-01-02");
      if (historical.current_streak!==2) throw new Error("Historical streak used future rows or lost prior days");
    }));
  } finally {
    if (original) PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID",original);
    else PropertiesService.getScriptProperties().deleteProperty("SPREADSHEET_ID");
    DriveApp.getFileById(testSs.getId()).setTrashed(true);
  }
  const failed=results.filter(function(r){return !r.ok;});
  const report={ok:failed.length===0,passed:results.length-failed.length,failed:failed.length,results:results};
  Logger.log(JSON.stringify(report,null,2));
  return report;
}

function phisTestPayload_(date) {
  return {
    date:date, sleep_hours:7, resting_hr:60, hrv:45, steps:7000,
    exercise_min:25, screen_min:240, habits_done:4, habits_total:5,
    discipline:4, mood:4, energy:3, deep_work:4, source:"synthetic-test"
  };
}

function phisTest_(name,fn) {
  try { fn(); return {name:name,ok:true}; }
  catch(e) { return {name:name,ok:false,error:String(e && e.message || e)}; }
}
