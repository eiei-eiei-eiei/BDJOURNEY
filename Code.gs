/**
 * ============================================================
 *  Our Diary v2 — JSON API (GAS) สำหรับ PWA
 *  Backend นี้ทำหน้าที่เป็น API ล้วน ๆ (คืน JSON) ไม่เสิร์ฟ HTML
 *  Frontend เป็น static PWA host แยก (GitHub Pages/Netlify)
 *
 *  วิธีเรียก:
 *   - อ่าน:  GET  ?action=<name>&token=<t>&...      → คืน JSON
 *   - เขียน: POST body = JSON.stringify({action,token,...})
 *            ใช้ Content-Type: text/plain เพื่อเลี่ยง CORS preflight
 *
 *  ข้อมูล: Google Sheet / รูป: Google Drive (เหมือน v1)
 * ============================================================
 */

var PROP = PropertiesService.getScriptProperties();
var SHEET_ENTRIES = 'Entries';
var SHEET_ANNIV  = 'Anniversaries';
var ENTRY_COLS = ['id', 'entryDate', 'createdAt', 'updatedAt', 'title', 'body', 'mood', 'weather', 'location', 'photoIds', 'lat', 'lng'];
var ANNIV_COLS = ['id', 'title', 'date', 'recurring', 'remindDaysBefore', 'note'];

// ============================================================
//  ROUTER
// ============================================================

function doGet(e)  { return handle_(e, e.parameter || {}); }
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return handle_(e, body);
}

/** routing กลาง + ครอบ error เป็น JSON เสมอ */
function handle_(e, p) {
  try {
    var action = p.action;
    var result;
    switch (action) {
      // public
      case 'login':        result = login_(p.pin); break;
      // protected (ต้องมี token)
      case 'bootstrap':    result = bootstrap_(p.token); break;       // ดึง entries+anniv ครั้งเดียว
      case 'addEntry':     result = addEntry_(p.token, p); break;
      case 'updateEntry':  result = updateEntry_(p.token, p); break;
      case 'deleteEntry':  result = deleteEntry_(p.token, p.id); break;
      case 'deletePhoto':  result = deletePhoto_(p.token, p.entryId, p.fileId); break;
      case 'photo':        result = { data: getPhotoData_(p.token, p.id) }; break;
      case 'throwbacks':   result = { items: getThrowbacks_(p.token) }; break;
      case 'addAnniv':     result = addAnniversary_(p.token, p); break;
      case 'deleteAnniv':  result = deleteAnniversary_(p.token, p.id); break;
      default: throw new Error('unknown action: ' + action);
    }
    return json_({ ok: true, data: result });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/** ตอบ JSON (script.googleusercontent.com แนบ Access-Control-Allow-Origin: * ให้เอง) */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  SETUP (รันครั้งเดียว เหมือน v1)
// ============================================================
function setPin(pin) {
  if (!pin || String(pin).length < 4) throw new Error('PIN ควรยาว >= 4 หลัก');
  PROP.setProperty('PIN_HASH', sha256_(String(pin)));
  return 'ตั้ง PIN เรียบร้อย';
}
function setReminderEmails(emails) {
  PROP.setProperty('REMIND_EMAILS', emails || '');
  return 'ตั้งอีเมลเตือนเรียบร้อย';
}
function setup() {
  var ssId = PROP.getProperty('SPREADSHEET_ID');
  var ss = ssId ? SpreadsheetApp.openById(ssId) : SpreadsheetApp.create('Our Diary — Data');
  if (!ssId) PROP.setProperty('SPREADSHEET_ID', ss.getId());

  ensureSheet_(ss, SHEET_ENTRIES, ENTRY_COLS);
  ensureSheet_(ss, SHEET_ANNIV, ANNIV_COLS);
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  if (!PROP.getProperty('DRIVE_FOLDER_ID')) {
    PROP.setProperty('DRIVE_FOLDER_ID', DriveApp.createFolder('Our Diary — Photos').getId());
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyReminder') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyReminder').timeBased().everyDays(1).atHour(8).create();
  return 'Setup เสร็จ! Spreadsheet: ' + ss.getUrl();
}

// ============================================================
//  AUTH
// ============================================================
function login_(pin) {
  var stored = PROP.getProperty('PIN_HASH');
  if (!stored) throw new Error('ยังไม่ได้ตั้ง PIN');
  if (sha256_(String(pin)) === stored) return { token: stored.substring(0, 16) };
  throw new Error('รหัสไม่ถูกต้อง');
}
function checkToken_(token) {
  var stored = PROP.getProperty('PIN_HASH');
  if (!stored || token !== stored.substring(0, 16)) throw new Error('UNAUTHORIZED');
}

// ============================================================
//  READS
// ============================================================

/** ดึงทั้ง entries + anniversaries ในครั้งเดียว ลด roundtrip */
function bootstrap_(token) {
  checkToken_(token);
  var entries = readAll_(SHEET_ENTRIES).map(rowToEntry_).sort(function (a, b) {
    if (a.entryDate === b.entryDate) return b.createdAt - a.createdAt;
    return a.entryDate < b.entryDate ? 1 : -1;
  });
  var today = new Date();
  var anniv = readAll_(SHEET_ANNIV).map(rowToAnniv_);
  anniv.forEach(function (a) { a.daysUntil = daysUntilNext_(a.date, a.recurring, today); });
  anniv.sort(function (a, b) { return a.daysUntil - b.daysUntil; });
  return { entries: entries, anniversaries: anniv, serverDate: formatDate_(today) };
}

function getThrowbacks_(token) {
  checkToken_(token);
  var today = new Date();
  var mmdd = pad2_(today.getMonth() + 1) + '-' + pad2_(today.getDate());
  var thisYear = today.getFullYear();
  return readAll_(SHEET_ENTRIES).map(rowToEntry_)
    .filter(function (e) {
      if (!e.entryDate) return false;
      var p = e.entryDate.split('-');
      return (p[1] + '-' + p[2]) === mmdd && Number(p[0]) < thisYear;
    })
    .map(function (e) { e.yearsAgo = thisYear - Number(e.entryDate.split('-')[0]); return e; })
    .sort(function (a, b) { return b.yearsAgo - a.yearsAgo; });
}

// ============================================================
//  WRITES
// ============================================================
function addEntry_(token, p) {
  checkToken_(token);
  var sh = getSheet_(SHEET_ENTRIES);
  var now = new Date(), id = Utilities.getUuid();
  var photoIds = uploadPhotos_(p.photos, id);
  sh.appendRow([id, p.entryDate || formatDate_(now), now.getTime(), now.getTime(),
    p.title || '', p.body || '', p.mood || '', p.weather || '', p.location || '', photoIds.join(','),
    p.lat || '', p.lng || '']);
  return { id: id, photoIds: photoIds };
}

function updateEntry_(token, p) {
  checkToken_(token);
  var sh = getSheet_(SHEET_ENTRIES);
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (data[r][0] === p.id) {
      var merged = String(data[r][9] || '').split(',').filter(String).concat(uploadPhotos_(p.photos, p.id));
      sh.getRange(r + 1, 1, 1, ENTRY_COLS.length).setValues([[
        p.id, p.entryDate, data[r][2], new Date().getTime(),
        p.title || '', p.body || '', p.mood || '', p.weather || '', p.location || '', merged.join(','),
        p.lat !== undefined ? (p.lat || '') : (data[r][10] || ''),
        p.lng !== undefined ? (p.lng || '') : (data[r][11] || '')
      ]]);
      return { photoIds: merged };
    }
  }
  throw new Error('ไม่พบ entry');
}

function deleteEntry_(token, id) {
  checkToken_(token);
  var sh = getSheet_(SHEET_ENTRIES);
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (data[r][0] === id) {
      String(data[r][9] || '').split(',').filter(String).forEach(trashFile_);
      sh.deleteRow(r + 1);
      return { id: id };
    }
  }
  throw new Error('ไม่พบ entry');
}

