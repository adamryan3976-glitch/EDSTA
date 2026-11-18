// Sheet layer + web app entry. Pure logic is in Logic.js (shared global scope).

var SHEETS = {
  apps: 'For Letter',
  all: 'ALL',
  classes: 'Classes',
  responses: 'Responses',
  letters: 'Letters',
  staff: 'Staff',
  letterMeta: 'ClassLetters'
};
var TEMPLATE_DOC_ID = '1Td5TGtu2K_0r8BGLD-37ONKZcWXKYsk_QKFYL6UeF5s'; // DDSB parent letter template
var LETTERS_FOLDER_NAME = 'EDSTA Parent Letters'; // or set Script Property LETTERS_FOLDER_ID
var PII_HEADER = 'Specific Elements of Personal Information Shared (e.g., Name, Email, ID)';

// ---- Web API (called by the GitHub Pages front end) ----
// Settings. Script Properties FIREBASE_API_KEY / ALLOWED_DOMAIN override these if set.
// The Firebase web API key is public by design; access is enforced by the token check below.
var DEFAULT_FIREBASE_API_KEY = 'AIzaSyAjps31IMsnkDPReuPOTxKASW5gT69HrvQ';
var DEFAULT_ALLOWED_DOMAIN = 'ddsb.ca';

function doGet() {
  return json_({ ok: true, service: 'EDSTA app collector' });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var email = verifyIdToken_(req.idToken);
    if (req.action === 'bootstrap') return json_({ ok: true, data: getBootstrapData(email) });
    if (req.action === 'save') {
      return json_({ ok: true, result: saveSelections(req.classNames || [], req.items || [], !!req.replace, email, req.signature) });
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
  var key = props.getProperty('FIREBASE_API_KEY') || DEFAULT_FIREBASE_API_KEY;
  var domain = props.getProperty('ALLOWED_DOMAIN') || DEFAULT_ALLOWED_DOMAIN;
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
    .addItem('Refresh all parent letter docs', 'refreshAllLetterDocs')
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
  if (!ss.getSheetByName(SHEETS.letterMeta)) {
    var lm = ss.insertSheet(SHEETS.letterMeta);
    lm.getRange(1, 1, 1, 5).setValues([['Class', 'Signature', 'Doc ID', 'Doc URL', 'Updated']]).setFontWeight('bold');
    lm.setFrozenRows(1);
  }
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

function monthDay_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'M/d');
}

// Apps in the ALL tab that need no disclosure: share no PII, or already on the board letter.
function readNoDisclosureApps_(letterApps) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.all);
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .map(function (r) { return { name: r[0], text: r[1] }; });
  var c = classifyAllApps(rows);
  var onLetter = {};
  letterApps.forEach(function (a) { onLetter[normName(a.name)] = true; });
  var seen = {}, out = [];
  function add(list, status) {
    list.forEach(function (n) {
      var k = normName(n);
      if (onLetter[k] || seen[k]) return; // For Letter always wins
      seen[k] = true;
      out.push({ name: n, status: status });
    });
  }
  add(c.noPii, 'nopii');
  add(c.district, 'district');
  return out;
}

function readClasses_() {
  return readTable_(SHEETS.classes, 2).map(function (r) {
    return { name: cellText(r[0], monthDay_), grades: cellText(r[1], monthDay_) };
  });
}

function readResponses_() {
  return readTable_(SHEETS.responses, 5).map(function (r) {
    return { className: String(r[0]), app: String(r[1]), purpose: String(r[2]),
             submittedBy: String(r[3]), updated: String(r[4]) };
  });
}

function getBootstrapData(user) {
  var apps = readApps_();
  return {
    classes: readClasses_(),
    apps: apps,
    others: readNoDisclosureApps_(apps),
    responses: readResponses_(),
    letters: readLetterMeta_().map(function (m) {
      return { className: m.className, signature: m.signature, url: m.docUrl };
    }),
    user: user
  };
}

function saveSelections(classNames, items, replace, who, signature) {
  var cleanSig = cleanSignature(signature);
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
    var letters = refreshLetterDocs_(cleanClasses, cleanSig);
    return { ok: true, saved: cleanItems.length * cleanClasses.length, letters: letters };
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

// ---- Parent letter docs (one live Google Doc per class) ----

function nowText_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

function readLetterMeta_() {
  return readTable_(SHEETS.letterMeta, 5).map(function (r) {
    return { className: String(r[0]), signature: String(r[1]), docId: String(r[2]),
             docUrl: String(r[3]), updated: String(r[4]) };
  });
}

function writeLetterMeta_(rows) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.letterMeta);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 5).clearContent();
  if (!rows.length) return;
  var rng = sh.getRange(2, 1, rows.length, 5);
  rng.setNumberFormat('@');
  rng.setValues(rows.map(function (r) { return [r.className, r.signature, r.docId, r.docUrl, r.updated]; }));
}

function lettersFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty('LETTERS_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  var it = DriveApp.getFoldersByName(LETTERS_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(LETTERS_FOLDER_NAME);
}

