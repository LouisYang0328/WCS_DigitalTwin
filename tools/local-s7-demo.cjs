#!/usr/bin/env node
/*
 * Local development S7 peer for the WCS twin.
 * It binds only to loopback and speaks the same read-only S7 subset as the
 * integration fixture, so the gateway validates the real transport path.
 * Start the gateway first, then run: node tools/local-s7-demo.cjs
 */
'use strict';

const { FakeS7Plc } = require('../tests/fake-s7-plc.cjs');
const { setTimeout: delay } = require('node:timers/promises');

const args = new Map(process.argv.slice(2).map(arg => {
  const [key, value = true] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));
const port = Number(args.get('port') || 1102);
const gatewayUrl = String(args.get('gateway') || 'http://127.0.0.1:5080').replace(/\/$/, '');
const deviceName = String(args.get('name') || 'TC01-SIM');
const register = args.get('register') !== 'false' && !args.has('no-register');
const FORK_CENTER_MM = 5000;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Invalid --port; expected 1..65535.');
  process.exit(2);
}

function demoBytes(nowMs) {
  const seconds = nowMs / 1000;
  const bytes = Buffer.alloc(70);
  const alarmActive = seconds % 48 >= 42;
  const mode = alarmActive ? 4 : (seconds % 30 >= 26 ? 2 : 1);
  const dispatchable = mode === 1 && !alarmActive ? 1 : 0;
  const walkingMm = Math.round(30000 + 18000 * Math.sin(seconds / 4.8));
  const liftMm = Math.round(5200 + 3600 * Math.sin(seconds / 6.2 + 0.7));
  const forkMm = Math.round(FORK_CENTER_MM + 2100 * Math.sin(seconds / 3.1));
  const taskNo = 900000 + Math.floor(seconds / 8);

  const put16 = (offset, value) => bytes.writeUInt16BE(Math.max(0, Math.min(65535, value)), offset);
  const put32 = (offset, value) => bytes.writeUInt32BE(Math.max(0, Math.min(0xffffffff, value)), offset);

  put16(0, Math.floor(seconds * 2) % 60000); // PLC_HEARTBEAT
  put16(2, 1);                              // PLC_DEVICECODE = TC01
  put16(4, 1);                              // PLC_TUNNEL = A01
  put16(6, 1);                              // PLC_STARTPOSX
  put16(8, Math.max(1, Math.round(walkingMm / 1500))); // PLC_STARTPOSY
  put16(10, Math.max(1, Math.round(liftMm / 1000)));   // PLC_STARTPOSZ
  put16(12, 1);                             // PLC_ENDPOSX
  put16(14, Math.max(1, Math.round((walkingMm + 500) / 1500)));
  put16(16, Math.max(1, Math.round((liftMm + 300) / 1000)));
  put16(18, 1 + (Math.floor(seconds / 12) % 3)); // PLC_TASKTYPE
  put32(20, taskNo);                        // PLC_TASK
  put16(24, 1);                             // PLC_TASKEXE accepted
  put16(26, alarmActive ? 1001 : 0);        // PLC_ERROR
  put16(28, 1);                             // PLC_TRAYTYPE pallet
  put16(30, 0);                             // PLC_TASKFINISHSTATE
  put16(32, 0);                             // PLC_TASKABNORMALFEEDBACK
  put16(34, Math.floor(seconds / 4) % 2);   // PLC_CLAIMGOODS
  put16(36, dispatchable);                  // PLC_DISPATCH
  put16(38, 0);                             // PLC_LOAD reserved
  put16(40, mode);                          // PLC_PATTERN
  put16(42, Math.floor(seconds / 7) % 2);   // PLC_VANSTATE
  put16(44, 1);                             // PLC_POSX
  put16(46, Math.max(1, Math.round(walkingMm / 1500)));
  put16(48, Math.max(1, Math.round(liftMm / 1000)));
  put32(50, walkingMm);                     // PLC_LOCATX
  put32(54, liftMm);                        // PLC_LOCATY
  put32(58, forkMm);                        // PLC_LOCATZ, 5000 is center
  put16(64, Math.floor(seconds / 6) % 2);   // PLC_RELEASEFINISH
  put32(66, taskNo);                        // PLC_TASKNO
  return { bytes, walkingMm, liftMm, forkMm, alarmActive, mode, dispatchable, taskNo };
}

