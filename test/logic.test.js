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
