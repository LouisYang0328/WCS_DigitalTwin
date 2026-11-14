/* Run only against an isolated gateway store:
 * node tests/validate-s7-simulator-fleet.cjs http://127.0.0.1:<test-port>
 * All five S7 listeners use ephemeral ports; only test-owned configs are removed.
 */
'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const platformAuth = require('./platform-auth.cjs');

const baseUrl = process.argv[2];
if (!baseUrl || !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(baseUrl)) {
  console.error('Pass an explicit isolated loopback gateway URL as the first argument.');
  process.exit(2);
}

const apiRoot = '/api/s7/simulators';
const codes = ['TC01', 'TC02', 'TC03', 'TC04', 'TC05'];
const ports = new Map();
const ids = new Map();
const ownedIds = new Set();
const touched = new Set();
const reservations = new Map();
let existingIds = new Set();

async function request(path, method = 'GET', value) {
  const response = await fetch(baseUrl.replace(/\/$/, '') + path, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) })
  });
  const text = response.status === 204 ? '' : await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  return { status: response.status, body };
}

async function ok(path, method = 'GET', body) {
  const result = await request(path, method, body);
  assert.ok(result.status >= 200 && result.status < 300,
    `${method} ${path}: HTTP ${result.status} ${JSON.stringify(result.body)}`);
  return result.body;
}

async function waitFor(path, predicate, message, timeoutMs = 15000) {
  const expires = Date.now() + timeoutMs;
  let result;
  do {
    result = await ok(path);
    if (predicate(result)) return result;
    await delay(100);
  } while (Date.now() < expires);
  assert.fail(`${message}: ${JSON.stringify(result)}`);
}

async function reserve(code, port = 0) {
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  reservations.set(code, server);
  return server.address().port;
}

async function release(code) {
  const server = reservations.get(code);
  if (server?.listening)
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  reservations.delete(code);
}

function blockOf(device) {
  return device.blocks.find(block => block.decoder === 'tc' && block.dbNumber === 2000);
}

function valuesOf(device) {
  return Object.fromEntries((blockOf(device)?.tags || []).map(tag => [tag.name, tag.value]));
}

function remember(result) {
  assert.ok(Array.isArray(result.devices) && Array.isArray(result.failures), 'Bulk connect returns per-device results');
  for (const device of result.devices) {
    assert.ok(codes.includes(device.equipmentCode));
    assert.ok(device.deviceId);
    assert.ok(!existingIds.has(device.deviceId), 'The fleet test cannot own a pre-existing config');
    if (ids.has(device.equipmentCode))
      assert.equal(device.deviceId, ids.get(device.equipmentCode), 'Bulk retries reuse existing endpoint configs');
    ids.set(device.equipmentCode, device.deviceId);
    ownedIds.add(device.deviceId);
  }
}

async function readGood(code, expected, timeoutMs = 20000) {
  return waitFor(`/api/s7/devices/${ids.get(code)}`, device => {
    const block = blockOf(device);
    const values = valuesOf(device);
    return device.isConnected && block?.quality === 'good' && !block.isStale &&
      block.tags.length === 29 && Object.entries(expected).every(([name, value]) => values[name] === value);
  }, `${code} must read its own TC feedback through the actual S7 transport`, timeoutMs);
}

