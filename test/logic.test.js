const test = require('node:test');
const assert = require('node:assert');
const { normName, upsertResponses, buildLetters } = require('../src/Logic.js');

const NOW = '2026-11-18 10:00';
const apps = [
  { name: 'Adobe Acrobat', pii: 'Name, Email' },
  { name: 'anchor', pii: 'name\nemail\npassword' },
  { name: 'Zoom', pii: 'Name' },
];
const classes = [
  { name: '3/4 Smith', grades: '3,4' },
  { name: '1 Jones', grades: '1' },
];

test('normName ignores case and spaces', () => {
  assert.strictEqual(normName('  Adobe Acrobat '), normName('adobe acrobat'));
});

test('upsert adds rows for every selected class', () => {
  const out = upsertResponses([], ['3/4 Smith', '1 Jones'], [{ app: 'Zoom', purpose: 'Calls' }], false, 'a@x.ca', NOW);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out.map(r => r.className).sort(), ['1 Jones', '3/4 Smith']);
  assert.strictEqual(out[0].submittedBy, 'a@x.ca');
});

test('upsert multi-class never removes other apps', () => {
  const existing = [{ className: '1 Jones', app: 'Zoom', purpose: 'old', submittedBy: 'b', updated: 'x' }];
  const out = upsertResponses(existing, ['1 Jones', '3/4 Smith'], [{ app: 'anchor', purpose: 'Audio' }], false, 'a', NOW);
  assert.strictEqual(out.filter(r => r.className === '1 Jones').length, 2);
});

test('upsert updates an existing app purpose, matching case-insensitively', () => {
  const existing = [{ className: '1 Jones', app: 'Zoom', purpose: 'old', submittedBy: 'b', updated: 'x' }];
  const out = upsertResponses(existing, ['1 Jones'], [{ app: ' zoom ', purpose: 'new' }], false, 'a', NOW);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].purpose, 'new');
});

test('upsert replace on single class removes unticked apps', () => {
  const existing = [
    { className: '1 Jones', app: 'Zoom', purpose: 'p', submittedBy: 'b', updated: 'x' },
    { className: '3/4 Smith', app: 'Zoom', purpose: 'p', submittedBy: 'b', updated: 'x' },
  ];
  const out = upsertResponses(existing, ['1 Jones'], [{ app: 'anchor', purpose: 'Audio' }], true, 'a', NOW);
  assert.deepStrictEqual(out.filter(r => r.className === '1 Jones').map(r => r.app), ['anchor']);
  assert.strictEqual(out.filter(r => r.className === '3/4 Smith').length, 1);
});

test('replace with two classes throws', () => {
  assert.throws(() => upsertResponses([], ['a', 'b'], [], true, 'x', NOW), /replace requires exactly one class/);
});

test('empty purpose throws with app name', () => {
  assert.throws(() => upsertResponses([], ['a'], [{ app: 'Zoom', purpose: '  ' }], false, 'x', NOW), /Purpose required for Zoom/);
});

test('buildLetters sorts case-insensitively and looks up pii', () => {
  const resp = [
    { className: '1 Jones', app: 'Zoom', purpose: 'Calls' },
    { className: '1 Jones', app: 'anchor', purpose: 'Audio' },
    { className: '1 Jones', app: 'Adobe Acrobat', purpose: 'PDF' },
  ];
  const t = buildLetters(classes, resp, apps).tables.find(x => x.className === '1 Jones');
  assert.deepStrictEqual(t.rows.map(r => r.app), ['Adobe Acrobat', 'anchor', 'Zoom']);
  assert.strictEqual(t.rows[0].pii, 'Name, Email');
  assert.strictEqual(t.grades, '1');
});

test('multi-line pii is preserved', () => {
  const resp = [{ className: '1 Jones', app: 'ANCHOR', purpose: 'Audio' }];
  const row = buildLetters(classes, resp, apps).tables[1].rows[0];
  assert.strictEqual(row.pii, 'name\nemail\npassword');
  assert.strictEqual(row.app, 'anchor');
});

test('buildLetters flags app missing from list', () => {
  const resp = [{ className: '1 Jones', app: 'Gone App', purpose: 'x' }];
  const row = buildLetters(classes, resp, apps).tables.find(t => t.className === '1 Jones').rows[0];
  assert.strictEqual(row.flagged, true);
  assert.strictEqual(row.pii, '(no longer on approved list)');
});

test('buildLetters reports unknown class and classes with no response', () => {
  const resp = [
    { className: '1 Jones', app: 'Zoom', purpose: 'x' },
    { className: 'Old Class', app: 'Zoom', purpose: 'x' },
  ];
  const out = buildLetters(classes, resp, apps);
  assert.deepStrictEqual(out.noResponse, ['3/4 Smith']);
  assert.strictEqual(out.unknownClass.length, 1);
  assert.strictEqual(out.unknownClass[0].className, 'Old Class');
});

const { isAllowedEmail } = require('../src/Logic.js');

test('isAllowedEmail accepts verified email in the domain, case-insensitively', () => {
  assert.strictEqual(isAllowedEmail('Ann@DDSB.ca', true, 'ddsb.ca'), true);
  assert.strictEqual(isAllowedEmail('ann@ddsb.ca', true, '@ddsb.ca'), true);
});

