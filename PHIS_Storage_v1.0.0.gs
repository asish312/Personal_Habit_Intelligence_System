/** PHIS_Storage_v1.0.0.gs — Spreadsheet persistence, workbook setup, configuration and audit. Apps Script files share one global scope. */

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
