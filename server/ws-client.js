'use strict';
// A tiny WebSocket client (RFC 6455), just enough to talk to Chromium's DevTools endpoint on localhost. Node 18/20 have
// no built-in WebSocket client, and this avoids adding a dependency for one use. Plain ws:// only, text messages.
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 64 * 1024 * 1024;

class WebSocketClient extends EventEmitter {
  constructor(socket, head) {
    super();
    this.socket = socket;
    this.buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    this.parts = [];     // fragments of the message being assembled
    this.partsOp = 0;
    this.closed = false;
    socket.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this._read(); });
    socket.on('close', () => this._closed());
    socket.on('error', (e) => { if (this.listenerCount('error')) this.emit('error', e); this._closed(); }); // a reset connection is just a close unless someone is listening
    if (this.buf.length) this._read();
  }

  _closed() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  _read() {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        len = Number(b.readBigUInt64BE(2));
        off = 10;
      }
      if (len > MAX_MESSAGE) { this.socket.destroy(); return; }
      if (masked) off += 4;
      if (b.length < off + len) return; // wait for the rest of the frame
      let payload = b.subarray(off, off + len);
      if (masked) {
        const key = b.subarray(off - 4, off);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];
      }
      this.buf = b.subarray(off + len);

      if (op === 8) { this.close(); return; }
      if (op === 9) { this._frame(10, payload); continue; } // ping -> pong
      if (op === 10) continue;
      if (op === 1 || op === 2) { this.parts = [payload]; this.partsOp = op; } else if (op === 0) this.parts.push(payload);
      if (fin && (op <= 2)) {
        const whole = Buffer.concat(this.parts);
        this.parts = [];
        this.emit('message', this.partsOp === 1 ? whole.toString('utf8') : whole);
      }
    }
  }

  _frame(op, payload) {
    if (this.closed || this.socket.destroyed) return;
    const key = crypto.randomBytes(4);
    const n = payload.length;
    const head = n < 126 ? Buffer.alloc(2) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    head[0] = 0x80 | op;
    if (n < 126) head[1] = 0x80 | n;
    else if (n < 65536) { head[1] = 0x80 | 126; head.writeUInt16BE(n, 2); } else { head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(n), 2); }
    const body = Buffer.from(payload);
    for (let i = 0; i < body.length; i++) body[i] ^= key[i & 3];
    this.socket.write(Buffer.concat([head, key, body]));
  }

  send(text) { this._frame(1, Buffer.from(String(text), 'utf8')); }

  close() {
    if (!this.closed && !this.socket.destroyed) {
      try { this._frame(8, Buffer.alloc(0)); } catch { /* already gone */ }
      this.socket.end();
    }
    this._closed();
  }
}

// connect('ws://127.0.0.1:9222/devtools/page/ABC') -> Promise<WebSocketClient>
function connect(url, { timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'ws:') return reject(new Error('only ws:// is supported'));
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: u.hostname, port: u.port || 80, path: u.pathname + u.search, timeout,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' },
    });
    req.on('upgrade', (res, socket, head) => {
      const want = crypto.createHash('sha1').update(key + GUID).digest('base64');
      if (res.headers['sec-websocket-accept'] !== want) { socket.destroy(); return reject(new Error('bad WebSocket handshake')); }
      socket.setTimeout(0);
      resolve(new WebSocketClient(socket, head));
    });
    req.on('response', (res) => { res.resume(); reject(new Error(`WebSocket upgrade refused (HTTP ${res.statusCode})`)); });
    req.on('timeout', () => { req.destroy(); reject(new Error('WebSocket connection timed out')); });
    req.on('error', reject);
    req.end();
  });
}

module.exports = { connect, WebSocketClient };
