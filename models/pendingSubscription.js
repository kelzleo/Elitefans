// models/pendingSubscription.js
const mongoose = require('mongoose');

const pendingSubscriptionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true }, // Store sessionID to link to user
  creatorUsername: { type: String, required: true }, // Creator's username
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Creator's ID
  bundleId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionBundle', required: true }, // Bundle ID
  createdAt: { type: Date, default: Date.now, expires: '24h' } // Auto-expire after 24 hours
});

module.exports = mongoose.model('PendingSubscription', pendingSubscriptionSchema);