test('isAllowedEmail rejects unverified, other domains, look-alikes and empty config', () => {
  assert.strictEqual(isAllowedEmail('ann@ddsb.ca', false, 'ddsb.ca'), false);
  assert.strictEqual(isAllowedEmail('ann@gmail.com', true, 'ddsb.ca'), false);
  assert.strictEqual(isAllowedEmail('ann@evil-ddsb.ca', true, 'ddsb.ca'), false);
  assert.strictEqual(isAllowedEmail('ann@ddsb.ca.evil.com', true, 'ddsb.ca'), false);
  assert.strictEqual(isAllowedEmail('ann@ddsb.ca', true, ''), false);
  assert.strictEqual(isAllowedEmail('', true, 'ddsb.ca'), false);
});

const { isStaffListed } = require('../src/Logic.js');

test('isStaffListed allows everyone when the list is empty', () => {
  assert.strictEqual(isStaffListed('a@ddsb.ca', []), true);
  assert.strictEqual(isStaffListed('a@ddsb.ca', ['', '  ']), true);
});

test('isStaffListed matches case-insensitively and ignores spaces', () => {
  assert.strictEqual(isStaffListed('Ann@ddsb.ca', [' ann@DDSB.ca ']), true);
});

test('isStaffListed rejects an email that is not on a non-empty list', () => {
  assert.strictEqual(isStaffListed('student@ddsb.ca', ['ann@ddsb.ca', 'bob@ddsb.ca']), false);
  assert.strictEqual(isStaffListed('', ['ann@ddsb.ca']), false);
});

const { cellText } = require('../src/Logic.js');

test('cellText turns a date cell back into month/day, as in 1/2 for Jan 2', () => {
  const fmt = d => (d.getMonth() + 1) + '/' + d.getDate();
  assert.strictEqual(cellText(new Date(2026, 0, 2), fmt), '1/2');
  assert.strictEqual(cellText(new Date(2026, 6, 8), fmt), '7/8');
});

test('cellText leaves text and numbers alone and trims', () => {
  assert.strictEqual(cellText(' FDK ', () => 'x'), 'FDK');
  assert.strictEqual(cellText(3, () => 'x'), '3');
  assert.strictEqual(cellText(null, () => 'x'), '');
});

test('cellText recognises dates even when instanceof fails (cross-realm Date)', () => {
  const fake = Object.create(Date.prototype);
  const real = new Date(2026, 0, 2);
  const proxy = new Proxy(real, { get: (t, k) => { const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } });
  const fmt = d => (d.getMonth() + 1) + '/' + d.getDate();
  assert.strictEqual(cellText(proxy, fmt), '1/2');
});

test('cellText repairs a date that was already turned into text', () => {
  assert.strictEqual(cellText('Fri Jan 02 2026 00:00:00 GMT-0500 (Eastern Standard Time)', () => 'x'), '1/2');
  assert.strictEqual(cellText('Wed Jul 08 2026 00:00:00 GMT-0400 (Eastern Daylight Time)', () => 'x'), '7/8');
});

const { classifyAllApps } = require('../src/Logic.js');

test('classifyAllApps sorts no-PII and board-letter apps and ignores the rest', () => {
  const rows = [
    { name: '7zip', text: 'No PII required.' },
    { name: 'Odd', text: 'No PII' },
    { name: 'Acadience', text: 'This tool is on the District Letter and does NOT need to be included' },
    { name: 'Zoom', text: 'Name, Email' },
    { name: '', text: 'No PII required.' },
  ];
  const out = classifyAllApps(rows);
  assert.deepStrictEqual(out.noPii, ['7zip', 'Odd']);
  assert.deepStrictEqual(out.district, ['Acadience']);
});

test('classifyAllApps is case-insensitive and tolerates blanks', () => {
  const out = classifyAllApps([{ name: 'A', text: ' no pii required ' }, { name: 'B', text: null }]);
  assert.deepStrictEqual(out.noPii, ['A']);
  assert.deepStrictEqual(out.district, []);
});

const { cleanSignature, upsertLetterMeta, letterTableRows } = require('../src/Logic.js');

test('cleanSignature trims, collapses line breaks and spaces, keeps wording', () => {
  assert.strictEqual(cleanSignature('  Ms. Lyons\n and   Mr. Smith '), 'Ms. Lyons and Mr. Smith');
});

test('cleanSignature requires text and caps length at 200', () => {
  assert.throws(() => cleanSignature('   '), /Signature required/);
  assert.throws(() => cleanSignature(null), /Signature required/);
  assert.strictEqual(cleanSignature('x'.repeat(300)).length, 200);
});

test('upsertLetterMeta sets signature for each class and keeps existing doc ids', () => {
  const existing = [{ className: '1 Jones', signature: 'old', docId: 'D1', docUrl: 'U1', updated: 'x' }];
  const out = upsertLetterMeta(existing, ['1 jones', '3/4 Smith'], 'Ms. J', NOW);
  const jones = out.find(r => r.className === '1 Jones');
  assert.strictEqual(jones.signature, 'Ms. J');
  assert.strictEqual(jones.docId, 'D1');
  assert.strictEqual(jones.updated, NOW);
  const smith = out.find(r => r.className === '3/4 Smith');
  assert.strictEqual(smith.docId, '');
  assert.strictEqual(out.length, 2);
});

test('letterTableRows lists app, pii, purpose and leaves out apps no longer on the list', () => {
  const rows = [
    { app: 'A', pii: 'name', purpose: 'p1', flagged: false },
    { app: 'Gone', pii: '(no longer on approved list)', purpose: 'p2', flagged: true },
  ];
  assert.deepStrictEqual(letterTableRows({ rows: rows }), [['A', 'name', 'p1']]);
});
