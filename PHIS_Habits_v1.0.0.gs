/** PHIS_Habits_v1.0.0.gs — Habit catalogue, cadence, status events and per-habit analytics. Apps Script files share one global scope. */

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
  const lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet=phisSpreadsheet_().getSheetByName(PHIS.SHEETS.HABITS);
    const rows=phisReadObjects_(PHIS.SHEETS.HABITS);
    const index=rows.findIndex(function(r){return String(r.habit_id)===habitId;});
    if (index<0) throw new Error("Habit not found: "+habitId);
    const tz=String(phisConfig_().TIMEZONE || "Asia/Kolkata");
    const today=Utilities.formatDate(new Date(),tz,"yyyy-MM-dd");
    sheet.getRange(index+2,6).setValue(false);
    sheet.getRange(index+2,11).setValue(today);
    phisAudit_("HABIT_ARCHIVE",today,"SUCCESS",habitId);
    return {habit_id:habitId,status:"archived",end_date:today};
  } finally {
    lock.releaseLock();
  }
}

function listHabits(includeArchived) {
  const rows=phisReadObjects_(PHIS.SHEETS.HABITS).filter(function(h){
    return includeArchived || String(h.active).toLowerCase()==="true";
  });
  rows.sort(function(a,b){
    const category=String(a.category||"").localeCompare(String(b.category||""));
    return category || String(a.habit_name||"").localeCompare(String(b.habit_name||""));
  });
  return rows.map(function(h){
    return {
      habit_id:String(h.habit_id),
      habit_name:String(h.habit_name),
      category:String(h.category||""),
      cadence:String(h.cadence||"daily"),
      schedule_days:String(h.schedule_days||""),
      active:String(h.active).toLowerCase()==="true",
      target_value:h.target_value,
      unit:String(h.unit||""),
      preferred_time:String(h.preferred_time||""),
      start_date:h.start_date ? phisNormalizeDate_(h.start_date) : "",
      end_date:h.end_date ? phisNormalizeDate_(h.end_date) : ""
    };
  });
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
