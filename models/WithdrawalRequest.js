const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const withdrawalRequestSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // Creator requesting withdrawal
  amount: { type: Number, required: true }, // Amount to withdraw
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' }, // Track withdrawal status
  processAt: { type: Date, required: true }, // Time when withdrawal should be processed
  processedAt: { type: Date }, // Time when the withdrawal was actually processed
  reason: { type: String, default: '' }, // If failed, store reason
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
