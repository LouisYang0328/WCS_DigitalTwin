/* Run only against the isolated gateway created by tests/run-checks.ps1:
 * node tests/validate-s7-simulator.cjs http://127.0.0.1:<test-port>
 * The test allocates an ephemeral S7 port and removes its own device config.
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

const apiRoot = '/api/s7/simulator';
let ownedDeviceId;
let reservedServer;
let simulatorTouched = false;

// Expected wire addresses independently transcribed from the TC feedback map.
const tags = [
  ['PLC_HEARTBEAT', 0, 'UInt16'], ['PLC_DEVICECODE', 2, 'UInt16'], ['PLC_TUNNEL', 4, 'UInt16'],
  ['PLC_STARTPOSX', 6, 'UInt16'], ['PLC_STARTPOSY', 8, 'UInt16'], ['PLC_STARTPOSZ', 10, 'UInt16'],
  ['PLC_ENDPOSX', 12, 'UInt16'], ['PLC_ENDPOSY', 14, 'UInt16'], ['PLC_ENDPOSZ', 16, 'UInt16'],
  ['PLC_TASKTYPE', 18, 'UInt16'], ['PLC_TASK', 20, 'UInt32'], ['PLC_TASKEXE', 24, 'UInt16'],
  ['PLC_ERROR', 26, 'UInt16'], ['PLC_TRAYTYPE', 28, 'UInt16'], ['PLC_TASKFINISHSTATE', 30, 'UInt16'],
  ['PLC_TASKABNORMALFEEDBACK', 32, 'UInt16'], ['PLC_CLAIMGOODS', 34, 'UInt16'], ['PLC_DISPATCH', 36, 'UInt16'],
  ['PLC_LOAD', 38, 'UInt16'], ['PLC_PATTERN', 40, 'UInt16'], ['PLC_VANSTATE', 42, 'UInt16'],
  ['PLC_POSX', 44, 'UInt16'], ['PLC_POSY', 46, 'UInt16'], ['PLC_POSZ', 48, 'UInt16'],
  ['PLC_LOCATX', 50, 'UInt32'], ['PLC_LOCATY', 54, 'UInt32'], ['PLC_LOCATZ', 58, 'UInt32'],
  ['PLC_RELEASEFINISH', 64, 'UInt16'], ['PLC_TASKNO', 66, 'UInt32']
];

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

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function closeServer() {
  if (reservedServer?.listening)
    await new Promise((resolve, reject) => reservedServer.close(error => error ? reject(error) : resolve()));
  reservedServer = undefined;
}

async function sendMalformedFrame(port) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let connected = false;
    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error('The simulator did not close the malformed TCP session'));
    });
    socket.once('connect', () => {
      connected = true;
      // TPKT length 6 is shorter than the minimum COTP frame. A malformed
      // client must be isolated without faulting the listener or other clients.
      socket.write(Buffer.from([3, 0, 0, 6]));
    });
    socket.once('error', error => {
      if (!connected || error.code !== 'ECONNRESET') reject(error);
    });
    socket.once('close', () => {
      socket.setTimeout(0);
      if (connected) resolve();
    });
  });
}

function tagValues(block) {
  return Object.fromEntries(block.tags.map(tag => [tag.name, tag.value]));
}

async function main() {
  await platformAuth.login(baseUrl);
  const initial = await ok(apiRoot);
  assert.equal(initial.running, false, 'The isolated simulator must start stopped');
  assert.equal(initial.mode, 'manual');
  assert.equal(initial.ipAddress, '127.0.0.1');
  assert.equal(initial.dbNumber, 2000);
  assert.equal(initial.tags.length, 29);
  assert.equal(initial.values.PLC_LOCATX, 30000);
  assert.equal(initial.values.PLC_LOCATY, 5200);
  assert.equal(initial.values.PLC_LOCATZ, 5000);

  const devicesBefore = await ok('/api/s7/devices');
  reservedServer = net.createServer(socket => socket.destroy());
  const port = await listen(reservedServer);
  assert.ok(!devicesBefore.some(device => device.ipAddress === '127.0.0.1' && device.port === port),
    'The ephemeral S7 endpoint cannot belong to a pre-existing device');

  simulatorTouched = true;
  const occupied = await request(apiRoot + '/start', 'POST', { port });
  assert.ok([400, 409].includes(occupied.status), `Occupied port must be rejected: ${JSON.stringify(occupied)}`);
  assert.equal((await ok(apiRoot)).running, false, 'A failed bind cannot report a running PLC');
  await closeServer();

  const started = await ok(apiRoot + '/start', 'POST', { port });
  assert.equal(started.running, true);
  assert.equal(started.port, port);
  assert.equal(started.ipAddress, '127.0.0.1');
  const again = await ok(apiRoot + '/start', 'POST', { port });
  assert.equal(again.running, true, 'Starting the same port is idempotent');
  console.log('PASS: default manual values, loopback listener, occupied-port reporting and safe retry.');

  // Set every point to a distinctive value, including unsigned integer limits.
  const values = Object.fromEntries(tags.map(([name], index) => [name, 101 + index]));
  Object.assign(values, {
    PLC_HEARTBEAT: 65535,
    PLC_DEVICECODE: 1,
    PLC_PATTERN: 2,
    PLC_ERROR: 1001,
    PLC_DISPATCH: 0,
    PLC_VANSTATE: 1,
    PLC_LOCATX: 12345,
    PLC_LOCATY: 6789,
    PLC_LOCATZ: 5000,
    PLC_TASK: 0xffffffff,
    PLC_TASKNO: 4000000000
  });
  await ok(apiRoot + '/values', 'PUT', { values });
  const written = await ok(apiRoot);
  assert.deepEqual(written.values, values);
  assert.equal(written.mode, 'manual');

  const connected = await ok(apiRoot + '/connect', 'POST');
  assert.ok(connected.deviceId, 'One-click connect returns the persisted gateway device ID');
  ownedDeviceId = connected.deviceId;
  assert.ok(!devicesBefore.some(device => device.id === ownedDeviceId), 'This test owns its new gateway config');
  const online = await waitFor(`/api/s7/devices/${ownedDeviceId}`, device =>
    device.isConnected && device.blocks.some(block => block.quality === 'good' &&
      block.tags.length === 29 && tagValues(block).PLC_TASKNO === values.PLC_TASKNO),
    'The gateway must read the manually entered values through S7/TCP');
  assert.equal(online.isSimulation, true);
  assert.equal(online.ipAddress, '127.0.0.1');
  assert.equal(online.port, port);
  assert.equal(online.rack, 0);
  assert.equal(online.slot, 0);
  const block = online.blocks.find(block => block.decoder === 'tc');
  assert.equal(block.dbNumber, 2000);
  assert.equal(block.startAddress, 0);
  assert.equal(block.isStale, false);
  assert.deepEqual(tagValues(block), values, 'All 29 manually entered values must survive S7 decoding');
  const wireBytes = Buffer.from(block.rawBase64, 'base64');
  assert.equal(wireBytes.length, 70);
  for (const [name, offset, type] of tags) {
    const point = block.tags.find(tag => tag.name === name);
    assert.equal(point.address, `${type === 'UInt32' ? 'DBD' : 'DBW'}${offset}`);
    const wireValue = type === 'UInt32' ? wireBytes.readUInt32BE(offset) : wireBytes.readUInt16BE(offset);
    assert.equal(wireValue, values[name], `${name} has the documented big-endian wire representation`);
  }
  const readback = await ok(`/api/s7/devices/${ownedDeviceId}/tags`);
  assert.equal(readback.blocks[0].quality, 'good');
  assert.equal(readback.blocks[0].tags.find(tag => tag.name === 'PLC_TASKNO').fullAddress, 'DB2000.DBD66');
  const activity = await ok(apiRoot);
  assert.ok(activity.clientCount >= 1, 'The S7 gateway has an actual open TCP session');
  assert.ok(activity.readCount > 0, 'S7 protocol reads are counted');
  assert.ok(Number.isFinite(Date.parse(activity.lastReadAt)));

  const reused = await ok(apiRoot + '/connect', 'POST');
  assert.equal(reused.deviceId, ownedDeviceId, 'One-click connect reuses the same endpoint');
  assert.equal((await ok('/api/s7/devices')).filter(device => device.id === ownedDeviceId).length, 1);
  console.log('PASS: one-click registration and real S7 gateway readback of all 29 points, DB addresses and UInt32 limits.');

  await sendMalformedFrame(port);
  const afterMalformedBaseline = await ok(apiRoot);
  const afterMalformed = await waitFor(apiRoot, sample => sample.running && sample.readCount > afterMalformedBaseline.readCount,
    'A malformed TCP client cannot interrupt the running simulator');
  assert.ok(afterMalformed.clientCount >= 1, 'The ordinary gateway S7 session remains connected');
  const healthyAfterMalformed = await waitFor(`/api/s7/devices/${ownedDeviceId}`, device =>
    device.isConnected && device.blocks[0].quality === 'good' &&
      device.blocks[0].readCount > block.readCount,
    'The gateway continues fresh S7 reads after a malformed client');
  assert.deepEqual(tagValues(healthyAfterMalformed.blocks[0]), values);
  console.log('PASS: malformed TCP frames are isolated and the simulator continues real S7 reads.');

  const invalidValues = [
    { PLC_ERROR: -1 },
    { PLC_ERROR: 65536 },
    { PLC_LOCATX: 4294967296 },
    { PLC_ERROR: 1.5 },
    { PLC_ERROR: '1' },
    { PLC_ERROR: null },
    { NOT_A_PLC_TAG: 5 }
  ];
  for (const invalid of invalidValues) {
    const result = await request(apiRoot + '/values', 'PUT', {
      values: { PLC_PATTERN: 4, ...invalid }
    });
    assert.equal(result.status, 400, `Invalid input must fail: ${JSON.stringify(invalid)} => ${JSON.stringify(result)}`);
    assert.deepEqual((await ok(apiRoot)).values, values, 'Invalid batches cannot partially modify other points');
  }
  const modeError = await request(apiRoot + '/mode', 'PUT', { mode: 'bad-mode' });
  assert.equal(modeError.status, 400);
  await delay(650);
  assert.deepEqual((await ok(apiRoot)).values, values, 'Manual values remain fixed across automatic timer ticks');
  console.log('PASS: invalid/unknown point input is atomic and manual values remain stable.');

  await ok(apiRoot + '/mode', 'PUT', { mode: 'auto' });
  const auto = await ok(apiRoot);
  assert.equal(auto.mode, 'auto');
  await waitFor(apiRoot, sample => sample.mode === 'auto' &&
    sample.values.PLC_HEARTBEAT !== auto.values.PLC_HEARTBEAT,
    'Automatic mode advances the PLC heartbeat', 5000);
  await ok(apiRoot + '/values', 'PUT', { values: { PLC_ERROR: 2222, PLC_HEARTBEAT: 4321 } });
  const manual = await ok(apiRoot);
  assert.equal(manual.mode, 'manual', 'Editing a point switches automatic generation to manual mode');
  assert.equal(manual.values.PLC_ERROR, 2222);
  await delay(650);
  assert.deepEqual((await ok(apiRoot)).values, manual.values, 'Automatic generation cannot overwrite submitted manual values');
  console.log('PASS: automatic signals advance and saving manual data stops automatic overwrite.');

  await waitFor(`/api/s7/devices/${ownedDeviceId}`, device =>
    device.blocks[0].quality === 'good' && tagValues(device.blocks[0]).PLC_ERROR === 2222,
    'Gateway reads the latest manual override');
  const stopped = await ok(apiRoot + '/stop', 'POST');
  assert.equal(stopped.running, false);
  assert.equal(stopped.clientCount, 0);
  const failed = await waitFor(`/api/s7/devices/${ownedDeviceId}`, device =>
    !device.isConnected && device.blocks[0].isStale && device.blocks[0].quality !== 'good',
    'Stopping the listener must invalidate the real gateway sample', 20000);
  assert.equal(failed.blocks[0].hasData, true, 'Disconnected data is retained as an explicitly invalid historical sample');
  await ok(apiRoot + '/start', 'POST', { port });
  const recovered = await waitFor(`/api/s7/devices/${ownedDeviceId}`, device =>
    device.isConnected && device.blocks[0].quality === 'good' &&
      tagValues(device.blocks[0]).PLC_ERROR === 2222,
    'Restarting the local PLC allows the gateway to reconnect', 25000);
  assert.equal(recovered.blocks[0].isStale, false);
  console.log('PASS: stopping the PLC invalidates gateway quality; restarting recovers real fresh data.');

  await ok(apiRoot + '/mode', 'PUT', { mode: 'auto' });
  await ok(apiRoot + '/reset', 'POST');
  const reset = await ok(apiRoot);
  assert.equal(reset.mode, 'manual');
  assert.deepEqual(reset.values, initial.values, 'Reset restores the documented initial point values');
  assert.equal(reset.running, true, 'Resetting values does not stop the S7 listener');
  console.log('PASS: reset restores initial manual values while the S7 PLC remains available.');
}

async function cleanup() {
  await closeServer();
  if (ownedDeviceId) {
    const removed = await request(`/api/s7/devices/${ownedDeviceId}`, 'DELETE');
    assert.ok([204, 404].includes(removed.status), 'Remove only the test-owned device');
  }
  if (simulatorTouched) await ok(apiRoot + '/stop', 'POST');
}

main().then(cleanup).then(() => console.log('All local S7 PLC simulator integration checks passed.'))
  .catch(async error => {
    console.error(error);
    try { await cleanup(); } catch (cleanupError) { console.error('Cleanup failed:', cleanupError.message); }
    process.exitCode = 1;
  });
