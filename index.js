require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { Server } = require('socket.io');
const roomRoutes = require('./Routes/createRoom');
const { addUser, prevMessage, addMessage, deleteUser } = require('./Utlity/Database');
const connectToMongo = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 110 * 1024 * 1024 });
const port = Number(process.env.PORT) || 3000;
const uploadRoot = path.join(os.tmpdir(), 'gather-chat-transfers');
const activeUploads = new Map();
const availableFiles = new Map();
const uploadChunkSize = 4 * 1024 * 1024;
const maxFileSize = 5 * 1024 * 1024 * 1024;

function socketAck(target, event, payload) {
  return new Promise((resolve, reject) => {
    target.timeout(120000).emit(event, payload, (error, result) => {
      if (error) return reject(error);
      if (result?.error) return reject(new Error(result.error));
      resolve(result);
    });
  });
}

async function deliverFileToRoom(file, roomId, senderId) {
  const recipients = (await io.in(roomId).fetchSockets()).filter((peer) => peer.id !== senderId);
  if (!recipients.length) return;
  const metadata = { id: file.id, name: file.name, type: file.type, size: file.size };
  try {
    await Promise.all(recipients.map((peer) => socketAck(peer, 'file-transfer-start', metadata)));
    const stream = fs.createReadStream(file.filePath, { highWaterMark: uploadChunkSize });
    let index = 0;
    for await (const chunk of stream) {
      if (file.cancelled) throw new Error('The sender cancelled this upload.');
      await Promise.all(recipients.map((peer) => socketAck(peer, 'file-transfer-chunk', { id: file.id, index, chunk })));
      index += 1;
    }
    if (file.cancelled) throw new Error('The sender cancelled this upload.');
    await Promise.all(recipients.map((peer) => socketAck(peer, 'file-transfer-finish', { id: file.id })));
  } catch (error) {
    recipients.forEach((peer) => peer.emit('file-transfer-abort', { id: file.id }));
    throw error;
  }
}

app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', roomRoutes());

