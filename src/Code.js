// Sheet layer + web app entry. Pure logic is in Logic.js (shared global scope).

var SHEETS = {
  apps: 'For Letter',
  classes: 'Classes',
  responses: 'Responses',
  letters: 'Letters',
  staff: 'Staff'
};
var PII_HEADER = 'Specific Elements of Personal Information Shared (e.g., Name, Email, ID)';

// ---- Web API (called by the GitHub Pages front end) ----
// Script Properties required: FIREBASE_API_KEY, ALLOWED_DOMAIN (e.g. ddsb.ca)

function doGet() {
  return json_({ ok: true, service: 'EDSTA app collector' });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var email = verifyIdToken_(req.idToken);
    if (req.action === 'bootstrap') return json_({ ok: true, data: getBootstrapData(email) });
    if (req.action === 'save') {
      return json_({ ok: true, result: saveSelections(req.classNames || [], req.items || [], !!req.replace, email) });
    }
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Validates a Firebase ID token with Google and returns the verified email, or throws.
function verifyIdToken_(idToken) {
  if (!idToken) throw new Error('Not signed in');
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('FIREBASE_API_KEY');
  var domain = props.getProperty('ALLOWED_DOMAIN');
  if (!key || !domain) throw new Error('Server not configured (FIREBASE_API_KEY / ALLOWED_DOMAIN)');

  var cache = CacheService.getScriptCache();
  var ck = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
  var hit = cache.get(ck);
  if (hit) return hit;

  var resp = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(key),
    { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Sign-in expired. Please sign in again.');
  var u = (JSON.parse(resp.getContentText()).users || [])[0];
  if (!u || !isAllowedEmail(u.email, u.emailVerified, domain)) {
    throw new Error('This account is not allowed. Use your ' + domain + ' account.');
  }
  var email = String(u.email).toLowerCase();
  var staffSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.staff);
  var listed = staffSheet && staffSheet.getLastRow() > 1
    ? staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; })
    : [];
  if (!isStaffListed(email, listed)) {
    throw new Error('Your account is not on the staff list. Ask the administrator to add ' + email + '.');
  }
  cache.put(ck, email, 300);
  return email;
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('EDSTA')
    .addItem('Set up tabs', 'setup')
    .addItem('Rebuild letters', 'rebuildLetters')
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEETS.responses)) {
    var r = ss.insertSheet(SHEETS.responses);
    r.getRange(1, 1, 1, 5).setValues([['Class', 'App', 'Purpose', 'Submitted by', 'Updated']]).setFontWeight('bold');
    r.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEETS.letters)) ss.insertSheet(SHEETS.letters);
  if (!ss.getSheetByName(SHEETS.staff)) {
    var st = ss.insertSheet(SHEETS.staff);
    st.getRange(1, 1).setValue('Allowed staff email (leave empty to allow everyone in the domain)').setFontWeight('bold');
    st.setColumnWidth(1, 420);
  }
  if (!ss.getSheetByName(SHEETS.classes)) {
    var c = ss.insertSheet(SHEETS.classes);
    c.getRange(1, 1, 1, 2).setValues([['Class', 'Grade(s)']]).setFontWeight('bold');
  }
}

function readTable_(name, width) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Missing tab: ' + name + '. Run EDSTA > Set up tabs.');
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, width).getValues()
    .filter(function (row) { return String(row[0]).trim() !== ''; });
}

function readApps_() {
  return readTable_(SHEETS.apps, 2).map(function (r) {
    return { name: String(r[0]).trim(), pii: String(r[1]) };
  });
}

function readClasses_() {
  return readTable_(SHEETS.classes, 2).map(function (r) {
    return { name: String(r[0]).trim(), grades: String(r[1]).trim() };
  });
}

function readResponses_() {
  return readTable_(SHEETS.responses, 5).map(function (r) {
    return { className: String(r[0]), app: String(r[1]), purpose: String(r[2]),
             submittedBy: String(r[3]), updated: String(r[4]) };
  });
}

function getBootstrapData(user) {
  return {
    classes: readClasses_(),
    apps: readApps_(),
    responses: readResponses_(),
    user: user
  };
}

function saveSelections(classNames, items, replace, who) {
  var classes = readClasses_(), apps = readApps_();
  var validClass = {}, validApp = {};
  classes.forEach(function (c) { validClass[normName(c.name)] = c.name; });
  apps.forEach(function (a) { validApp[normName(a.name)] = a.name; });

  var cleanClasses = classNames.map(function (n) {
    var v = validClass[normName(n)];
    if (!v) throw new Error('Unknown class: ' + n);
    return v;
  });
  if (!cleanClasses.length) throw new Error('Choose at least one class');

  var existing = readResponses_();
  // Apps already saved but no longer on the list may be kept as they are.
  var keepOffList = {};
  existing.forEach(function (r) { if (!validApp[normName(r.app)]) keepOffList[normName(r.app)] = true; });
  var cleanItems = items.map(function (it) {
    var v = validApp[normName(it.app)];
    if (!v && !keepOffList[normName(it.app)]) throw new Error('Unknown app: ' + it.app);
    return { app: v || String(it.app).trim(), purpose: it.purpose };
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Re-read inside the lock so concurrent saves are not lost.
    var current = readResponses_();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    var merged = upsertResponses(current, cleanClasses, cleanItems, !!replace, who, now);

    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.responses);
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, 5).clearContent();
    if (merged.length) {
      var rng = sh.getRange(2, 1, merged.length, 5);
      rng.setNumberFormat('@'); // text only: a purpose like "=SUM(1)" must never run as a formula
      rng.setValues(merged.map(function (r) {
        return [r.className, r.app, r.purpose, r.submittedBy, r.updated];
      }));
    }
    rebuildLetters();
    return { ok: true, saved: cleanItems.length * cleanClasses.length };
  } finally {
    lock.releaseLock();
  }
}

function rebuildLetters() {
  var result = buildLetters(readClasses_(), readResponses_(), readApps_());
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.letters);
  if (!sh) throw new Error('Missing Letters tab. Run EDSTA > Set up tabs.');
  sh.clear();

  var rows = [];
  result.tables.forEach(function (t) {
    if (!t.rows.length) return;
    rows.push([t.className + (t.grades ? ' (' + t.grades + ')' : ''), '', '']);
    rows.push(['Software Application', PII_HEADER, 'Purpose for Disclosure']);
    t.rows.forEach(function (r) {
      rows.push([(r.flagged ? '⚠ ' : '') + r.app, r.pii, r.purpose]);
    });
    rows.push(['', '', '']);
  });
  rows.push(['Classes with no response', '', '']);
  result.noResponse.forEach(function (n) { rows.push([n, '', '']); });
  if (result.unknownClass.length) {
    rows.push(['', '', '']);
    rows.push(['Unknown class (not in Classes tab)', '', '']);
    result.unknownClass.forEach(function (r) { rows.push([r.className, r.app, r.purpose]); });
  }
  var out = sh.getRange(1, 1, rows.length, 3);
  out.setNumberFormat('@');
  out.setValues(rows);
  sh.setColumnWidth(1, 260); sh.setColumnWidth(2, 420); sh.setColumnWidth(3, 360);
  sh.getRange(1, 1, rows.length, 3).setWrap(true).setVerticalAlignment('top');
}
