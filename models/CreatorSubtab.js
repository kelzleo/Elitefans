// models/CreatorSubtab.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const creatorSubtabSchema = new Schema({
  creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true, maxlength: 50 },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('CreatorSubtab', creatorSubtabSchema);