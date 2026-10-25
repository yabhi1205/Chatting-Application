const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const WebSocket = require('ws');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const messagesByRoom = new Map();
const database = require('../Utlity/Database');
database.prevMessage = async (roomId) => ({ Messages: messagesByRoom.get(roomId) || [] });
database.addUser = async () => {};
database.deleteUser = async () => {};
database.addMessage = async (_socket, message) => {
  const roomMessages = messagesByRoom.get(_socket.data.roomId) || [];
  roomMessages.push({ Name: message.name, SenderId: message.senderId, Message: message.message, IsCode: message.isCode, Attachments: message.attachments, timestamp: new Date() });
  messagesByRoom.set(_socket.data.roomId, roomMessages);
  return { RandNo: _socket.data.roomId };
};

const { server, io } = require('../index');
let address;

class SocketIoPeer {
  constructor(url) {
    this.events = [];
    this.waiters = [];
    this.acks = new Map();
    this.nextAck = 1;
    this.ready = new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error('Socket.IO connection timed out')), 5000);
      this.ws.on('error', reject);
      this.ws.on('open', () => {});
      this.ws.on('message', (data) => {
        const frame = data.toString();
        if (frame[0] === '0') this.ws.send('40');
        else if (frame[0] === '2') this.ws.send('3');
        else if (frame.startsWith('40')) { clearTimeout(timer); resolve(); }
        else if (frame.startsWith('43')) {
          const match = frame.match(/^43(\d+)(.*)$/);
          const callback = this.acks.get(Number(match[1]));
          if (callback) { this.acks.delete(Number(match[1])); callback(JSON.parse(match[2] || '[]')[0]); }
        } else if (frame.startsWith('42')) {
          const match = frame.match(/^42(\d+)?(\[.*)$/);
          const packet = JSON.parse(match[2]);
          if (match[1]) this.ws.send(`43${match[1]}[${JSON.stringify(this.respond(packet[0], packet.slice(1)))}]`);
          this.dispatch(packet[0], packet.slice(1));
        } else if (frame.startsWith('45')) {
          const match = frame.match(/^451-(\d+)(.+)$/);
          const packet = JSON.parse(match[2]);
          this.pendingBinary = { id: match[1], event: packet[0], args: packet.slice(1) };
        } else if (Buffer.isBuffer(data) && this.pendingBinary) {
          const pending = this.pendingBinary;
          this.pendingBinary = null;
          const reconstruct = (value) => value && value._placeholder ? data : Array.isArray(value) ? value.map(reconstruct) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, reconstruct(nested)])) : value;
          const args = pending.args.map(reconstruct);
          this.ws.send(`43${pending.id}[${JSON.stringify(this.respond(pending.event, args))}]`);
          this.dispatch(pending.event, args);
        }
      });
    });
  }

  respond(event, args) {
    if (event === 'file-transfer-start') return { ok: true };
    if (event === 'file-transfer-chunk' || event === 'file-transfer-finish') return { ok: true };
    return { ok: true };
  }

  dispatch(event, args) {
    const value = { event, args };
    const index = this.waiters.findIndex((waiter) => waiter.event === event);
    if (index >= 0) { const [waiter] = this.waiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(value); }
    else this.events.push(value);
  }

  waitFor(event, timeout = 5000) {
    const index = this.events.findIndex((item) => item.event === event);
    if (index >= 0) return Promise.resolve(this.events.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { event, resolve, timer: setTimeout(() => { this.waiters = this.waiters.filter((item) => item !== waiter); reject(new Error(`Timed out waiting for ${event}`)); }, timeout) };
      this.waiters.push(waiter);
    });
  }

  emitAck(event, payload, timeout = 5000) {
    const id = this.nextAck++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.acks.delete(id); reject(new Error(`Timed out waiting for ${event} acknowledgement`)); }, timeout);
      this.acks.set(id, (result) => { clearTimeout(timer); resolve(result); });
      const packet = payload === undefined ? [event] : [event, payload];
      this.ws.send(`42${id}${JSON.stringify(packet)}`);
    });
  }

  emitBinaryAck(event, payload) {
    const id = this.nextAck++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.acks.delete(id); reject(new Error(`Timed out waiting for ${event} acknowledgement`)); }, 5000);
      this.acks.set(id, (result) => { clearTimeout(timer); resolve(result); });
      this.ws.send(`451-${id}[${JSON.stringify(event)},{"_placeholder":true,"num":0}]`);
      this.ws.send(payload);
    });
  }

  close() { this.ws.close(); }
}