// Returns {id, url, shared}. Creates the doc (a copy of the template) on first use.
function ensureLetterDoc_(meta, className) {
  var file = null;
  if (meta.docId) {
    try {
      file = DriveApp.getFileById(meta.docId);
      if (file.isTrashed()) file = null;
    } catch (e) { file = null; }
  }
  if (!file) {
    file = DriveApp.getFileById(TEMPLATE_DOC_ID)
      .makeCopy('EDSTA Parent Letter - ' + className, lettersFolder_());
  }
  var shared = true;
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) { shared = false; } // the board's Google settings may block this
  return { id: file.getId(), url: file.getUrl(), shared: shared };
}

// Replaces the first match of a regex with text, optionally making it a link.
function replacePlaceholder_(body, pattern, value, linkUrl) {
  var found = body.findText(pattern);
  if (!found) return;
  var t = found.getElement().asText();
  var start = found.getStartOffset();
  t.deleteText(start, found.getEndOffsetInclusive());
  t.insertText(start, value);
  if (linkUrl) t.setLinkUrl(start, start + value.length - 1, linkUrl);
}

// Rebuilds the doc from the template, then fills in date, link, signature and table.
// model: {date, url, signature, rows: [[app, pii, purpose], ...]}
function renderLetterDoc_(docId, model) {
  var tpl = DocumentApp.openById(TEMPLATE_DOC_ID).getBody();
  var doc = DocumentApp.openById(docId);
  var body = doc.getBody();
  body.clear();
  for (var i = 0; i < tpl.getNumChildren(); i++) {
    var el = tpl.getChild(i).copy();
    switch (el.getType()) {
      case DocumentApp.ElementType.PARAGRAPH: body.appendParagraph(el); break;
      case DocumentApp.ElementType.LIST_ITEM: body.appendListItem(el); break;
      case DocumentApp.ElementType.TABLE: body.appendTable(el); break;
      case DocumentApp.ElementType.HORIZONTAL_RULE: body.appendHorizontalRule(); break;
      case DocumentApp.ElementType.PAGE_BREAK: body.appendPageBreak(); break;
    }
  }
  var first = body.getChild(0);
  if (body.getNumChildren() > 1 && first.getType() === DocumentApp.ElementType.PARAGRAPH &&
      first.asParagraph().getText() === '') {
    body.removeChild(first);
  }

  replacePlaceholder_(body, '\\[Insert Date\\]', model.date);
  replacePlaceholder_(body, '(?i)<insert link[^>]*>', model.url, model.url);
  replacePlaceholder_(body, '(?i)<Insert Your Name[^>]*>', model.signature);

  var tables = body.getTables();
  if (!tables.length) throw new Error('The template has no table to fill in');
  var tbl = tables[0];
  var hdr = tbl.getRow(0).getCell(0).editAsText();
  var size = hdr.getFontSize(), family = hdr.getFontFamily();
  while (tbl.getNumRows() > 1) tbl.removeRow(tbl.getNumRows() - 1);
  var rows = model.rows.length ? model.rows
    : [['No third-party tools have been recorded for this class yet.', '', '']];
  rows.forEach(function (r) {
    var tr = tbl.appendTableRow();
    r.forEach(function (v) {
      var cell = tr.appendTableCell(String(v));
      var tx = cell.editAsText();
      tx.setItalic(false).setBold(false);
      if (size) tx.setFontSize(size);
      if (family) tx.setFontFamily(family);
    });
  });
  doc.saveAndClose();
}

// signature: text to use for every class in classNames, or null to keep each class's stored one.
function refreshLetterDocs_(classNames, signature) {
  var now = nowText_();
  var meta = readLetterMeta_();
  if (signature !== null) meta = upsertLetterMeta(meta, classNames, signature, now);
  var built = buildLetters(readClasses_(), readResponses_(), readApps_());
  var date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM d, yyyy');
  var out = [];
  classNames.forEach(function (cn) {
    var m = meta.filter(function (x) { return normName(x.className) === normName(cn); })[0];
    try {
      if (!m || !m.signature) throw new Error('No signature saved for ' + cn);
      var d = ensureLetterDoc_(m, cn);
      m.docId = d.id; m.docUrl = d.url; m.updated = now;
      var table = built.tables.filter(function (t) { return normName(t.className) === normName(cn); })[0];
      renderLetterDoc_(m.docId, { date: date, url: m.docUrl, signature: m.signature,
                                  rows: table ? letterTableRows(table) : [] });
      out.push({ className: cn, ok: true, url: m.docUrl, shared: d.shared });
    } catch (err) {
      out.push({ className: cn, ok: false, error: String(err && err.message ? err.message : err) });
    }
  });
  writeLetterMeta_(meta);
  return out;
}

// Menu: re-render every class's letter (e.g. after the template or the app list changed).
function refreshAllLetterDocs() {
  var names = readLetterMeta_().map(function (m) { return m.className; });
  var results = names.map(function (n) { return refreshLetterDocs_([n], null)[0]; });
  var bad = results.filter(function (r) { return !r.ok; });
  SpreadsheetApp.getUi().alert('Refreshed ' + (results.length - bad.length) + ' letter(s).' +
    (bad.length ? '\n\nProblems:\n' + bad.map(function (b) { return b.className + ': ' + b.error; }).join('\n') : ''));
}
