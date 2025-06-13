const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const signedUrlSessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  filename: { type: String, required: true },
  signedUrl: { type: String, required: true },
  signedUrlExpiresAt: { type: Date, required: true }, // When the actual signed URL expires
  sessionExpiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }, // When the session expires (24hrs or logout)
  lastAccessed: { type: Date, default: Date.now }, // Track last access for activity monitoring
  createdAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true } // Allow manual session invalidation
});

// Create compound index for faster lookups
signedUrlSessionSchema.index({ userId: 1, filename: 1 });
signedUrlSessionSchema.index({ signedUrlExpiresAt: 1 }); // For finding URLs that need regeneration

module.exports = mongoose.model('SignedUrlSession', signedUrlSessionSchema);