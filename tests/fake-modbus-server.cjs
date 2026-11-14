// Minimal Modbus TCP server for gateway smoke tests. Read-only, FC 1/2/3/4.
// Deterministic data: holding/input register i = i (big-endian on the wire),
// coils/discrete inputs: bit i = i % 2. Usage: node tests/fake-modbus-server.cjs [port]
'use strict';
const net = require('net');

const port = Number(process.argv[2]) || 15020;

function handleRequest(pdu) {
  const fc = pdu[0];
  const start = pdu.readUInt16BE(1);
  const count = pdu.readUInt16BE(3);
  if (fc === 3 || fc === 4) {
    if (count < 1 || count > 125 || start + count > 65536) return Buffer.from([fc | 0x80, 0x02]);
    const body = Buffer.alloc(2 + count * 2);
    body[0] = fc; body[1] = count * 2;
    for (let i = 0; i < count; i++) body.writeUInt16BE((start + i) & 0xffff, 2 + i * 2);
    return body;
  }
  if (fc === 1 || fc === 2) {
    if (count < 1 || count > 2000 || start + count > 65536) return Buffer.from([fc | 0x80, 0x02]);
    const byteCount = Math.ceil(count / 8);
    const body = Buffer.alloc(2 + byteCount);
    body[0] = fc; body[1] = byteCount;
    for (let bit = 0; bit < count; bit++)
      if ((start + bit) % 2) body[2 + (bit >> 3)] |= 1 << (bit & 7);
    return body;
  }
  return Buffer.from([fc | 0x80, 0x01]);
}

const server = net.createServer(socket => {
  let buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8) {
      const declared = 6 + buffer.readUInt16BE(4);
      if (buffer.length < declared) break;
      const frame = buffer.subarray(0, declared);
      buffer = buffer.subarray(declared);
      const pdu = frame.subarray(7);
      if (pdu.length < 5) continue;
      const response = handleRequest(pdu);
      const head = Buffer.alloc(7);
      frame.copy(head, 0, 0, 2);              // transaction id
      head.writeUInt16BE(0, 2);               // protocol id
      head.writeUInt16BE(response.length + 1, 4);
      head[6] = frame[6];                     // unit id
      socket.write(Buffer.concat([head, response]));
    }
  });
});

server.listen(port, '127.0.0.1', () => console.log(`fake Modbus TCP server on 127.0.0.1:${port}`));
