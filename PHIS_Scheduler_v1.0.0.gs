/** PHIS_Scheduler_v1.0.0.gs — Time-trigger setup and daily orchestration. Apps Script files share one global scope. */

function setupPHISTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger){
    if (["runDailyJob"].indexOf(trigger.getHandlerFunction())>=0) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("runDailyJob").timeBased().everyDays(1).atHour(6).create();
  phisAudit_("TRIGGER_SETUP","","SUCCESS","Daily job scheduled near 6 AM project timezone");
  return {ok:true,trigger:"runDailyJob"};
}
