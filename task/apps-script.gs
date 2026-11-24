// Constellations → Google Sheets receiver.
// Setup: open the Google Sheet › Extensions › Apps Script › paste this file › Deploy › New deployment ›
// type "Web app", Execute as "Me", Who has access "Anyone" › copy the /exec URL into CFG.SHEET_URL (task.js).
// Each finished session appends 1 row to tab "participants" and one row per trial to tab "trials".

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    append(ss, 'participants', [data.participant]);
    append(ss, 'trials', data.trials);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return json({ ok: true, service: 'Constellations endpoint' }); }

function append(ss, name, rows) {
  if (!rows || !rows.length) return;
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  let header = sh.getLastRow() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  const added = Object.keys(rows[0]).filter(k => header.indexOf(k) < 0);
  if (added.length) {
    header = header.concat(added);
    sh.getRange(1, 1, 1, header.length).setValues([header]);
  }
  const cell = v => (v === undefined || v === null) ? ''
    : (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;  // block formula injection from free-text fields
  const values = rows.map(r => header.map(h => cell(r[h])));
  sh.getRange(sh.getLastRow() + 1, 1, values.length, header.length).setValues(values);
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
