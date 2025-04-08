const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const transactionSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },  // Who paid
  creator: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // Who earned
  post: { type: Schema.Types.ObjectId, ref: 'Post', default: null },   // For special content or tip posts
  subscriptionBundle: { type: Schema.Types.ObjectId, ref: 'SubscriptionBundle', default: null },
  // Added "tip" to the enum values
  type: { type: String, enum: ['special', 'subscription', 'tip'], required: true },
  amount: { type: Number, required: true },
  description: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
   // New fields for referral system
   creatorShare: { type: Number, default: 0 },
   platformShare: { type: Number, default: 0 },
   referrerShare: { type: Number, default: 0 },
   referrerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
});

module.exports = mongoose.model('Transaction', transactionSchema);
