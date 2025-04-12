const fetch = require('node-fetch');
const User = require('../models/users');
const SubscriptionBundle = require('../models/SubscriptionBundle');
require('dotenv').config();

/**
 * Verifies BVN details using Flutterwave's BVN verification endpoint.
 *
 * @param {string} bvn - The 11-digit BVN.
 * @param {string} firstName - The user's first name (for validation after response).
 * @param {string} lastName - The user's last name (for validation after response).
 * @returns {Promise<Object>} - The verified BVN data.
 * @throws {Error} - If the verification fails.
 */
async function verifyBVNInfo(bvn, firstName, lastName) {
  // Input validation
  if (!/^\d{11}$/.test(bvn)) {
    throw new Error('BVN must be an 11-digit number');
  }
  if (!firstName || !firstName.trim()) {
    throw new Error('First name is required');
  }
  if (!lastName || !lastName.trim()) {
    throw new Error('Last name is required');
  }

  try {
    // Log API request for debugging
    console.log(`Sending BVN verification request for BVN: ${bvn.substring(0, 4)}******`);

    // Check if API key exists
    if (!process.env.FLUTTERWAVE_SECRET_KEY) {
      throw new Error('Flutterwave API key is missing. Please check your environment configuration.');
    }

    // Use the endpoint format from the documentation
    const url = `https://api.ravepay.co/v2/kyc/bvn/${bvn}?seckey=${process.env.FLUTTERWAVE_SECRET_KEY}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    // Log API response for debugging (excluding sensitive data)
    console.log('BVN verification response status:', data.status);
    
    if (data.status === 'success') {
      // Validate that the returned name matches what was provided
      const bvnFirstName = data.data.first_name.toLowerCase();
      const bvnLastName = data.data.last_name.toLowerCase();
      const providedFirstName = firstName.trim().toLowerCase();
      const providedLastName = lastName.trim().toLowerCase();
      
      if (bvnFirstName !== providedFirstName || bvnLastName !== providedLastName) {
        throw new Error('Provided names do not match BVN records.');
      }
      
      return data.data;
    } else {
      // Log the specific error from Flutterwave
      console.error('BVN verification failed with error:', data.message || 'Unknown error');
      throw new Error(data.message || 'BVN verification failed. Please check your details and try again.');
    }
  } catch (error) {
    // Log the full error for debugging
    console.error('BVN verification error:', error);
    
    // If it's a network error, provide a more descriptive message
    if (error.name === 'FetchError') {
      throw new Error('Network error when connecting to verification service. Please try again later.');
    }
    
    // If it's our own error with a message, pass it through
    if (error.message && !error.message.includes('Unable to verify BVN')) {
      throw error;
    }
    
    // Default error
    throw new Error('Unable to verify BVN at this time. Please try again later.');
  }
}

/**
 * Initialize a subscription payment.
 */
async function initializePayment(userId, creatorId, bundleId) {
  try {
    const user = await User.findById(userId);
    const creator = await User.findById(creatorId);
    const bundle = await SubscriptionBundle.findById(bundleId);

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

    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

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
      throw new Error('Failed to initialize payment');
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Initialize a special content payment.
 */
async function initializeSpecialPayment(userId, creatorId, contentId, amount) {
  try {
    const user = await User.findById(userId);
    const creator = await User.findById(creatorId);

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

    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data.status === 'success') {
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
      throw new Error('Failed to initialize special payment');
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Verify a payment by transaction ID.
 */
async function verifyPayment(transaction_id) {
  try {
    const url = `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`;

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

    return data;
  } catch (error) {
    throw error;
  }
}

/**
 * Transfer money from your Flutterwave payout balance to a creator's bank.
 */
async function transferToBank(bankCode, accountNumber, amount, reference = `WITHDRAW-${Date.now()}`, narration = 'Creator Payout') {
  try {
    const url = 'https://api.flutterwave.com/v3/transfers';
    const payload = {
      account_bank: bankCode,
      account_number: accountNumber,
      amount: amount,
      narration: narration,
      currency: 'NGN',
      reference: reference
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data.status === 'success') {
      return data;
    } else {
      throw new Error('Failed to initiate transfer');
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Initialize a tip payment.
 */
async function initializeTipPayment(userId, creatorId, postId, amount, message = null) {
  try {
    const user = await User.findById(userId);
    const creator = await User.findById(creatorId);
    const tx_ref = `TIP_${Date.now()}_${userId}_${postId || 'profile'}`;

    const payload = {
      tx_ref,
      amount,
      currency: "NGN",
      redirect_url: `${process.env.BASE_URL}/profile/verify-tip-payment`,
      customer: {
        email: user.email,
        name: user.username
      },
      meta: {
        user_id: userId,
        creator_id: creatorId,
        post_id: postId || null,
        type: 'tip',
        message: message || null
      },
      customizations: {
        title: "Tip Payment",
        description: `Tip for ${creator.username}${postId ? ' (Post)' : ''}`
      }
    };

    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

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
      throw new Error('Failed to initialize tip payment');
    }
  } catch (error) {
    throw error;
  }
}

module.exports = {
  verifyBVNInfo,
  initializePayment,
  initializeSpecialPayment,
  verifyPayment,
  transferToBank,
  initializeTipPayment
};