// Constellations → Google Sheets receiver.
// Setup: open your Google Sheet › Extensions › Apps Script › paste this whole file › Save ›
// Deploy › New deployment › type "Web app", Execute as "Me", Who has access "Anyone" › Deploy › copy the /exec URL.
// Every finished session adds 1 row to the "participants" tab and one row per trial (15 for a full session) to the "trials" tab.
// The sheet itself stays private to you: "Anyone" only lets the game send rows in, nobody can read them.

const MAX_TRIALS = 300;   // a full session has 15 trials, so anything far bigger is not from the game

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = JSON.parse(e.postData.contents);
    const p = data && data.participant;
    if (!p || !p.pid || !Array.isArray(data.trials) || !data.trials.length || data.trials.length > MAX_TRIALS) {
      return json({ ok: false, error: 'not a Constellations session' });
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    append(ss, 'participants', [p]);
    append(ss, 'trials', data.trials);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return json({ ok: true, service: 'Constellations receiver is up and running' }); }

function append(ss, name, rows) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  let header = sh.getLastRow() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  const added = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => header.indexOf(k) < 0);
  if (added.length) {
    header = header.concat(added);
    sh.getRange(1, 1, 1, header.length).setValues([header]);
  }
  const cell = v => (v === undefined || v === null) ? ''
    : (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;  // stops typed text being run as a formula
  const values = rows.map(r => header.map(h => cell(r[h])));
  sh.getRange(sh.getLastRow() + 1, 1, values.length, header.length).setValues(values);
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
