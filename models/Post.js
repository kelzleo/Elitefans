// models/Post.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const commentSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const postSchema = new Schema({
  creator: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  contentUrl: { type: String, required: true },
  type: { type: String, enum: ['image', 'video', 'text'], required: true },
  writeUp: { type: String },
  special: { type: Boolean, default: false },
  unlockPrice: { type: Number },
  likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  comments: [commentSchema],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Post', postSchema);