function deletePhoto_(token, entryId, fileId) {
  checkToken_(token);
  var sh = getSheet_(SHEET_ENTRIES);
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (data[r][0] === entryId) {
      var ids = String(data[r][9] || '').split(',').filter(String).filter(function (x) { return x !== fileId; });
      sh.getRange(r + 1, 10).setValue(ids.join(','));
      trashFile_(fileId);
      return { photoIds: ids };
    }
  }
  throw new Error('ไม่พบ entry');
}

function addAnniversary_(token, p) {
  checkToken_(token);
  getSheet_(SHEET_ANNIV).appendRow([Utilities.getUuid(), p.title || '', p.date,
    p.recurring ? true : false, Number(p.remindDaysBefore) || 0, p.note || '']);
  return { ok: true };
}
function deleteAnniversary_(token, id) {
  checkToken_(token);
  var sh = getSheet_(SHEET_ANNIV);
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (data[r][0] === id) { sh.deleteRow(r + 1); return { ok: true }; }
  }
  throw new Error('ไม่พบรายการ');
}

// ============================================================
//  PHOTOS
// ============================================================
function uploadPhotos_(photos, entryId) {
  if (!photos || !photos.length) return [];
  var folder = DriveApp.getFolderById(PROP.getProperty('DRIVE_FOLDER_ID'));
  return photos.map(function (ph) {
    var blob = Utilities.newBlob(Utilities.base64Decode(ph.data), ph.mimeType, entryId + '_' + ph.name);
    var file = folder.createFile(blob);
    // share เป็น public-link เพื่อให้ frontend ดึง thumbnail ผ่าน Drive CDN ได้โดยตรง (ไม่ผ่าน GAS)
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getId();
  });
}
function getPhotoData_(token, fileId) {
  checkToken_(token);
  var blob = DriveApp.getFileById(fileId).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}
