// models/Post.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const commentSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const mediaItemSchema = new Schema({
  url: { type: String, required: true },
  type: { type: String, enum: ['image', 'video'], required: true },
  contentType: { type: String },
});

const postSchema = new Schema({
  creator: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // For backward compatibility, keep contentUrl but make it optional
  contentUrl: { type: String },
  // New field for multiple media items
  mediaItems: [mediaItemSchema],
  // Post type becomes more about the primary content type
  type: { type: String, enum: ['image', 'video', 'text', 'mixed'], required: true },
  writeUp: { type: String },
  special: { type: Boolean, default: false },
  unlockPrice: { type: Number },
  likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  comments: [commentSchema],
  totalTips: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Post', postSchema);