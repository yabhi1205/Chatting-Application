require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const roomRoutes = require('./Routes/createRoom');
const { addUser, prevMessage, addMessage, deleteUser } = require('./Utlity/Database');
const connectToMongo = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', roomRoutes());

io.on('connection', (socket) => {
  socket.on('join-room', async ({ roomId, name } = {}, acknowledge = () => {}) => {
    const safeName = typeof name === 'string' ? name.trim().slice(0, 32) : '';
    const safeRoomId = typeof roomId === 'string' ? roomId.trim() : '';
    if (!safeName || !/^\d{6}$/.test(safeRoomId)) return acknowledge({ error: 'Enter a name and a valid six digit room code.' });
    try {
      const history = await prevMessage(safeRoomId);
      if (!history) return acknowledge({ error: 'That room no longer exists. Create a new room to get started.' });
      socket.data.roomId = safeRoomId;
      socket.data.name = safeName;
      await socket.join(safeRoomId);
      await addUser(socket, { roomId: safeRoomId, name: safeName });
      acknowledge({ roomId: safeRoomId, messages: (history.Messages || []).map((message) => ({ name: message.Name, message: message.Message })) });
      socket.to(safeRoomId).emit('presence', { type: 'joined', name: safeName });
      io.to(safeRoomId).emit('room-users', (await io.in(safeRoomId).fetchSockets()).map((member) => member.data.name).filter(Boolean));
    } catch (error) {
      console.error('Unable to join room:', error.message);
      acknowledge({ error: 'Could not join this room. Please try again.' });
    }
  });

  socket.on('sendMessage', async ({ message } = {}, acknowledge = () => {}) => {
    const cleanMessage = typeof message === 'string' ? message.trim() : '';
    const { roomId, name } = socket.data;
    if (!roomId || !name) return acknowledge({ error: 'Join a room before sending a message.' });
    if (!cleanMessage || cleanMessage.length > 2000) return acknowledge({ error: 'Messages must be between 1 and 2,000 characters.' });
    try {
      const saved = await addMessage(socket, { name, message: cleanMessage });
      if (!saved) return acknowledge({ error: 'Your message could not be saved. Please rejoin the room.' });
      const entry = { name, message: cleanMessage, timestamp: new Date().toISOString(), senderId: socket.id };
      io.to(roomId).emit('receive-message', entry);
      acknowledge({ ok: true });
    } catch (error) {
      console.error('Unable to save message:', error.message);
      acknowledge({ error: 'Your message could not be sent. Please try again.' });
    }
  });

  socket.on('typing', (isTyping) => {
    if (socket.data.roomId && socket.data.name) socket.to(socket.data.roomId).emit('typing', { name: socket.data.name, isTyping: Boolean(isTyping) });
  });

  socket.on('disconnect', async () => {
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
  if (process.env.MONGODB_URI || (process.env.dbUser && process.env.dbPass)) {
    try { await connectToMongo(); } catch (error) { console.error('Database connection failed; chat history is unavailable:', error.message); }
  } else {
    console.warn('MONGODB_URI is not set. The app will start, but room and message storage will be unavailable.');
  }
  server.listen(port, () => console.log(`Chat app is running at http://localhost:${port}`));
}

if (require.main === module) start();
module.exports = { app, server, io, start };
