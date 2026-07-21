/**
 * Success Tutoring Print Colour Settings webhook.
 *
 * Sheet/tab name: print_settings
 * Headers:
 * campusKey | scope | materialType | printMode | settingKey | updatedBy | updatedAt
 */

const SHEET_NAME = 'print_settings';
const HEADERS = ['campusKey', 'scope', 'materialType', 'printMode', 'settingKey', 'updatedBy', 'updatedAt'];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.kind !== 'print-settings') throw new Error('Unsupported payload kind');

    const campusKey = String(body.campusKey || '').trim() || 'global';
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) throw new Error('No settings rows supplied');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    ensureHeaders_(sheet);

    const existing = sheet.getDataRange().getValues();
    const header = existing[0] || HEADERS;
    const campusIdx = header.indexOf('campusKey');
    const settingIdx = header.indexOf('settingKey');

    const incomingKeys = rows.map(row => String(row.settingKey || '').trim()).filter(Boolean);
    const keep = [header];
    for (let i = 1; i < existing.length; i++) {
      const rowCampus = String(existing[i][campusIdx] || '').trim();
      const rowSetting = String(existing[i][settingIdx] || '').trim();
      if (!(rowCampus === campusKey && incomingKeys.includes(rowSetting))) keep.push(existing[i]);
    }

    const outputRows = rows.map(row => HEADERS.map(h => row[h] == null ? '' : row[h]));
    const next = keep.concat(outputRows);
    sheet.clearContents();
    sheet.getRange(1, 1, next.length, HEADERS.length).setValues(next);

    return json_({ ok: true, campusKey, saved: outputRows.length });
  } catch (err) {
    return json_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function ensureHeaders_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length || values[0].join('').trim() === '') {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    return;
  }
  const current = values[0].map(String);
  const missing = HEADERS.some((h, i) => current[i] !== h);
  if (missing) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Optional manual test from the Apps Script editor.
 * Choose myFunction from the function dropdown and click Run.
 * doPost(e) itself is only called properly by the deployed Web App URL.
 */
function myFunction() {
  const fakeEvent = {
    postData: {
      contents: JSON.stringify({
        kind: 'print-settings',
        campusKey: 'parramatta',
        rows: [
          { campusKey: 'parramatta', scope: 'k10', materialType: 'lesson', printMode: 'colour', settingKey: 'k10Lesson', updatedBy: 'Apps Script test', updatedAt: new Date().toISOString() },
          { campusKey: 'parramatta', scope: 'k10', materialType: 'revision', printMode: 'bw', settingKey: 'k10Revision', updatedBy: 'Apps Script test', updatedAt: new Date().toISOString() },
          { campusKey: 'parramatta', scope: 'k10', materialType: 'homework', printMode: 'bw', settingKey: 'k10Homework', updatedBy: 'Apps Script test', updatedAt: new Date().toISOString() },
          { campusKey: 'parramatta', scope: 'k10', materialType: 'other', printMode: 'colour', settingKey: 'k10Other', updatedBy: 'Apps Script test', updatedAt: new Date().toISOString() },
          { campusKey: 'parramatta', scope: 'nonstandard', materialType: 'default', printMode: 'colour', settingKey: 'nonstandardDefault', updatedBy: 'Apps Script test', updatedAt: new Date().toISOString() }
        ]
      })
    }
  };
  const result = doPost(fakeEvent);
  Logger.log(result.getContent());
}
