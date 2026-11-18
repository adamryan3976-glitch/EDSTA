// Pure logic: no Apps Script globals, so it can be unit-tested in Node.

var NOT_ON_LIST = '(no longer on approved list)';

function normName(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

// Adds/updates rows for each class; when replace is true (one class only),
// that class's rows become exactly `items`.
function upsertResponses(existing, classNames, items, replace, who, now) {
  if (replace && classNames.length !== 1) {
    throw new Error('replace requires exactly one class');
  }
  items.forEach(function (it) {
    if (!String(it.purpose == null ? '' : it.purpose).trim()) {
      throw new Error('Purpose required for ' + it.app);
    }
  });

  var out = existing.slice();
  if (replace) {
    var cn = normName(classNames[0]);
    out = out.filter(function (r) { return normName(r.className) !== cn; });
  }
  classNames.forEach(function (className) {
    items.forEach(function (it) {
      var idx = -1;
      for (var i = 0; i < out.length; i++) {
        if (normName(out[i].className) === normName(className) && normName(out[i].app) === normName(it.app)) {
          idx = i;
          break;
        }
      }
      var row = {
        className: className,
        app: it.app.trim(),
        purpose: String(it.purpose).trim(),
        submittedBy: who,
        updated: now
      };
      if (idx >= 0) out[idx] = row; else out.push(row);
    });
  });
  return out;
}

function buildLetters(classes, responses, apps) {
  var byApp = {};
  apps.forEach(function (a) { byApp[normName(a.name)] = a; });
  var known = {};
  classes.forEach(function (c) { known[normName(c.name)] = true; });

  var tables = classes.map(function (c) {
    var rows = responses
      .filter(function (r) { return normName(r.className) === normName(c.name); })
      .map(function (r) {
        var a = byApp[normName(r.app)];
        return {
          app: a ? a.name : r.app,
          pii: a ? a.pii : NOT_ON_LIST,
          purpose: r.purpose,
          flagged: !a
        };
      })
      .sort(function (x, y) {
        var a = normName(x.app), b = normName(y.app);
        return a < b ? -1 : a > b ? 1 : 0;
      });
    return { className: c.name, grades: c.grades, rows: rows };
  });

  return {
    tables: tables,
    unknownClass: responses.filter(function (r) { return !known[normName(r.className)]; }),
    noResponse: tables.filter(function (t) { return t.rows.length === 0; })
      .map(function (t) { return t.className; })
  };
}

// True only for a verified email whose domain is exactly `domain` (with or without a leading @).
function isAllowedEmail(email, verified, domain) {
  var d = String(domain || '').trim().toLowerCase().replace(/^@/, '');
  var e = String(email || '').trim().toLowerCase();
  if (!verified || !d || !e) return false;
  var at = e.lastIndexOf('@');
  return at > 0 && e.slice(at + 1) === d;
}

// Optional allow-list: an empty list means "no extra restriction".
function isStaffListed(email, list) {
  var allowed = (list || []).map(function (x) { return String(x || '').trim().toLowerCase(); })
    .filter(function (x) { return x; });
  if (!allowed.length) return true;
  var e = String(email || '').trim().toLowerCase();
  return !!e && allowed.indexOf(e) >= 0;
}

// Cell value to text. Sheets turns "1/2" into a date; fmtDate(d) must give back "1/2".
function cellText(v, fmtDate) {
  if (Object.prototype.toString.call(v) === '[object Date]') return fmtDate(v);
  var t = String(v == null ? '' : v).trim();
  // A date that was already converted to text, e.g. "Fri Jan 02 2026 00:00:00 GMT-0500 (...)".
  var m = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{2}) \d{4} \d{2}:\d{2}:\d{2} GMT/.exec(t);
  if (m) {
    var month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[1]);
    if (month >= 0) return (month + 1) + '/' + parseInt(m[2], 10);
  }
  return t;
}

// Splits the "ALL" tab into apps that share no PII and apps already on the board letter.
// Anything else is a "For Letter" app and is handled separately.
function classifyAllApps(rows) {
  var noPii = [], district = [];
  rows.forEach(function (r) {
    var name = String(r.name == null ? '' : r.name).trim();
    if (!name) return;
    var t = normName(r.text);
    if (t.indexOf('no pii') === 0) noPii.push(name);
    else if (t.indexOf('district letter') >= 0) district.push(name);
  });
  return { noPii: noPii, district: district };
}

if (typeof module !== 'undefined') {
  module.exports = { normName: normName, upsertResponses: upsertResponses, buildLetters: buildLetters, isAllowedEmail: isAllowedEmail, isStaffListed: isStaffListed, cellText: cellText, classifyAllApps: classifyAllApps, NOT_ON_LIST: NOT_ON_LIST };
}
