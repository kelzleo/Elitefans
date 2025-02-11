// flutter.js
const fetch = require('node-fetch');
const User = require('../models/users');
const SubscriptionBundle = require('../models/SubscriptionBundle');
require('dotenv').config();

async function initializePayment(userId, creatorId, bundleId) {
  try {
    const user = await User.findById(userId);
    const creator = await User.findById(creatorId);
    const bundle = await SubscriptionBundle.findById(bundleId);

    const payload = {
      tx_ref: `SUB_${Date.now()}_${creatorId}_${bundleId}`,
      amount: bundle.price,
      currency: "NGN",
      redirect_url: `${process.env.BASE_URL}/profile/verify-payment`,
      customer: {
        email: user.email,
        name: user.username
      },
      meta: {
        user_id: userId,
        creator_id: creatorId,
        bundle_id: bundleId
      },
      customizations: {
        title: "Creator Subscription",
        description: `Subscribe to ${creator.username}'s content`,
        
      }
    };

    console.log("Initializing Payment with payload:", payload);

    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log("Flutterwave initialization response:", data);

    if (data.status === 'success') {
      return {
        status: 'success',
        meta: {
          // Return the payment link and tx_ref (or any transfer reference if available)
          authorization: {
            payment_link: data.data.link,
            transfer_reference: data.data.flw_ref || payload.tx_ref
          }
        }
      };
    } else {
      throw new Error(data.message || 'Failed to initialize payment');
    }
  } catch (error) {
    console.error('Error initializing payment:', error);
    throw error;
  }
}

async function verifyPayment(transaction_id) {
  try {
    const url = `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`;
    console.log("Verifying payment via URL:", url);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
      }
    });
    const data = await response.json();
    console.log("Verification response:", data);
    return data;
  } catch (error) {
    console.error('Error verifying payment:', error);
    throw error;
  }
}

module.exports = {
  initializePayment,
  verifyPayment
};
