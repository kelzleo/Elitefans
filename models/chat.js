const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  isTip: { type: Boolean, default: false }, // Indicates if the message is associated with a tip
  tipAmount: { type: Number } // Amount of the tip in NGN (optional, only set if isTip is true)
});

const chatSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  messages: [messageSchema]
}, { timestamps: true });

module.exports = mongoose.model('Chat', chatSchema);