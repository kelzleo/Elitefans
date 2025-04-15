const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String },
  media: {
    type: { type: String, enum: ['image', 'video', null], default: null },
    url: { type: String },
  },
  timestamp: { type: Date, default: Date.now },
  isTip: { type: Boolean, default: false },
  tipAmount: { type: Number },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }], // Array of user IDs who have read the message
});

const chatSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  messages: [messageSchema],
}, { timestamps: true });

module.exports = mongoose.model('Chat', chatSchema);