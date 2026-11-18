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

if (typeof module !== 'undefined') {
  module.exports = { normName: normName, upsertResponses: upsertResponses, buildLetters: buildLetters, NOT_ON_LIST: NOT_ON_LIST };
}
