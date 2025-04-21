const mongoose = require('mongoose');

const subscriptionBundleSchema = new mongoose.Schema({
  price: {
    type: Number,
    required: true, // Price of the subscription bundle (updated to discounted price if applicable)
  },
  currency: {
    type: String,
    default: 'NGN',
  },
  duration: {
    type: String,
    enum: ['1 day', '1 month', '3 months', '6 months', '1 year'],
    required: function () {
      return !this.isFree; // Duration required only for paid bundles
    },
  },
  durationWeight: {
    type: Number, // Numeric weight for sorting durations
    required: function () {
      return !this.isFree; // Required for paid bundles
    },
  },
  description: {
    type: String,
    required: true,
  },
  creatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  isFree: {
    type: Boolean,
    default: false, // Indicates if this is a free subscription
  },
  discountPercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 0, // Percentage discount applied (0 means no discount)
  },
  originalPrice: {
    type: Number,
    default: null, // Original price before discount, null if no discount applied
  },
});

// Pre-save hook to set durationWeight automatically
subscriptionBundleSchema.pre('save', function (next) {
  if (!this.isFree && this.duration) {
    const durationOrder = {
      '1 day': 1,
      '1 month': 2,
      '3 months': 3,
      '6 months': 4,
      '1 year': 5,
    };
    this.durationWeight = durationOrder[this.duration];
  } else {
    this.durationWeight = undefined; // Free bundles have no durationWeight
  }
  next();
});

// Index for efficient queries and sorting
subscriptionBundleSchema.index({ creatorId: 1, isFree: 1, durationWeight: 1 });

module.exports = mongoose.model('SubscriptionBundle', subscriptionBundleSchema);