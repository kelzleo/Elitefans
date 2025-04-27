// models/Report.js
const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true,
  },
  reason: {
    type: String,
    enum: [
      'Violates Elitefans Terms of Service',
      'Contains Copyrighted Material (DMCA)',
      'Child Sexual Abuse Material (CSAM)',
      'Report Spam',
      'Report Abuse',
    ],
    required: true,
  },
  details: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Report', reportSchema);