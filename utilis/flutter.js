// flutter.js
const fetch = require('node-fetch');
const User = require('../models/users');
const SubscriptionBundle = require('../models/SubscriptionBundle');
require('dotenv').config();

/**
 * Initialize a subscription payment
 */
async function initializePayment(userId, creatorId, bundleId) {
  try {
    const user = await User.findById(userId);
    const creator = await User.findById(creatorId);
    const bundle = await SubscriptionBundle.findById(bundleId);

    // Generate a consistent transaction reference for subscription
    const tx_ref = `SUB_${Date.now()}_${creatorId}_${bundleId}`;

    const payload = {
      tx_ref,
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
        bundle_id: bundleId,
        type: 'subscription'
      },
      customizations: {
        title: "Creator Subscription",
        description: `Subscribe to ${creator.username}'s content`
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
          authorization: {
            payment_link: data.data.link,
            transfer_reference: tx_ref
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

/**
 * Initialize a special content payment
 */
async function initializeSpecialPayment(userId, creatorId, contentId, amount) {
  try {
    const user = await User.findById(userId);
    const creator = await User.findById(creatorId);

    // Generate a consistent transaction reference for special payment
    const tx_ref = `SPECIAL_${Date.now()}_${userId}_${contentId}`;

    const payload = {
      tx_ref,
      amount: amount,
      currency: "NGN",
      redirect_url: `${process.env.BASE_URL}/profile/verify-special-payment`,
      customer: {
        email: user.email,
        name: user.username
      },
      meta: {
        user_id: userId,
        creator_id: creatorId,
        content_id: contentId,
        type: 'special_content'
      },
      customizations: {
        title: "Unlock Special Content",
        description: `Unlock special content from ${creator.username}`
      }
    };

    console.log("Initializing Special Payment with payload:", payload);

    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log("Special Payment initialization response:", data);

    if (data.status === 'success') {
      console.log("Payment initialization successful:", {
        link: data.data.link,
        tx_ref: tx_ref,
        flw_ref: data.data.flw_ref
      });

      return {
        status: 'success',
        meta: {
          authorization: {
            payment_link: data.data.link,
            transfer_reference: tx_ref,
            flw_ref: data.data.flw_ref
          }
        }
      };
    } else {
      throw new Error(data.message || 'Failed to initialize special payment');
    }
  } catch (error) {
    console.error("Error initializing special payment:", error);
    throw error;
  }
}

/**
 * Verify a payment by transaction ID
 */
async function verifyPayment(transaction_id) {
  try {
    console.log("Starting payment verification for transaction:", transaction_id);

    const url = `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`;
    console.log("Verifying payment via URL:", url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Verification response:", data);

    if (data.status === 'success' && data.data) {
      if (data.data.status === 'successful') {
        console.log("Payment verified successfully:", {
          amount: data.data.amount,
          currency: data.data.currency,
          tx_ref: data.data.tx_ref,
          flw_ref: data.data.flw_ref
        });
      } else {
        console.log("Payment not successful:", data.data.status);
      }
    }

    return data;
  } catch (error) {
    console.error('Error verifying payment:', error);
    throw error;
  }
}

/**
 * Transfer money from your Flutterwave payout balance to a creator's bank
 * This is used for withdrawals/payouts
 */
async function transferToBank(bankCode, accountNumber, amount, reference = `WITHDRAW-${Date.now()}`, narration = 'Creator Payout') {
  try {
    const url = 'https://api.flutterwave.com/v3/transfers';
    const payload = {
      account_bank: bankCode,  // e.g. "044" for Access Bank
      account_number: accountNumber,
      amount: amount,
      narration: narration,
      currency: 'NGN',
      reference: reference
    };

    console.log("Initiating Flutterwave transfer with payload:", payload);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log('Flutterwave transfer response:', data);

    if (data.status === 'success') {
      // Transfer was initiated successfully
      return data;
    } else {
      throw new Error(data.message || 'Failed to initiate transfer');
    }
  } catch (error) {
    console.error('Error initiating transfer to bank:', error);
    throw error;
  }
}

module.exports = {
  initializePayment,
  initializeSpecialPayment,
  verifyPayment,
  // NEW export for withdrawal
  transferToBank
};
