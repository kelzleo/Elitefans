const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const signedUrlSessionSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  filename: {
    type: String,
    required: true,
  },
 
  postId: {
    type: Schema.Types.ObjectId,
    ref: 'Post',
    required: false, // Optional for backward compatibility
  },
  signedUrl: {
    type: String,
    required: true,
  },
  signedUrlExpiresAt: {
    type: Date,
    required: true,
  },
  sessionExpiresAt: {
    type: Date,
    required: true,
  },
  lastAccessed: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  bucketName: { type: String, required: false },
});

signedUrlSessionSchema.index({ userId: 1, filename: 1, chatId: 1, postId: 1 });
signedUrlSessionSchema.index({ signedUrlExpiresAt: 1 });
signedUrlSessionSchema.index({ sessionExpiresAt: 1 });

module.exports = mongoose.model('SignedUrlSession', signedUrlSessionSchema);