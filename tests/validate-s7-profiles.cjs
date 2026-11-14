/* Run against an isolated gateway store: S7_GATEWAY_URL=http://127.0.0.1:5081
 * node tests/validate-s7-profiles.cjs
 * Uses an ephemeral loopback PLC peer and removes only its own device configs.
 */
'use strict';

const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { FakeS7Plc, tcFeedbackBytes } = require('./fake-s7-plc.cjs');
const platformAuth = require('./platform-auth.cjs');

const baseUrl = process.env.S7_GATEWAY_URL || 'http://127.0.0.1:5080';
const createdIds = [];
const bytes = tcFeedbackBytes();
const shiftedBytes = Buffer.alloc(170);
bytes.copy(shiftedBytes, 100);
shiftedBytes.writeUInt16BE(0x2345, 100);
const plc = new FakeS7Plc(new Map([[2000, bytes], [2050, shiftedBytes], [2100, Buffer.from([1, 2, 3, 4])]]));

// Independently transcribed from TC.xlsx, 设备变量!B19:D47, and design doc 4.3.
const expectedTags = [
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

async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, {
    ...options,
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

async function waitFor(id, predicate, message, timeoutMs = 15000) {
  const expires = Date.now() + timeoutMs;
  let body;
  do {
    const result = await request(`/api/s7/devices/${id}`);
    assert.equal(result.response.status, 200);
    body = result.body;
    if (predicate(body)) return body;
    await delay(100);
  } while (Date.now() < expires);
  assert.fail(`${message}: ${JSON.stringify(body)}`);
}

function verifyTags(block, sourceBytes, startAddress) {
  assert.equal(block.tags.length, 29);
  assert.equal(block.hasData, true);
  assert.equal(block.quality, 'good', 'A successful current sample has good quality');
  assert.equal(block.isStale, false);
  assert.equal(Buffer.from(block.rawBase64, 'base64').length, 70);
  for (const [name, offset, dataType] of expectedTags) {
    const tag = block.tags.find(item => item.name === name);
    assert.ok(tag, `${name} is defined`);
    assert.equal(tag.dataType, dataType, `${name} type`);
    assert.equal(tag.address, `${dataType === 'UInt32' ? 'DBD' : 'DBW'}${startAddress + offset}`, `${name} address`);
    const expectedValue = dataType === 'UInt32' ? sourceBytes.readUInt32BE(offset) : sourceBytes.readUInt16BE(offset);
    assert.equal(tag.value, expectedValue, `${name} must decode the controller's big-endian value`);
  }
  assert.ok(block.tags.every(tag => tag.address !== `DBW${startAddress + 62}`), '62–63 is an undefined gap');
  assert.ok(block.tags.every(tag => !tag.name.startsWith('WCS_')), 'Only PLC feedback points are read');
}

async function main() {
  await platformAuth.login(baseUrl);
  const port = await plc.listen();
  const profiles = await request('/api/s7/profiles');
  assert.equal(profiles.response.status, 200);
  const tc = profiles.body.find(item => item.id === 'tc');
  assert.ok(tc, 'The documented TC profile is discoverable');
  assert.equal(tc.defaultDbNumber, 2000);
  assert.equal(tc.defaultStartAddress, 0);
  assert.equal(tc.readLength, 70);
  assert.deepEqual(tc.tags.map(tag => [tag.name, tag.offset, tag.dataType]), expectedTags);

  const payload = { name: `TEST-TC-${Date.now().toString(36)}`, ipAddress: '127.0.0.1', port, profileId: 'tc' };
  const created = await request('/api/s7/devices', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(created.response.status, 202, JSON.stringify(created.body));
  const id = created.body.id;
  createdIds.push(id);
  assert.equal(created.body.blocks.length, 1, 'A profile provisions its default DB block');
  let online = await waitFor(id, device => device.blocks[0].tags.length === 29, 'First TC read');
  verifyTags(online.blocks[0], bytes, 0);
  assert.equal(online.isConnected, true);
  assert.equal(online.blocks[0].state, 'online');
  assert.ok(plc.requests.some(item => item.dbNumber === 2000 && item.startAddress === 0 && item.count === 70));
  const points = await request(`/api/s7/devices/${id}/tags`);
  assert.equal(points.response.status, 200);
  assert.equal(points.body.readOnly, true);
  assert.equal(points.body.id, id);
  assert.equal(points.body.blocks[0].id, online.blocks[0].id);
  assert.equal(points.body.blocks[0].quality, 'good');
  assert.equal(points.body.blocks[0].isStale, false);
  assert.ok(Number.isFinite(Date.parse(points.body.blocks[0].lastReadAt)), 'Point samples have an ISO timestamp');
  assert.equal(points.body.blocks[0].tags.find(tag => tag.name === 'PLC_HEARTBEAT').fullAddress, 'DB2000.DBW0');
  assert.equal(points.body.blocks[0].tags.find(tag => tag.name === 'PLC_TASKNO').fullAddress, 'DB2000.DBD66');
  console.log('PASS: profile provisioning, S7 handshake, all 29 documented values, unsigned big-endian decoding and DB62 gap.');

  const block = online.blocks[0];
  const blocks = [
    { ...block, pollIntervalMs: 200 },
    { name: 'Shifted TC', dbNumber: 2050, startAddress: 100, readLength: 70, pollIntervalMs: 200, decoder: 'tc', enabled: true },
    { name: 'Raw bytes', dbNumber: 2100, startAddress: 0, readLength: 4, pollIntervalMs: 200, decoder: 'raw', enabled: true },
    { name: 'Missing DB', dbNumber: 9999, startAddress: 0, readLength: 4, pollIntervalMs: 200, decoder: 'raw', enabled: true }
  ];
  const updated = await request(`/api/s7/devices/${id}`, { method: 'PUT', body: JSON.stringify({ ...payload, blocks }) });
  assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
  online = await waitFor(id, device => device.blocks[1].hasData && device.blocks[2].hasData && device.blocks[3].state === 'faulted', 'Independent DB reads');
  verifyTags(online.blocks[0], bytes, 0);
  verifyTags(online.blocks[1], shiftedBytes.subarray(100), 100);
  assert.equal(online.blocks[2].rawBase64, Buffer.from([1, 2, 3, 4]).toString('base64'));
  assert.equal(online.blocks[2].tags.length, 0);
  assert.equal(online.state, 'degraded');
  assert.equal(online.blocks[3].hasData, false, 'A failed first read cannot report data');
  const groupedPoints = await request(`/api/s7/devices/${id}/tags`);
  assert.equal(groupedPoints.response.status, 200);
  assert.equal(groupedPoints.body.blocks.length, 4);
  assert.equal(new Set(groupedPoints.body.blocks.map(item => item.id)).size, 4, 'Point blocks retain independent IDs');
  assert.equal(groupedPoints.body.blocks[0].tags.find(tag => tag.name === 'PLC_HEARTBEAT').fullAddress, 'DB2000.DBW0');
  assert.equal(groupedPoints.body.blocks[1].tags.find(tag => tag.name === 'PLC_HEARTBEAT').fullAddress, 'DB2050.DBW100');
  assert.equal(groupedPoints.body.blocks[1].tags.find(tag => tag.name === 'PLC_HEARTBEAT').value, 0x2345,
    'Same-name signals in different DB blocks retain their own values');
  assert.equal(groupedPoints.body.blocks[3].quality, 'unknown');
  assert.equal(groupedPoints.body.blocks[3].lastReadAt, null);
  const readCount = online.blocks[0].readCount;
  await waitFor(id, device => device.blocks[0].readCount > readCount, 'Healthy DB must continue while another fails');
  console.log('PASS: relative TC offsets, configured DB addresses, RAW bytes and per-block failure isolation.');

  const invalidPayloads = [
    { ...payload, profileId: 'undefined-profile', blocks: undefined },
    { ...payload, blocks: [{ ...blocks[0], readLength: 69 }] },
    { ...payload, blocks: [{ ...blocks[0], decoder: 'undefined-profile' }] }
  ];
  for (const invalidPayload of invalidPayloads) {
    const invalid = await request(`/api/s7/devices/${id}`, { method: 'PUT', body: JSON.stringify(invalidPayload) });
    assert.equal(invalid.response.status, 400, 'Invalid/short profiles must fail before modifying a session');
  }
  const retained = await request(`/api/s7/devices/${id}`);
  assert.equal(retained.body.blocks.length, 4, 'Validation failures preserve the running configuration');
  console.log('PASS: unknown profile/decoder and truncated TC reads are rejected without changing the device.');

  // Keep the listener but reset and reject sessions, so a reconnect cannot erase
  // the failure before the API has reported it.
  plc.rejectConnections = true;
  plc.dropConnections();
  const failed = await waitFor(id, device => device.state === 'reconnecting' && !device.isConnected, 'Connection failure reporting');
  assert.ok(failed.lastError, 'Connection failure includes a diagnosis');
  assert.ok(failed.blocks.filter(item => item.enabled).every(item => item.state !== 'online'),
    'Historical reads must not appear online after their connection is lost');
  assert.ok(failed.blocks.filter(item => item.hasData).every(item => item.quality === 'bad' && item.isStale),
    'Historical values must be explicitly marked bad and stale after a lost connection');
  const connectionsBefore = plc.connections;
  plc.rejectConnections = false;
  const recovered = await waitFor(id, device => device.isConnected && device.blocks[0].readCount > failed.blocks[0].readCount,
    'Automatic reconnect', 25000);
  assert.ok(plc.connections > connectionsBefore, 'Recovery must establish a new S7 connection');
  verifyTags(recovered.blocks[0], bytes, 0);
  assert.equal(recovered.lastError, null);
  console.log('PASS: failed connections invalidate online block states and automatically recover with fresh S7 reads.');

  const disconnected = await request(`/api/s7/devices/${id}/disconnect`, { method: 'POST' });
  assert.equal(disconnected.response.status, 200);
  assert.equal(disconnected.body.enabled, false);
  assert.equal(disconnected.body.state, 'offline');
  assert.ok(disconnected.body.blocks.every(item => item.state !== 'online'));
  assert.ok(disconnected.body.blocks.filter(item => item.hasData).every(item => item.isStale),
    'Explicit disconnect invalidates sample freshness');
  const stoppedReads = disconnected.body.readCount;
  await delay(350);
  const stopped = await request(`/api/s7/devices/${id}`);
  assert.equal(stopped.body.readCount, stoppedReads, 'Disconnect stops polling');
  assert.equal(plc.errors.length, 0, plc.errors.map(error => error.message).join('\n'));
  console.log('PASS: explicit disconnect stops polling and leaves historical reads offline.');
}

async function cleanup() {
  for (const id of createdIds) {
    const removed = await request(`/api/s7/devices/${id}`, { method: 'DELETE' });
    assert.ok(removed.response.status === 204 || removed.response.status === 404, 'Test-owned device cleanup');
  }
  await plc.close();
}

main().then(cleanup).then(() => console.log('All S7 profile and protocol integration checks passed.'))
  .catch(async error => {
    console.error(error);
    try { await cleanup(); } catch (cleanupError) { console.error('Cleanup failed:', cleanupError.message); }
    process.exitCode = 1;
  });
