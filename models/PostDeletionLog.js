// models/PostDeletionLog.js
const mongoose = require('mongoose');

const postDeletionLogSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  creatorName: { type: String, required: true },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  adminName: { type: String, required: true },
  reason: { type: String, required: true },
  deletedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('PostDeletionLog', postDeletionLogSchema);