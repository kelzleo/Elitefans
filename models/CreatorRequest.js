// models/CreatorRequest.js
const mongoose = require('mongoose');

const CreatorRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  bvn: {
    type: String,
    required: true,
  },
  firstName: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
    required: true,
  },
  passportPhotoUrl: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  requestedAt: {
    type: Date,
    default: Date.now,
  },
  bvnVerificationData: {
    verifiedFirstName: { type: String },
    verifiedLastName: { type: String },
    verifiedAt: { type: Date }
  }
});

module.exports = mongoose.model('CreatorRequest', CreatorRequestSchema);