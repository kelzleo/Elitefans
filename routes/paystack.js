const express = require('express');
const Paystack = require('paystack-api');
const User = require('../models/users');
const SubscriptionBundle = require('../models/SubscriptionBundle');

const paystack = new Paystack('sk_test_1068ca0b5c6d91be5bd647eaf9ee107c2dedb13a'); // Test secret key

// Function to create a payment link
// Function to create a payment link
async function createPaymentLink(req, res, userId, creatorId, bundleId) {
  try {
    console.log('Creating payment link for user:', userId);
    console.log('Creator ID:', creatorId);
    console.log('Bundle ID:', bundleId);

    if (!creatorId || !bundleId) {
      console.error('Creator ID or Bundle ID is missing');
      return console.log('Error creating payment link');
    }

    const user = await User.findById(userId);
    if (!user) {
      console.error('User not found:', userId);
      return console.log('Error creating payment link');
    }

    const creator = await User.findById(creatorId);
    if (!creator) {
      console.error('Creator not found:', creatorId);
      return console.log('Error creating payment link');
    }

    const bundle = await SubscriptionBundle.findById(bundleId);
    if (!bundle) {
      console.error('Bundle not found:', bundleId);
      return console.log('Error creating payment link');
    }

    console.log('User found:', user);
    console.log('Creator found:', creator);
    console.log('Bundle found:', bundle);

    const payment = await paystack.transaction.initialize({
      amount: bundle.price * 100, // Convert to kobo
      email: user.email,
      name: user.username,
      callback_url: 'https://aca4-102-90-42-23.ngrok-free.app/callback',
      payment_method: 'bank_transfer',
    });

    console.log('Payment link created:', payment);

    if (res && res.redirect) {
      res.redirect(payment.data.authorization_url);
    } else {
      console.error('Invalid res object:', res);
      return console.log('Error creating payment link');
    }
  } catch (error) {
    console.error('Error creating payment link:', error);
    return console.log('Error creating payment link');
  }
}
// Function to verify a payment
async function verifyPayment(reference) {
  try {
    const payment = await paystack.transaction.verify(reference);

    return payment;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

module.exports = {
  createPaymentLink,
  verifyPayment,
};