'use strict';
// Run only against the isolated gateway started by run-checks.ps1.
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const platformAuth = require('./platform-auth.cjs');
const base = process.argv[2];
assert.match(base || '', /^http:\/\/127\.0\.0\.1:\d+\/?$/, 'Pass an isolated gateway URL');
const root = '/api/s7/simulators';
const codes = ['CV01', 'CV02'];
const ids = new Map();
const touched = new Set();
const source = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/conveyor-s7-source-map.json')));
async function request(route, method = 'GET', body) {
  const response = await fetch(base.replace(/\/$/, '') + route, {
    method, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const result = response.status === 204 ? null : await response.json();
  return { status: response.status, body: result };
}
async function ok(route, method, body) {
  const result = await request(route, method, body);
  assert.ok(result.status >= 200 && result.status < 300, `${route}: ${result.status} ${JSON.stringify(result.body)}`);
  return result.body;
}
async function wait(route, predicate, message, timeout = 20000) {
  const until = Date.now() + timeout;
  let value;
  do { value = await ok(route); if (predicate(value)) return value; await delay(100); } while (Date.now() < until);
  assert.fail(`${message}: ${JSON.stringify(value)}`);
}
const valuesOf = detail => Object.fromEntries(detail.blocks.flatMap(block => block.tags).map(tag => [tag.name, tag.value]));
const fresh = detail => detail.isConnected && detail.blocks.every(block => block.quality === 'good' && !block.isStale);
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function main() {
  await platformAuth.login(base);
  const originalTC = (await ok(root)).filter(s => s.kind !== 'conveyor');
  const profiles = await ok('/api/s7/profiles');
  for (const [index, code] of codes.entries()) {
    const snapshot = await ok(`${root}/${code}`);
    assert.equal(snapshot.kind, 'conveyor');
    assert.equal(snapshot.floor, index + 1);
    assert.equal(snapshot.dbNumber, 600);
    assert.equal(snapshot.tags.length, index === 0 ? 301 : 166);
    assert.equal(snapshot.conveyors.length, index === 0 ? 100 : 55);
    assert.equal(snapshot.conveyors.filter(c => c.mapped).length, index === 0 ? 96 : 55);
    assert.ok(!snapshot.conveyors.some(c => c.id === '2056'), 'Do not invent a source for model-only 2056');
    const definitions = profiles.filter(p => p.id.startsWith(code.toLowerCase() + '-'));
    assert.equal(definitions.length, index === 0 ? 4 : 2);
    assert.ok(definitions.every(p => p.readLength <= 960));
    touched.add(code);
    await ok(`${root}/${code}/start`, 'POST', { port: await freePort() });
    await ok(`${root}/${code}/stop`, 'POST');
  }
  const connected = await ok(root + '/connect-all', 'POST', { codes, mode: 'manual' });
  assert.equal(connected.failures.length, 0);
  assert.deepEqual(connected.devices.map(d => d.equipmentCode).sort(), codes);
  for (const device of connected.devices) ids.set(device.equipmentCode, device.deviceId);
  for (const [index, code] of codes.entries()) {
    const detail = await wait(`/api/s7/devices/${ids.get(code)}`, fresh, `${code} real S7 readback`);
    assert.equal(detail.blocks.length, index === 0 ? 4 : 2);
    assert.ok(detail.blocks.every(block => block.dbNumber === 600));
    const values = valuesOf(detail);
    assert.equal(Object.keys(values).length, index === 0 ? 301 : 166);
    for (const definition of source.groups.find(group => group.equipmentCode === code).tags) {
      const block = detail.blocks.find(block => block.tags.some(tag => tag.name === definition.name));
      const tag = block.tags.find(tag => tag.name === definition.name);
      assert.equal(tag.dataType, definition.dataType);
      assert.equal(tag.address, `${definition.dataType === 'String' ? 'DBB' : 'DBW'}${definition.offset}`);
      assert.equal(typeof values[definition.name], definition.dataType === 'String' ? 'string' : 'number');
    }
  }
  console.log('PASS: CV01/1F and CV02/2F expose all 467 source points via six real DB600 S7 read blocks.');
  const patches = {
    CV01: { PLC_STATUS_STATE_101001: 1, PLC_STATUS_HASGOODS_101001: 1, PLC_STATUS_CONTNO_101001: '0001234567',
      PLC_STATUS_STATE_101100: 2, PLC_STATUS_HASGOODS_101100: 0, PLC_STATUS_CONTNO_101100: 'END001' },
    CV02: { PLC_STATUS_STATE_202001: 0, PLC_STATUS_HASGOODS_202001: 0, PLC_STATUS_CONTNO_202001: '',
      PLC_STATUS_STATE_202055: 1, PLC_STATUS_HASGOODS_202055: 1, PLC_STATUS_CONTNO_202055: '0000000055' }
  };
  const stable = new Map();
  for (const code of codes) {
    const written = await ok(`${root}/${code}/values`, 'PUT', { values: patches[code] });
    stable.set(code, written.values);
    const detail = await wait(`/api/s7/devices/${ids.get(code)}`, d => fresh(d) && Object.entries(patches[code]).every(([tag, value]) => valuesOf(d)[tag] === value), 'Manual CV values across first and last read slices');
    const firstTag = code === 'CV01' ? 'PLC_STATUS_CONTNO_101001' : 'PLC_STATUS_CONTNO_202001';
    const block = detail.blocks.find(block => block.tags.some(t => t.name === firstTag));
    const bytes = Buffer.from(block.rawBase64, 'base64');
    assert.equal(bytes[6], 10, 'Local string memory advertises capacity 10');
    assert.equal(bytes[7], patches[code][firstTag].length, 'Local S7 STRING current length');
    assert.equal(bytes.subarray(8, 8 + bytes[7]).toString('ascii'), patches[code][firstTag]);
  }
  for (const value of ['12345678901', '托盘', 123, null]) {
    const result = await request(`${root}/CV01/values`, 'PUT', { values: { PLC_STATUS_STATE_101001: 2, PLC_STATUS_CONTNO_101001: value } });
    assert.equal(result.status, 400, `Invalid String input: ${JSON.stringify(value)}`);
    assert.deepEqual((await ok(`${root}/CV01`)).values, stable.get('CV01'), 'Invalid mixed patch is atomic');
  }
  const emptyUnknown = await request(`${root}/CV02/values`, 'PUT', { values: { PLC_STATUS_STATE_202056: 1 } });
  assert.equal(emptyUnknown.status, 400, 'No fabricated point for source 202056');
  assert.deepEqual((await ok(`${root}/CV02`)).values, stable.get('CV02'));
  console.log('PASS: independent manual status/occupancy and ASCII barcodes preserve leading zeroes across first/last chunks; invalid patches are atomic.');
  const cv2Before = await ok(`/api/s7/devices/${ids.get('CV02')}`);
  await ok(`${root}/CV01/stop`, 'POST');
  await wait(`/api/s7/devices/${ids.get('CV01')}`, d => !d.isConnected && d.blocks.every(b => b.quality !== 'good'), 'Stopped CV01 must invalidate all of its read blocks');
  await wait(`/api/s7/devices/${ids.get('CV02')}`, d => fresh(d) && d.blocks.every((b, i) => b.readCount > cv2Before.blocks[i].readCount), 'CV02 must keep polling while CV01 is stopped');
  await ok(`${root}/CV01/start`, 'POST');
  await wait(`/api/s7/devices/${ids.get('CV01')}`, d => fresh(d) && valuesOf(d).PLC_STATUS_CONTNO_101001 === '0001234567', 'CV01 reconnect preserves manual values');
  await ok(`${root}/CV02/mode`, 'PUT', { mode: 'auto' });
  const before = await ok(`${root}/CV02`);
  await wait(`${root}/CV02`, s => s.values.PLC_STATUS_HEART !== before.values.PLC_STATUS_HEART, 'CV02 automatic heartbeat changes', 5000);
  await ok(`${root}/CV02/values`, 'PUT', { values: { PLC_STATUS_CONTNO_202055: '0099887766' } });
  assert.equal((await ok(`${root}/CV02`)).mode, 'manual');
  const afterTC = (await ok(root)).filter(s => s.kind !== 'conveyor');
  assert.deepEqual(afterTC.map(s => ({ code: s.equipmentCode, running: s.running, mode: s.mode, values: s.values })),
    originalTC.map(s => ({ code: s.equipmentCode, running: s.running, mode: s.mode, values: s.values })), 'Conveyor operations cannot alter the TC simulators');
  console.log('PASS: independent floor disconnect/reconnect, automatic heartbeat and manual override leave all TC instances unchanged.');
}
async function cleanup() {
  for (const id of ids.values()) await ok(`/api/s7/devices/${id}`, 'DELETE');
  for (const code of touched) await ok(`${root}/${code}/stop`, 'POST');
}
main().then(cleanup).then(() => console.log('All conveyor S7 simulation checks passed.')).catch(async error => {
  console.error(error); try { await cleanup(); } catch (e) { console.error(e.message); } process.exitCode = 1;
});
