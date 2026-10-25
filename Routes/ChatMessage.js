const mongoose = require('mongoose');

const ChatMessage = new mongoose.Schema({
  RoomId: { type: String, required: true, index: true },
  Name: { type: String, required: true, maxlength: 32 },
  Message: { type: String, required: true },
  IsCode: { type: Boolean, default: false },
  Attachments: [{
    Id: { type: String, required: true },
    Name: { type: String, required: true, maxlength: 255 },
    Type: { type: String, required: true, maxlength: 120 },
    Size: { type: Number, required: true }
  }],
  timestamp: { type: Date, default: Date.now }
});

ChatMessage.index({ RoomId: 1, timestamp: 1 });
module.exports = mongoose.model('ChatMessage', ChatMessage);