function trashFile_(fileId) {
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (err) {}
}

// ============================================================
//  DAILY REMINDER
// ============================================================
function dailyReminder() {
  var emails = (PROP.getProperty('REMIND_EMAILS') || '').split(',').map(function (s) { return s.trim(); }).filter(String);
  if (!emails.length) return;
  var today = new Date(), body = [];

  readAll_(SHEET_ANNIV).map(rowToAnniv_).forEach(function (a) {
    var d = daysUntilNext_(a.date, a.recurring, today);
    if (d === 0) body.push('🎉 วันนี้คือ "' + a.title + '"!');
    else if (d === a.remindDaysBefore && a.remindDaysBefore > 0) body.push('⏰ อีก ' + d + ' วันจะถึง "' + a.title + '"');
  });
  var mmdd = pad2_(today.getMonth() + 1) + '-' + pad2_(today.getDate()), thisYear = today.getFullYear();
  readAll_(SHEET_ENTRIES).map(rowToEntry_).forEach(function (e) {
    if (!e.entryDate) return;
    var p = e.entryDate.split('-');
    if ((p[1] + '-' + p[2]) === mmdd && Number(p[0]) < thisYear)
      body.push('📸 วันนี้เมื่อ ' + (thisYear - Number(p[0])) + ' ปีก่อน: "' + (e.title || e.body.substring(0, 30)) + '"');
  });
  if (!body.length) return;
  var url = PROP.getProperty('APP_URL') || ''; // ตั้งด้วย setAppUrl('https://...') = ลิงก์ PWA
  MailApp.sendEmail({ to: emails.join(','), subject: '💌 Our Diary — ความทรงจำวันนี้',
    htmlBody: body.join('<br>') + (url ? '<br><br><a href="' + url + '">เปิดไดอารี่</a>' : '') });
}
function setAppUrl(url) { PROP.setProperty('APP_URL', url); return 'ok'; }

// ============================================================
//  HELPERS
// ============================================================
function getSheet_(name) { return SpreadsheetApp.openById(PROP.getProperty('SPREADSHEET_ID')).getSheetByName(name); }
function readAll_(name) {
  var sh = getSheet_(name), last = sh.getLastRow();
  if (last < 2) return [];
  // อ่านอย่างน้อยตาม ENTRY_COLS เพื่อให้ row[10], row[11] ไม่ undefined แม้ชีทมีแค่ 10 คอลัม
  var cols = Math.max(sh.getLastColumn(), name === SHEET_ENTRIES ? ENTRY_COLS.length : 1);
  return sh.getRange(2, 1, last - 1, cols).getValues();
}

/** รันครั้งเดียวหลัง deploy เพื่อเติม header lat/lng ที่ขาดไป */
function fixEntryHeaders() {
  var sh = getSheet_(SHEET_ENTRIES);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.length < ENTRY_COLS.length) {
    for (var i = headers.length; i < ENTRY_COLS.length; i++) {
      sh.getRange(1, i + 1).setValue(ENTRY_COLS[i]);
    }
    Logger.log('เติม header: ' + ENTRY_COLS.slice(headers.length).join(', '));
  } else {
    Logger.log('Header ครบแล้ว: ' + headers.join(', '));
  }
}
function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.getRange(1, 1, 1, headers.length).setValues([headers]); sh.setFrozenRows(1); }
  return sh;
}
function rowToEntry_(row) {
  return { id: row[0], entryDate: formatDate_(row[1]), createdAt: Number(row[2]) || 0, updatedAt: Number(row[3]) || 0,
    title: row[4], body: row[5], mood: row[6], weather: row[7], location: row[8],
    photoIds: String(row[9] || '').split(',').filter(String),
    lat: row[10] ? Number(row[10]) : null,
    lng: row[11] ? Number(row[11]) : null };
}
function rowToAnniv_(row) {
  return { id: row[0], title: row[1], date: formatDate_(row[2]),
    recurring: row[3] === true || row[3] === 'TRUE', remindDaysBefore: Number(row[4]) || 0, note: row[5] };
}
function daysUntilNext_(dateStr, recurring, today) {
  var p = dateStr.split('-'), t = new Date(today.getFullYear(), today.getMonth(), today.getDate()), target;
  if (recurring) {
    target = new Date(today.getFullYear(), Number(p[1]) - 1, Number(p[2]));
    if (target < t) target = new Date(today.getFullYear() + 1, Number(p[1]) - 1, Number(p[2]));
  } else { target = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  return Math.round((target - t) / 86400000);
}
function formatDate_(d) {
  if (d instanceof Date) return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
  return String(d);
}
function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function sha256_(str) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
