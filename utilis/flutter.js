// utilis/flutter.js
const fetch = require('node-fetch');
const User = require('../models/users');
const SubscriptionBundle = require('../models/SubscriptionBundle');
require('dotenv').config();
const logger = require('../logs/logger'); // Import Winston logger at top

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
    logger.warn('Invalid BVN format in verifyBVNInfo');
    throw new Error('BVN must be an 11-digit number');
  }
  if (!firstName || !firstName.trim()) {
    logger.warn('Missing first name in verifyBVNInfo');
    throw new Error('First name is required');
  }
  if (!lastName || !lastName.trim()) {
    logger.warn('Missing last name in verifyBVNInfo');
    throw new Error('Last name is required');
  }

  try {
    // Check if API key exists
    if (!process.env.FLUTTERWAVE_SECRET_KEY) {
      logger.error('Flutterwave API key is missing');
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
    
    if (data.status === 'success') {
      // Validate that the returned name matches what was provided
      const bvnFirstName = data.data.first_name.toLowerCase();
      const bvnLastName = data.data.last_name.toLowerCase();
      const providedFirstName = firstName.trim().toLowerCase();
      const providedLastName = lastName.trim().toLowerCase();
      
      if (bvnFirstName !== providedFirstName || bvnLastName !== providedLastName) {
        logger.warn('BVN names do not match provided names');
        throw new Error('Provided names do not match BVN records.');
      }
      
      return data.data;
    } else {
      logger.error(`BVN verification failed: ${data.message || 'Unknown error'}`);
      throw new Error(data.message || 'BVN verification failed. Please check your details and try again.');
    }
  } catch (error) {
    logger.error(`BVN verification error: ${error.message}`);
    if (error.name === 'FetchError') {
      throw new Error('Network error when connecting to verification service. Please try again later.');
    }
    if (error.message && !error.message.includes('Unable to verify BVN')) {
      throw error;
    }
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

    if (!user || !creator || !bundle) {
      logger.warn('Missing user, creator, or bundle data in initializePayment');
      throw new Error('Missing user, creator, or bundle data');
    }

    if (!process.env.BASE_URL || !process.env.FLUTTERWAVE_SECRET_KEY) {
      logger.error('Missing environment variables in initializePayment');
      throw new Error('Required environment variables are missing');
    }

    const tx_ref = `SUB_${Date.now()}_${creatorId}_${bundleId}`;
    const redirect_url = `${process.env.BASE_URL}/profile/verify-payment`;

    const payload = {
      tx_ref,
      amount: bundle.price,
      currency: "NGN",
      redirect_url,
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

    if (data.status !== 'success') {
      logger.error(`Flutterwave API failed in initializePayment: ${data.message || 'Unknown error'}`);
      throw new Error(`Failed to initialize payment: ${data.message || 'Unknown error'}`);
    }

    return {
      status: 'success',
      meta: {
        authorization: {
          payment_link: data.data.link,
          transfer_reference: tx_ref
        }
      }
    };
  } catch (error) {
    logger.error(`Error in initializePayment: ${error.message}`);
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

    if (!user || !creator) {
      logger.warn('Missing user or creator data in initializeSpecialPayment');
      throw new Error('Missing user or creator data');
    }

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
      logger.error(`Flutterwave API failed in initializeSpecialPayment: ${data.message || 'Unknown error'}`);
      throw new Error('Failed to initialize special payment');
    }
  } catch (error) {
    logger.error(`Error in initializeSpecialPayment: ${error.message}`);
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
      logger.error(`HTTP error in verifyPayment: status ${response.status}`);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    return data;
  } catch (error) {
    logger.error(`Error in verifyPayment: ${error.message}`);
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
      logger.error(`Flutterwave transfer failed in transferToBank: ${data.message || 'Unknown error'}`);
      throw new Error('Failed to initiate transfer');
    }
  } catch (error) {
    logger.error(`Error in transferToBank: ${error.message}`);
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

    if (!user || !creator) {
      logger.warn('Missing user or creator data in initializeTipPayment');
      throw new Error('Missing user or creator data');
    }

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
      logger.error(`Flutterwave API failed in initializeTipPayment: ${data.message || 'Unknown error'}`);
      throw new Error('Failed to initialize tip payment');
    }
  } catch (error) {
    logger.error(`Error in initializeTipPayment: ${error.message}`);
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