function connect() {
  return new SocketIoPeer(`ws://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=websocket`);
}

async function join(peer, { roomId = '123456', name = 'Ari', clientId = 'client-identity-0001' } = {}) {
  await peer.ready;
  return peer.emitAck('join-room', { roomId, name, clientId });
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  address = server.address();
});

after(async () => {
  await new Promise((resolve) => io.close(resolve));
});

test('saved messages keep a stable sender identity after reconnect', async (context) => {
  const first = connect();
  context.after(() => first.close());
  assert.equal((await join(first)).roomId, '123456');
  assert.deepEqual(await first.emitAck('sendMessage', { message: 'still me', isCode: true }), { ok: true });
  const liveMessage = await first.waitFor('receive-message');
  assert.equal(liveMessage.args[0].senderId, 'client-identity-0001');
  first.close();
  await new Promise((resolve) => setTimeout(resolve, 30));

  const reconnected = connect();
  context.after(() => reconnected.close());
  const joined = await join(reconnected);
  assert.equal(joined.messages[0].senderId, 'client-identity-0001');
  assert.equal(joined.messages[0].isCode, true);
});

test('file uploads can be cancelled and files over 5 GB are rejected', async (context) => {
  const peer = connect();
  context.after(() => peer.close());
  assert.equal((await join(peer)).roomId, '123456');
  const tooLarge = await peer.emitAck('upload-start', { name: 'too-large.bin', type: 'application/octet-stream', size: 5 * 1024 * 1024 * 1024 + 1 });
  assert.match(tooLarge.error, /5 GB/);

  const started = await peer.emitAck('upload-start', { name: 'cancel.bin', type: 'application/octet-stream', size: 5 });
  assert.ok(started.id);
  assert.deepEqual(await peer.emitBinaryAck('upload-chunk', Buffer.from('xx')), { ok: true });
  peer.ws.send('42["upload-cancel"]');
  const finished = await peer.emitAck('upload-finish');
  assert.match(finished.error, /incomplete/);
});

test('messages over 5 MB are broadcast live without being added to history', async (context) => {
  const peer = connect();
  context.after(() => peer.close());
  await join(peer, { roomId: '654321', clientId: 'long-message-client-001' });
  const longText = 'x'.repeat(5 * 1024 * 1024 + 1);
  assert.deepEqual(await peer.emitAck('sendMessage', { message: longText }), { ok: true });
  const liveMessage = await peer.waitFor('receive-message');
  assert.equal(liveMessage.args[0].notSaved, true);
  assert.equal(liveMessage.args[0].message.length, longText.length);
  assert.deepEqual(messagesByRoom.get('654321') || [], []);
});

test('a completed file is streamed to room members and staged storage is removed', async (context) => {
  const sender = connect(), receiver = connect();
  context.after(() => { sender.close(); receiver.close(); });
  await join(sender, { clientId: 'sender-identity-0001' });
  await join(receiver, { clientId: 'receiver-identity-0001', name: 'Bea' });

  const content = Buffer.from('test file data');
  const started = await sender.emitAck('upload-start', { name: 'hello.txt', type: 'text/plain', size: content.length });
  assert.deepEqual(await sender.emitBinaryAck('upload-chunk', content), { ok: true });
  const uploaded = await sender.emitAck('upload-finish');
  assert.equal(uploaded.file.size, content.length);
  const sent = sender.emitAck('sendMessage', { message: '', attachments: [{ id: uploaded.file.id, name: uploaded.file.name }] });
  const transferStart = await receiver.waitFor('file-transfer-start');
  assert.equal(transferStart.args[0].name, 'hello.txt');
  const transferChunk = await receiver.waitFor('file-transfer-chunk');
  assert.equal(Buffer.from(transferChunk.args[0].chunk).toString(), content.toString());
  await receiver.waitFor('file-transfer-finish');
  assert.deepEqual(await sent, { ok: true });
  assert.equal(fs.existsSync(path.join(os.tmpdir(), 'gather-chat-transfers', uploaded.file.id)), false);
});

test('chat UI includes the mobile member list and cancel-send control', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'static', 'chatting.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'chat-enhancements.css'), 'utf8');
  assert.match(html, /id="mobile-people"/);
  assert.match(html, /id="cancel-send"/);
  assert.match(html, /id="leave-room"/);
  assert.match(styles, /@media\s*\(max-width:\s*760px\)/);
  assert.match(styles, /\.cancel-send-button/);
});
