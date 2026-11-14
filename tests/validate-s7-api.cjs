/* Run with the gateway active: node tests/validate-s7-api.cjs
 * Creates temporary unreachable loopback devices, checks the multi-device /
 * multi-DB contract, then removes only the test-owned configs.
 */
'use strict';

const assert = require('node:assert/strict');
const platformAuth = require('./platform-auth.cjs');
const baseUrl = process.env.S7_GATEWAY_URL || 'http://127.0.0.1:5080';
const createdIds = [];

async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  let body = null;
  if (response.status !== 204) {
    try { body = await response.json(); } catch (_) { body = null; }
  }
  return { response, body };
}

function devicePayload(name, ipAddress, blocks) {
  return {
    name,
    ipAddress,
    port: 9,
    rack: 0,
    slot: 0,
    cpuType: 'S7-1200',
    blocks
  };
}

const tcBlock = {
  name: 'TC 反馈区',
  dbNumber: 2000,
  startAddress: 0,
  readLength: 70,
  pollIntervalMs: 500,
  decoder: 'tc',
  enabled: true
};
const rawBlock = {
  name: '库存缓存',
  dbNumber: 2100,
  startAddress: 0,
  readLength: 64,
  pollIntervalMs: 1000,
  decoder: 'raw',
  enabled: true
};

async function create(payload, expectedStatus = 202) {
  const result = await request('/api/s7/devices', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(result.response.status, expectedStatus,
    `create ${payload.name}: ${result.response.status} ${JSON.stringify(result.body)}`);
  if (expectedStatus === 202) createdIds.push(result.body.id);
  return result;
}

async function main() {
  const anonymous = await request('/api/s7/devices');
  assert.equal(anonymous.response.status, 401);
  await platformAuth.login(baseUrl);
  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.readOnly, true);

  const suffix = Date.now().toString(36);
  const first = await create(devicePayload(`TEST-${suffix}-A`, '127.0.0.2', [tcBlock, rawBlock]));
  assert.equal(first.body.blocks.length, 2);
  assert.ok(first.body.blocks.every(block => block.hasData === false));
  assert.equal(first.body.blocks[0].decoder, 'tc');
  assert.equal(first.body.blocks[1].decoder, 'raw');

  const second = await create(devicePayload(`TEST-${suffix}-B`, '127.0.0.3', [rawBlock]));
  assert.equal(second.body.blocks.length, 1);

  const duplicate = await create(devicePayload(`TEST-${suffix}-DUP`, '127.0.0.2', [rawBlock]), 400);
  assert.match(duplicate.body.detail, /已存在/);

  const list = await request('/api/s7/devices');
  assert.equal(list.response.status, 200);
  assert.ok(Array.isArray(list.body));
  const firstSummary = list.body.find(item => item.id === first.body.id);
  assert.ok(firstSummary, 'first device must be listed');
  assert.equal(firstSummary.blocks.length, 2);
  assert.ok(firstSummary.blocks.every(block => block.rawBase64 === null && block.tags.length === 0),
    'list endpoint must not return tag or byte payloads');

  const detail = await request(`/api/s7/devices/${first.body.id}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.blocks.length, 2);
  const retainedIds = detail.body.blocks.map(block => block.id);
  const update = await request(`/api/s7/devices/${first.body.id}`, {
    method: 'PUT',
    body: JSON.stringify(devicePayload(`TEST-${suffix}-A`, '127.0.0.2', [
      { ...tcBlock, id: retainedIds[0] },
      { ...rawBlock, id: retainedIds[1] },
      {
        name: '报警缓存',
        dbNumber: 2200,
        startAddress: 0,
        readLength: 32,
        pollIntervalMs: 2000,
        decoder: 'raw',
        enabled: true
      }
    ]))
  });
  assert.equal(update.response.status, 200, JSON.stringify(update.body));
  assert.equal(update.body.blocks.length, 3, 'PUT must add a DB block');
  assert.deepEqual(update.body.blocks.slice(0, 2).map(block => block.id), retainedIds,
    'existing DB block IDs must be preserved during edit');
  assert.equal(update.body.blocks[2].name, '报警缓存');
  assert.equal(update.body.blocks[2].pollIntervalMs, 2000);

  const invalid = await request(`/api/s7/devices/${first.body.id}`, {
    method: 'PUT',
    body: JSON.stringify(devicePayload(`TEST-${suffix}-A`, '127.0.0.2', []))
  });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.body.detail, /1–32/);

  const nullBlocks = await request(`/api/s7/devices/${first.body.id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...devicePayload(`TEST-${suffix}-A`, '127.0.0.2', []), blocks: null })
  });
  assert.equal(nullBlocks.response.status, 400);
  assert.match(nullBlocks.body.detail, /1–32/);

  console.log('PASS: multiple PLCs, multiple DB blocks, endpoint dedupe, summary/detail split, edit and validation.');
}

async function cleanup() {
  for (const id of createdIds) {
    await request(`/api/s7/devices/${id}/disconnect`, { method: 'POST' });
    await request(`/api/s7/devices/${id}`, { method: 'DELETE' });
  }
}

main()
  .then(cleanup)
  .then(() => console.log('PASS: temporary S7 device configs removed.'))
  .catch(async error => {
    try { await cleanup(); } catch (_) { }
    console.error(error);
    process.exitCode = 1;
  });
