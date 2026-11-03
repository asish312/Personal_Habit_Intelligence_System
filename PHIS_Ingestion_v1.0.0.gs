/** PHIS_Ingestion_v1.0.0.gs — Daily record ingestion and idempotent upsert. Apps Script files share one global scope. */

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
