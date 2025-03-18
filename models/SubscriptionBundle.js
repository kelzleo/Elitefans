const mongoose = require('mongoose');

const subscriptionBundleSchema = new mongoose.Schema({
    price: {
        type: Number,
        required: true, // Price of the subscription bundle
    },
    currency: {
        type: String,
        default: 'NGN', // Default currency is Naira (NGN), but this can be customized
    },
    duration: {
        type: String,
        enum: ['1 day','1 month', '3 months', '6 months', '1 year'], // Subscription duration options
        required: true, // Must be one of the specified options
    },
    description: {
        type: String,
        required: true, // A brief description of the bundle
    },
      // NEW FIELD: Associate the bundle with a creator (user)
  creatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
    createdAt: {
        type: Date,
        default: Date.now,
    }
});

module.exports = mongoose.model('SubscriptionBundle', subscriptionBundleSchema);