io.on('connection', (socket) => {
  socket.on('join-room', async ({ roomId, name, clientId } = {}, acknowledge = () => {}) => {
    const safeName = typeof name === 'string' ? name.trim().slice(0, 32) : '';
    const safeRoomId = typeof roomId === 'string' ? roomId.trim() : '';
    const safeClientId = typeof clientId === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(clientId) ? clientId : '';
    if (!safeName || !safeClientId || !/^\d{6}$/.test(safeRoomId)) return acknowledge({ error: 'Enter a name and a valid six digit room code.' });
    try {
      const history = await prevMessage(safeRoomId);
      if (!history) return acknowledge({ error: 'That room no longer exists. Create a new room to get started.' });
      for (const message of history.Messages || []) for (const attachment of message.Attachments || []) {
        const id = attachment.Id || attachment.id;
        if (id && /^[a-f0-9-]{36}$/i.test(id)) availableFiles.set(id, { id, name: attachment.Name || attachment.name, type: attachment.Type || attachment.type, size: attachment.Size || attachment.size || 0, filePath: path.join(uploadRoot, id), roomId: safeRoomId, ownerId: null });
      }
      socket.data.roomId = safeRoomId;
      socket.data.name = safeName;
      socket.data.clientId = safeClientId;
      await socket.join(safeRoomId);
      await addUser(socket, { roomId: safeRoomId, name: safeName });
      acknowledge({ roomId: safeRoomId, messages: (history.Messages || []).map((message) => ({ name: message.Name, senderId: message.SenderId, message: message.Message, isCode: message.IsCode, attachments: (message.Attachments || []).map((file) => file.Data ? ({ name: file.Name || file.name, type: file.Type || file.type, data: file.Data || file.data }) : ({ id: file.Id || file.id, name: file.Name || file.name, type: file.Type || file.type, size: file.Size || file.size })), timestamp: message.timestamp })) });
      socket.to(safeRoomId).emit('presence', { type: 'joined', name: safeName });
      io.to(safeRoomId).emit('room-users', (await io.in(safeRoomId).fetchSockets()).map((member) => member.data.name).filter(Boolean));
    } catch (error) {
      console.error('Unable to join room:', error.message);
      acknowledge({ error: 'Could not join this room. Please try again.' });
    }
  });

  socket.on('upload-start', async ({ name: fileName, type, size } = {}, acknowledge = () => {}) => {
    if (!socket.data.roomId || typeof fileName !== 'string' || !fileName || fileName.length > 255 || typeof type !== 'string' || !Number.isSafeInteger(size) || size < 0 || size > maxFileSize) return acknowledge({ error: 'Files must be 5 GB or smaller.' });
    try {
      await fs.promises.mkdir(uploadRoot, { recursive: true });
      const id = crypto.randomUUID();
      const filePath = path.join(uploadRoot, id);
      const stream = fs.createWriteStream(filePath, { flags: 'wx' });
      activeUploads.set(socket.id, { id, filePath, stream, name: path.basename(fileName), type: type.slice(0, 120) || 'application/octet-stream', size, written: 0 });
      stream.on('error', () => { activeUploads.delete(socket.id); fs.promises.rm(filePath, { force: true }).catch(() => {}); });
      acknowledge({ id, chunkSize: uploadChunkSize });
    } catch (error) { acknowledge({ error: 'Could not start the upload.' }); }
  });

  socket.on('upload-cancel', () => {
    const upload = activeUploads.get(socket.id);
    if (upload) {
      activeUploads.delete(socket.id);
      upload.stream.destroy();
      fs.promises.rm(upload.filePath, { force: true }).catch(() => {});
    }
    for (const [id, file] of availableFiles) if (file.ownerId === socket.id) {
      file.cancelled = true;
      availableFiles.delete(id);
      fs.promises.rm(file.filePath, { force: true }).catch(() => {});
    }
  });

  socket.on('upload-chunk', async (chunk, acknowledge = () => {}) => {
    const upload = activeUploads.get(socket.id);
    if (!upload || !Buffer.isBuffer(chunk) || chunk.length > uploadChunkSize || upload.written + chunk.length > upload.size) return acknowledge({ error: 'Invalid upload chunk.' });
    upload.written += chunk.length;
    upload.stream.write(chunk, (error) => acknowledge(error ? { error: 'The upload was cancelled.' } : { ok: true }));
  });

  socket.on('upload-finish', (acknowledge = () => {}) => {
    const upload = activeUploads.get(socket.id);
    if (!upload || upload.written !== upload.size) return acknowledge({ error: 'The upload is incomplete.' });
    upload.stream.end(() => {
      activeUploads.delete(socket.id);
      const file = { id: upload.id, name: upload.name, type: upload.type, size: upload.size, filePath: upload.filePath, roomId: socket.data.roomId, ownerId: socket.id };
      availableFiles.set(upload.id, file);
      acknowledge({ file: { id: file.id, name: file.name, type: file.type, size: file.size } });
    });
  });

  socket.on('sendMessage', async ({ message, isCode, attachments } = {}, acknowledge = () => {}) => {
    const cleanMessage = typeof message === 'string' ? message : '';
    const cleanAttachments = Array.isArray(attachments) ? attachments : [];
    const { roomId, name } = socket.data;
    if (!roomId || !name) return acknowledge({ error: 'Join a room before sending a message.' });
    if ((!cleanMessage.trim() && !cleanAttachments.length) || Buffer.byteLength(cleanMessage, 'utf8') > 100 * 1024 * 1024) return acknowledge({ error: 'Add text or files. Text messages are limited to 100 MB.' });
    if (cleanAttachments.length > 10 || cleanAttachments.some((file) => !file || typeof file.id !== 'string' || typeof file.name !== 'string' || file.name.length > 255)) return acknowledge({ error: 'Upload up to 10 files at a time.' });
    try {
      const files = cleanAttachments.map((item) => availableFiles.get(item.id));
      if (files.some((file) => !file || file.roomId !== roomId)) return acknowledge({ error: 'An uploaded file is no longer available.' });
      const storedAttachments = files.map((file) => ({ Id: file.id, Name: file.name, Type: file.type, Size: file.size }));
      const entry = { name, message: cleanMessage, isCode: Boolean(isCode), attachments: files.map(({ id, name, type, size }) => ({ id, name, type, size })), timestamp: new Date().toISOString(), senderId: socket.data.clientId };
      if (!files.length && Buffer.byteLength(cleanMessage, 'utf8') <= 5 * 1024 * 1024) {
        const saved = await addMessage(socket, { name, senderId: socket.data.clientId, message: cleanMessage, isCode: Boolean(isCode), attachments: storedAttachments });
        if (!saved) return acknowledge({ error: 'Your message could not be saved. Please rejoin the room.' });
      } else {
        entry.notSaved = true;
        entry.filesEphemeral = Boolean(files.length);
      }
      io.to(roomId).emit('receive-message', entry);
      for (const file of files) {
        try { await deliverFileToRoom(file, roomId, socket.id); }
        finally { availableFiles.delete(file.id); await fs.promises.rm(file.filePath, { force: true }); }
      }
      acknowledge({ ok: true });
    } catch (error) {
      for (const item of cleanAttachments) {
        const orphan = typeof item?.id === 'string' ? availableFiles.get(item.id) : null;
        if (orphan?.ownerId === socket.id) { availableFiles.delete(orphan.id); await fs.promises.rm(orphan.filePath, { force: true }).catch(() => {}); }
      }
      console.error('Unable to save message:', error.message);
      acknowledge({ error: 'Your message could not be sent. Please try again.' });
    }
  });

  socket.on('typing', (isTyping) => {
    if (socket.data.roomId && socket.data.name) socket.to(socket.data.roomId).emit('typing', { name: socket.data.name, isTyping: Boolean(isTyping) });
  });

  socket.on('disconnect', async () => {
    const upload = activeUploads.get(socket.id);
    if (upload) { upload.stream.destroy(); activeUploads.delete(socket.id); fs.promises.rm(upload.filePath, { force: true }).catch(() => {}); }
    for (const [id, file] of availableFiles) if (file.ownerId === socket.id) { availableFiles.delete(id); fs.promises.rm(file.filePath, { force: true }).catch(() => {}); }
    if (!socket.data.roomId) return;
    try {
      await deleteUser(socket);
      socket.to(socket.data.roomId).emit('presence', { type: 'left', name: socket.data.name });
      io.to(socket.data.roomId).emit('room-users', (await io.in(socket.data.roomId).fetchSockets()).map((member) => member.data.name).filter(Boolean));
    } catch (error) {
      console.error('Unable to update room presence:', error.message);
    }
  });
});

async function start() {
  await fs.promises.rm(uploadRoot, { recursive: true, force: true });
  await fs.promises.mkdir(uploadRoot, { recursive: true });
  if (process.env.MONGODB_URI || (process.env.dbUser && process.env.dbPass)) {
    try { await connectToMongo(); } catch (error) { console.error('Database connection failed; chat history is unavailable:', error.message); }
  } else {
    console.warn('MONGODB_URI is not set. The app will start, but room and message storage will be unavailable.');
  }
  server.listen(port, () => console.log(`Chat app is running at http://localhost:${port}`));
}

if (require.main === module) start();
process.once('exit', () => { try { fs.rmSync(uploadRoot, { recursive: true, force: true }); } catch {} });
module.exports = { app, server, io, start };