async function request(path, options = {}) {
  const response = await fetch(gatewayUrl + path, {
    ...options,
    signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  let body = null;
  if (response.status !== 204) {
    try { body = await response.json(); } catch (_) { body = null; }
  }
  return { response, body };
}

async function ensureGatewayDevice() {
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const health = await request('/api/health');
      if (health.response.ok) break;
    } catch (_) { /* Gateway may still be starting. */ }
    if (Date.now() > deadline) throw new Error(`Gateway not ready: ${gatewayUrl}`);
    await delay(500);
  }

  const devices = await request('/api/s7/devices');
  if (!devices.response.ok) throw new Error(`Unable to list gateway devices: HTTP ${devices.response.status}`);
  const existing = devices.body.find(device =>
    device.ipAddress === '127.0.0.1' && device.port === port && device.rack === 0 && device.slot === 0);
  if (existing) return { id: existing.id, created: false };

  const created = await request('/api/s7/devices', {
    method: 'POST',
    body: JSON.stringify({ name: deviceName, ipAddress: '127.0.0.1', port, rack: 0, slot: 0, cpuType: 'S7-1200', profileId: 'tc' })
  });
  if (!created.response.ok)
    throw new Error(`Unable to register local demo PLC: HTTP ${created.response.status} ${JSON.stringify(created.body)}`);
  return { id: created.body.id, created: true };
}

async function waitForFirstSample(deviceId) {
  const deadline = Date.now() + 10000;
  for (;;) {
    const detail = await request(`/api/s7/devices/${encodeURIComponent(deviceId)}`);
    if (detail.response.ok && detail.body.blocks?.some(block => block.quality === 'good' && block.tags?.length === 29))
      return detail.body;
    if (Date.now() > deadline) throw new Error('Gateway connected but did not report a good TC sample.');
    await delay(250);
  }
}

async function main() {
  const db = new Map();
  const plc = new FakeS7Plc(db);
  const actualPort = await plc.listen(port);
  const update = () => {
    const sample = demoBytes(Date.now());
    db.set(2000, sample.bytes);
    return sample;
  };
  update();
  const timer = setInterval(update, 200);

  console.log(`Local S7 demo PLC listening on 127.0.0.1:${actualPort}`);
  console.log(`Signals: alarm cycles every 48s; mode 1/2; fork center ${FORK_CENTER_MM} mm.`);
  if (register) {
    const device = await ensureGatewayDevice();
    const sample = await waitForFirstSample(device.id);
    const block = sample.blocks.find(item => item.tags?.length === 29);
    console.log(`${device.created ? 'Registered' : 'Using'} gateway device ${device.id}; first sample ${block.lastReadAt}`);
    console.log(`Twin page: ${gatewayUrl}/index.html  |  Device page: ${gatewayUrl}/devices.html`);
  } else {
    console.log('Gateway registration disabled; create TC01 manually with IP 127.0.0.1 and this port.');
  }

  const statusTimer = setInterval(() => {
    const sample = demoBytes(Date.now());
    console.log(`TC01-SIM heartbeat ${Math.floor(Date.now() / 500) % 60000} | X ${sample.walkingMm}mm | Y ${sample.liftMm}mm | fork ${sample.forkMm}mm (${sample.forkMm - FORK_CENTER_MM >= 0 ? '+' : ''}${sample.forkMm - FORK_CENTER_MM})`);
  }, 5000);

  const shutdown = async () => {
    clearInterval(timer);
    clearInterval(statusTimer);
    await plc.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
