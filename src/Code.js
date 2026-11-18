// Sheet layer + web app entry. Pure logic is in Logic.js (shared global scope).

var SHEETS = {
  apps: 'For Letter',
  classes: 'Classes',
  responses: 'Responses',
  letters: 'Letters'
};
var PII_HEADER = 'Specific Elements of Personal Information Shared (e.g., Name, Email, ID)';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('EDSTA App Disclosure')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
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

function getBootstrapData() {
  return {
    classes: readClasses_(),
    apps: readApps_(),
    responses: readResponses_(),
    user: Session.getActiveUser().getEmail()
  };
}

function saveSelections(classNames, items, replace) {
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
    var who = Session.getActiveUser().getEmail();
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
