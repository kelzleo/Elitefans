// models/notification.js
const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true },
  type: { type: String, default: '' },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  creatorName: { type: String, default: '' },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', NotificationSchema);