async function main() {
  await platformAuth.login(baseUrl);
  const initial = (await ok(apiRoot)).filter(item => codes.includes(item.equipmentCode));
  assert.deepEqual(initial.map(item => item.equipmentCode).sort(), codes);
  assert.ok(initial.every(item => !item.running), 'The isolated fleet must start stopped');
  for (let index = 0; index < codes.length; index++) {
    const code = codes[index];
    const simulator = await ok(`${apiRoot}/${code}`);
    assert.equal(simulator.deviceName, `${code}-SIM`);
    assert.equal(simulator.ipAddress, '127.0.0.1');
    assert.equal(simulator.tags.length, 29);
    assert.equal(simulator.values.PLC_DEVICECODE, index + 1);
    assert.equal(simulator.values.PLC_TUNNEL, index + 1);
  }

  const devicesBefore = await ok('/api/s7/devices');
  existingIds = new Set(devicesBefore.map(device => device.id));
  for (const code of codes) ports.set(code, await reserve(code));
  assert.equal(new Set(ports.values()).size, 5, 'Every test PLC gets a distinct ephemeral port');
  for (const code of codes) {
    assert.ok(!devicesBefore.some(device => device.ipAddress === '127.0.0.1' && device.port === ports.get(code)),
      `${code} cannot use the endpoint of an existing config`);
    await release(code);
    touched.add(code);
    const started = await ok(`${apiRoot}/${code}/start`, 'POST', { port: ports.get(code) });
    assert.equal(started.port, ports.get(code));
    assert.equal(started.running, true);
    await ok(`${apiRoot}/${code}/stop`, 'POST');
  }

  // One unavailable endpoint must not prevent the other four from connecting.
  const blockedCode = 'TC03';
  await reserve(blockedCode, ports.get(blockedCode));
  const partial = await ok(apiRoot + '/connect-all', 'POST', { mode: 'manual', codes });
  remember(partial);
  assert.deepEqual(partial.devices.map(item => item.equipmentCode).sort(), codes.filter(code => code !== blockedCode));
  assert.equal(partial.failures.length, 1);
  assert.equal(partial.failures[0].equipmentCode, blockedCode);
  assert.ok(partial.failures[0].detail, 'A failed fleet endpoint includes a useful diagnosis');
  assert.equal((await ok(`${apiRoot}/${blockedCode}`)).running, false);
  for (const code of codes.filter(code => code !== blockedCode))
    await readGood(code, { PLC_DEVICECODE: codes.indexOf(code) + 1, PLC_TUNNEL: codes.indexOf(code) + 1 });
  console.log('PASS: an occupied fleet port reports one failure while four independent S7 sessions remain available.');

  await release(blockedCode);
  const connected = await ok(apiRoot + '/connect-all', 'POST', { mode: 'manual', codes });
  remember(connected);
  assert.equal(connected.failures.length, 0);
  assert.equal(connected.devices.length, 5);
  assert.equal(new Set(ids.values()).size, 5, 'The five simulators have independent gateway device IDs');
  const baselineDevices = await Promise.all(codes.map(async (code, index) => {
    const device = await readGood(code, { PLC_DEVICECODE: index + 1, PLC_TUNNEL: index + 1 });
    assert.equal(device.name, `${code}-SIM`);
    assert.equal(device.ipAddress, '127.0.0.1');
    assert.equal(device.port, ports.get(code));
    assert.equal(device.isSimulation, true);
    assert.equal(device.rack, 0);
    assert.equal(device.slot, 0);
    assert.equal(blockOf(device).readLength, 70);
    return device;
  }));
  const repeated = await ok(apiRoot + '/connect-all', 'POST', { codes });
  remember(repeated);
  assert.equal(repeated.failures.length, 0);
  assert.equal(repeated.devices.length, 5);
  const list = await ok('/api/s7/devices');
  for (const code of codes)
    assert.equal(list.filter(device => device.ipAddress === '127.0.0.1' && device.port === ports.get(code)).length, 1);
  const legacy = await ok('/api/s7/simulator');
  assert.equal(legacy.equipmentCode, 'TC01');
  assert.equal(legacy.port, ports.get('TC01'), 'Legacy simulator endpoints remain aliases of TC01');
  console.log('PASS: bulk retry recovers the fifth PLC; all five real S7 connections have separate IDs, ports and device numbers.');

  const expected = new Map();
  for (let index = 0; index < codes.length; index++) {
    const code = codes[index];
    const patch = {
      PLC_HEARTBEAT: 500 + index,
      PLC_LOCATX: 10000 + index * 7000,
      PLC_LOCATY: 1800 + index * 900,
      PLC_LOCATZ: 4500 + index * 250,
      PLC_ERROR: index % 2 === 0 ? 1001 + index : 0,
      PLC_PATTERN: index % 2 === 0 ? 2 : 1,
      PLC_DISPATCH: index % 2,
      PLC_VANSTATE: index % 2,
      PLC_TASK: 0xffffffff - index,
      PLC_TASKNO: 4000000000 + index
    };
    const written = await ok(`${apiRoot}/${code}/values`, 'PUT', { values: patch });
    assert.equal(written.mode, 'manual');
    expected.set(code, { ...valuesOf(baselineDevices[index]), ...patch });
  }
  await Promise.all(codes.map(async code => {
    const device = await readGood(code, expected.get(code));
    assert.deepEqual(valuesOf(device), expected.get(code), `${code}'s complete S7 readback is isolated`);
    const bytes = Buffer.from(blockOf(device).rawBase64, 'base64');
    assert.equal(bytes.readUInt16BE(2), expected.get(code).PLC_DEVICECODE);
    assert.equal(bytes.readUInt16BE(4), expected.get(code).PLC_TUNNEL);
    assert.equal(bytes.readUInt32BE(50), expected.get(code).PLC_LOCATX);
    assert.equal(bytes.readUInt32BE(66), expected.get(code).PLC_TASKNO);
  }));
  const invalid = await request(`${apiRoot}/TC02/values`, 'PUT', {
    values: { PLC_ERROR: 2222, PLC_TASKNO: 4294967296 }
  });
  assert.equal(invalid.status, 400);
  const snapshots = (await ok(apiRoot)).filter(item => codes.includes(item.equipmentCode));
  for (const simulator of snapshots)
    assert.deepEqual(simulator.values, expected.get(simulator.equipmentCode),
      'Invalid input cannot partially update one PLC or alter any other simulator');
  console.log('PASS: different coordinates, alarms, load states and UInt32 task IDs survive five S7 sessions without cross-talk.');

  // Stop one real TCP peer. The other four must keep producing fresh good reads.
  const goodBeforeStop = await Promise.all(codes.filter(code => code !== blockedCode).map(async code =>
    [code, (await readGood(code, expected.get(code))).blocks[0].readCount]));
  await ok(`${apiRoot}/${blockedCode}/stop`, 'POST');
  const disconnected = await waitFor(`/api/s7/devices/${ids.get(blockedCode)}`, device =>
    !device.isConnected && blockOf(device)?.hasData && blockOf(device)?.isStale && blockOf(device)?.quality !== 'good',
    'Stopping TC03 must invalidate only TC03', 20000);
  assert.equal(disconnected.isConnected, false);
  await Promise.all(goodBeforeStop.map(async ([code, readCount]) => {
    const device = await waitFor(`/api/s7/devices/${ids.get(code)}`, device =>
      device.isConnected && blockOf(device)?.quality === 'good' && blockOf(device)?.readCount > readCount,
      `${code} must continue fresh reads while TC03 is stopped`);
    assert.deepEqual(valuesOf(device), expected.get(code));
  }));

  const collision = await request(`${apiRoot}/${blockedCode}/start`, 'POST', { port: ports.get('TC04') });
  assert.ok([400, 409].includes(collision.status), 'A PLC cannot take another simulator\'s configured endpoint');
  const stillStopped = await ok(`${apiRoot}/${blockedCode}`);
  assert.equal(stillStopped.running, false);
  assert.equal(stillStopped.port, ports.get(blockedCode), 'A rejected port change retains the original endpoint');
  const unaffected = await readGood('TC04', expected.get('TC04'));
  assert.equal(unaffected.port, ports.get('TC04'));
  await ok(`${apiRoot}/${blockedCode}/start`, 'POST', { port: ports.get(blockedCode) });
  await readGood(blockedCode, expected.get(blockedCode), 25000);
  console.log('PASS: one PLC can stop/reconnect without interrupting four peers; duplicate ports are rejected without changing endpoints.');

  // Reset belongs to one PLC, including its own equipment/aisle defaults.
  await ok(`${apiRoot}/TC05/reset`, 'POST');
  const reset = await ok(`${apiRoot}/TC05`);
  assert.equal(reset.values.PLC_DEVICECODE, 5);
  assert.equal(reset.values.PLC_TUNNEL, 5);
  assert.equal(reset.values.PLC_ERROR, 0);
  assert.equal(reset.mode, 'manual');
  assert.equal(reset.running, true);
  for (const code of codes.filter(code => code !== 'TC05'))
    assert.deepEqual((await ok(`${apiRoot}/${code}`)).values, expected.get(code), 'Reset cannot affect other PLC memories');
  assert.ok((await ok('/api/s7/devices')).filter(device => existingIds.has(device.id)).length === existingIds.size,
    'Existing gateway configs remain present');
  console.log('PASS: per-equipment reset preserves the other four PLCs and retains its own equipment/aisle identity.');
}

async function cleanup() {
  for (const code of [...reservations.keys()]) await release(code);
  // Also collect a successfully created config if an assertion ran before the
  // connect-all response could be recorded. Match only our reserved endpoints.
  if (ports.size) {
    const devices = await ok('/api/s7/devices');
    for (const device of devices)
      if (!existingIds.has(device.id) && device.ipAddress === '127.0.0.1' && [...ports.values()].includes(device.port))
        ownedIds.add(device.id);
  }
  for (const id of ownedIds) {
    const removed = await request(`/api/s7/devices/${id}`, 'DELETE');
    assert.ok([204, 404].includes(removed.status), 'Remove only fleet-test-owned gateway configs');
  }
  for (const code of touched) await ok(`${apiRoot}/${code}/stop`, 'POST');
}

main().then(cleanup).then(() => console.log('All five-PLC local S7 fleet integration checks passed.'))
  .catch(async error => {
    console.error(error);
    try { await cleanup(); } catch (cleanupError) { console.error('Cleanup failed:', cleanupError.message); }
    process.exitCode = 1;
  });
