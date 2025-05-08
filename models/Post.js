// models/post.js
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
  previewUrl: { type: String }, // For preview URLs (special content)
  posterUrl: { type: String } // NEW: For video thumbnails
});

const postSchema = new Schema({
  creator: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  contentUrl: { type: String },
  previewUrl: { type: String }, // For main preview URL
  posterUrl: { type: String }, // NEW: For main video thumbnail
  mediaItems: [mediaItemSchema],
  type: { type: String, enum: ['image', 'video', 'text', 'mixed'], required: true },
  writeUp: { type: String },
  renderedWriteUp: { type: String },
  special: { type: Boolean, default: false },
  unlockPrice: { type: Number },
  likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  comments: [commentSchema],
  totalTips: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  taggedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  category: { type: String, default: null },
});

module.exports = mongoose.model('Post', postSchema);