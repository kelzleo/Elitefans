const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const signedUrlSessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  filename: { type: String, required: true },
  signedUrl: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }, // TTL index
  createdAt: { type: Date, default: Date.now }
});

// Create compound index for faster lookups
signedUrlSessionSchema.index({ userId: 1, filename: 1 });

module.exports = mongoose.model('SignedUrlSession', signedUrlSessionSchema);