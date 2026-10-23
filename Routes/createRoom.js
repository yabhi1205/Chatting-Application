const crypto = require('crypto');
const path = require('path');
const express = require('express');
const SavingData = require('./SavingData');

module.exports = function createRoomRouter() {
  const router = express.Router();
  const pages = path.join(__dirname, '..', 'static');
  router.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
  router.get('/createRoom', (_req, res) => res.sendFile(path.join(pages, 'createRoom.html')));
  router.get('/joinRoom', (_req, res) => res.sendFile(path.join(pages, 'joinroom.html')));
  router.get('/chatting', (_req, res) => res.sendFile(path.join(pages, 'chatting.html')));

  router.post('/createRoom/demo', async (req, res) => {
    try {
      if (SavingData.db.readyState !== 1) return res.status(503).json({ error: 'Chat storage is unavailable. Check the server database connection.' });
      let roomId;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        roomId = String(crypto.randomInt(100000, 1000000));
        if (!(await SavingData.exists({ RandNo: roomId }))) break;
        roomId = null;
      }
      if (!roomId) return res.status(503).json({ error: 'Could not create a room. Please try again.' });
      await SavingData.create({ RandNo: roomId });
      res.cookie('room', roomId, { httpOnly: false, sameSite: 'lax', secure: req.secure, maxAge: 24 * 60 * 60 * 1000 });
      return res.json({ roomId, redirect: '/chatting' });
    } catch (error) {
      console.error('Room creation failed:', error.message);
      return res.status(500).json({ error: 'Could not create a room. Please try again.' });
    }
  });

  router.post('/joinRoom/demo', async (req, res) => {
    const roomId = typeof req.body.roomId === 'string' ? req.body.roomId.trim() : '';
    if (!/^\d{6}$/.test(roomId)) return res.status(400).json({ error: 'Enter a valid six digit room code.' });
    try {
      if (SavingData.db.readyState !== 1) return res.status(503).json({ error: 'Chat storage is unavailable. Please try again later.' });
      if (!(await SavingData.exists({ RandNo: roomId }))) return res.status(404).json({ error: 'We could not find that room. Check the code and try again.' });
      res.cookie('room', roomId, { httpOnly: false, sameSite: 'lax', secure: req.secure, maxAge: 24 * 60 * 60 * 1000 });
      return res.json({ redirect: '/chatting' });
    } catch (error) {
      console.error('Room lookup failed:', error.message);
      return res.status(500).json({ error: 'Could not join the room. Please try again.' });
    }
  });
  return router;
};
