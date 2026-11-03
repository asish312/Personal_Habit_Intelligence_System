/** PHIS_Notifications_v1.0.0.gs — Optional push notification adapter. Apps Script files share one global scope. */

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
