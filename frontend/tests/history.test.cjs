const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/history.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const compiled = { exports: {} };
new Function('require', 'module', 'exports', code)(require, compiled, compiled.exports);
const history = compiled.exports;
const row = (id, extra = {}) => ({
  id, date: '2026-10-31T00:00:00Z', caseId: 'CASE-1', file: 'photo.jpg', bodySite: 'Arm',
  age: 'N/A', calibrated: false, colors: [], ...extra,
});

test('calibration status comes from saved result, including perfect zero error', () => {
  assert.equal(history.mapHistoryRecord({ id: 1, deltaE00: 8, resultJson: { calibration: { is_calibrated: false } } }).calibrated, false);
  assert.equal(history.mapHistoryRecord({ id: 1, deltaE00: 0, resultJson: { calibration: { is_calibrated: true } } }).calibrated, true);
  assert.equal(history.mapHistoryRecord({ id: 1, deltaE00: 4 }).calibrated, false);
});

test('refresh keeps pending rows while remote deletes remain authoritative', () => {
  const pending = row('local-1', { clientId: 'client-1', syncStatus: 'pending' });
  const result = history.mergeHistory([row('1', { syncStatus: 'synced' })], [pending, row('2')]);
  assert.deepEqual(result.map(r => r.id).sort(), ['1', 'local-1']);
});

test('legacy local-only rows are preserved on refresh', () => {
  const result = history.mergeHistory([], [row('1793400000000')]);
  assert.equal(result.length, 1);
  assert.equal(result[0].syncStatus, 'pending');
});

test('lost save response is reconciled using the same client ID', () => {
  const remote = row('17', { clientId: 'same', syncStatus: 'synced' });
  const pending = row('local-1', { clientId: 'same', syncStatus: 'pending' });
  assert.deepEqual(history.mergeHistory([remote], [pending]).map(r => r.id), ['17']);
});

test('failed and unauthorized deletions reject; local rows never call the API', async () => {
  const saved = row('1', { syncStatus: 'synced' });
  const original = [saved];
  for (const status of [401, 404, 500]) {
    await assert.rejects(history.deleteHistoryRecord(saved, 'token', async () => ({ ok: false, status })));
    assert.equal(original.length, 1);
  }
  let calls = 0;
  await history.deleteHistoryRecord(row('local-1', { syncStatus: 'pending' }), 'token', async () => { calls++; });
  assert.equal(calls, 0);
});

test('delete sends authorization and waits for confirmed success', async () => {
  let sent;
  await history.deleteHistoryRecord(row('1', { syncStatus: 'synced' }), 'signed-token', async (url, options) => {
    sent = { url, options };
    return { ok: true, json: async () => ({ success: true }) };
  });
  assert.equal(sent.options.headers.Authorization, 'Bearer signed-token');
  assert.equal(sent.url, '/api/records/1');
  await assert.rejects(history.deleteHistoryRecord(row('1'), 'token', async () => ({ ok: true, json: async () => ({}) })));
});

test('retry submits the original saved snapshot and stable client ID', async () => {
  const snapshot = { calibration: { is_calibrated: true }, measured_colours: { skin: [{ hex: '#123456' }] } };
  const pending = row('local-1', { clientId: 'client-1', syncStatus: 'pending', resultJson: snapshot });
  let payload;
  const saved = await history.sendHistoryRecord(pending, 'signed-token', async (url, options) => {
    payload = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, 'Bearer signed-token');
    return { ok: true, json: async () => ({ success: true, id: '21', createdAt: '2026-10-31T01:00:00Z' }) };
  });
  assert.deepEqual(payload.resultJson, snapshot);
  assert.equal(payload.clientRecordId, 'client-1');
  assert.equal(saved.syncStatus, 'synced');
  assert.equal(saved.id, '21');
  await assert.rejects(history.sendHistoryRecord(pending, 'token', async () => ({ ok: false, status: 503 })));
  assert.equal(pending.syncStatus, 'pending');
});

test('legacy caches migrate without crossing accounts, and storage failure propagates', async () => {
  const data = new Map([
    ['bcc_history_a@example.test', JSON.stringify([row('1793400000000')])],
    ['bcc_history_b@example.test', JSON.stringify([row('2')])],
  ]);
  global.localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  };
  // The fallback also supports environments where IndexedDB is unavailable.
  delete global.indexedDB;
  const a = await history.readHistoryCache('A@EXAMPLE.TEST');
  const b = await history.readHistoryCache('b@example.test');
  assert.equal(a[0].syncStatus, 'pending');
  assert.equal(b[0].id, '2');
  await history.persistHistoryCache('a@example.test', a);
  assert.equal(JSON.parse(data.get('bcc_history_b@example.test'))[0].id, '2');
  global.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
  await assert.rejects(history.persistHistoryCache('a@example.test', a), /Quota exceeded/);
  delete global.localStorage;
});

test('401 is an authentication failure for both save and delete', async () => {
  const request = async () => ({ ok: false, status: 401 });
  await assert.rejects(history.sendHistoryRecord(row('local-1'), 'expired', request), history.HistoryAuthenticationError);
  await assert.rejects(history.deleteHistoryRecord(row('1'), 'expired', request), history.HistoryAuthenticationError);
});
