'use strict';

const net = require('node:net');

// A deliberately small, read-only S7comm test peer. It binds only to loopback,
// implements COTP connection confirmation, communication setup and DB Read Var,
// and never connects to a real controller. It is not a general PLC simulator.
class FakeS7Plc {
  constructor(blocks = new Map()) {
    this.blocks = blocks;
    this.sockets = new Set();
    this.requests = [];
    this.connections = 0;
    this.errors = [];
    this.rejectConnections = false;
    this.silenceReads = false;
    this.server = net.createServer(socket => this.accept(socket));
  }

  async listen(port = 0) {
    await new Promise((resolve, reject) => {
      const onError = error => reject(error);
      this.server.once('error', onError);
      this.server.listen(port, '127.0.0.1', () => {
        this.server.removeListener('error', onError);
        resolve();
      });
    });
    return this.server.address().port;
  }

  accept(socket) {
    if (this.rejectConnections) { socket.destroy(); return; }
    this.connections++;
    this.sockets.add(socket);
    socket.setNoDelay(true);
    socket.on('error', () => {}); // A test intentionally resets connections.
    socket.on('close', () => this.sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4) {
        const length = pending.readUInt16BE(2);
        if (pending[0] !== 3 || length < 7 || length > 8192) {
          this.errors.push(new Error('Invalid TPKT test request'));
          socket.destroy();
          return;
        }
        if (pending.length < length) return;
        const frame = pending.subarray(0, length);
        pending = pending.subarray(length);
        try { this.respond(socket, frame); }
        catch (error) { this.errors.push(error); socket.destroy(); return; }
      }
    });
  }

  respond(socket, frame) {
    if (frame[5] === 0xe0) {
      // Preserve requested TSAPs; exchange references and confirm the connection.
      const confirmation = Buffer.from(frame);
      confirmation[5] = 0xd0;
      frame.copy(confirmation, 6, 8, 10);
      confirmation.writeUInt16BE(1, 8);
      socket.write(confirmation);
      return;
    }
    const s7 = frame.subarray(7);
    if (frame[5] !== 0xf0 || s7[0] !== 0x32 || s7[1] !== 1)
      throw new Error('Unsupported COTP/S7 test request');
    const parameters = s7.subarray(10, 10 + s7.readUInt16BE(6));
    const reference = s7.readUInt16BE(4);
    if (parameters[0] === 0xf0) {
      const setup = Buffer.from([0xf0, 0, 0, 1, 0, 1, 3, 0xc0]);
      socket.write(this.ack(reference, setup, Buffer.alloc(0)));
      return;
    }
    if (parameters[0] !== 4 || parameters[1] !== 1 || parameters.length !== 14)
      throw new Error('Only single-item DB reads are supported by this fixture');
    if (parameters[5] !== 2 || parameters[10] !== 0x84)
      throw new Error('Expected a byte-oriented DataBlock read');
    const count = parameters.readUInt16BE(6);
    const dbNumber = parameters.readUInt16BE(8);
    const bitAddress = parameters.readUIntBE(11, 3);
    if (bitAddress % 8 !== 0) throw new Error('Expected aligned byte address');
    const startAddress = bitAddress / 8;
    this.requests.push({ dbNumber, startAddress, count });
    if (this.silenceReads) return;

    const block = this.blocks.get(dbNumber);
    const valid = block && startAddress + count <= block.length;
    const payload = valid ? block.subarray(startAddress, startAddress + count) : Buffer.alloc(0);
    const data = Buffer.alloc(4 + payload.length);
    data[0] = valid ? 0xff : 0x0a; // 0x0a: requested object does not exist.
    data[1] = valid ? 4 : 0;
    data.writeUInt16BE(payload.length * 8, 2);
    payload.copy(data, 4);
    socket.write(this.ack(reference, Buffer.from([4, 1]), data));
  }

  ack(reference, parameters, data) {
    const frame = Buffer.alloc(7 + 12 + parameters.length + data.length);
    frame[0] = 3;
    frame.writeUInt16BE(frame.length, 2);
    frame.set([2, 0xf0, 0x80, 0x32, 3], 4);
    frame.writeUInt16BE(reference, 11);
    frame.writeUInt16BE(parameters.length, 13);
    frame.writeUInt16BE(data.length, 15);
    parameters.copy(frame, 19);
    data.copy(frame, 19 + parameters.length);
    return frame;
  }

  dropConnections() {
    for (const socket of this.sockets) socket.destroy();
  }

  async close() {
    this.dropConnections();
    if (this.server.listening)
      await new Promise((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
  }
}

function tcFeedbackBytes() {
  const bytes = Buffer.alloc(70);
  for (let offset = 0; offset < 70; offset += 2) bytes.writeUInt16BE(0x1000 + offset, offset);
  bytes.writeUInt16BE(0xabcd, 0);
  bytes.writeUInt16BE(1, 2);
  bytes.writeUInt32BE(0xfedcba98, 20);
  bytes.writeUInt32BE(0x12345678, 50);
  bytes.writeUInt32BE(0x89abcdef, 54);
  bytes.writeUInt32BE(0xffffffff, 58);
  bytes.writeUInt16BE(0xdead, 62); // Reserved gap must never become a tag.
  bytes.writeUInt16BE(0xbeef, 64);
  bytes.writeUInt32BE(0xabcdef01, 66);
  return bytes;
}

module.exports = { FakeS7Plc, tcFeedbackBytes };
