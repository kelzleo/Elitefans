// routes/dashboard.js
const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const User = require('../models/users');
const { transferToBank } = require('../utilis/flutter'); // The Flutterwave transfer function

function authCheck(req, res, next) {
  if (!req.user) return res.redirect('/');
  next();
}

// GET /dashboard - your existing code for showing stats
router.get('/', authCheck, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);

    let transactions = [];
    let totalSubscription = 0;
    let totalSpecial = 0;

    if (currentUser.role === 'creator') {
      // Fetch transactions where this user is the "creator"
      transactions = await Transaction.find({ creator: currentUser._id })
        .sort({ createdAt: -1 })
        .populate('user', 'username')
        .populate('post', 'writeUp')
        .populate('subscriptionBundle', 'description price');

      // Sum amounts by type
      for (const tx of transactions) {
        if (tx.type === 'subscription') totalSubscription += tx.amount;
        else if (tx.type === 'special') totalSpecial += tx.amount;
      }

      // Render the creator dashboard
      res.render('dashboard', {
        user: currentUser,
        role: 'creator',
        transactions,
        totalSubscription,
        totalSpecial,
        totalEarnings: currentUser.totalEarnings
      });
    } else {
      // Normal user => money spent
      transactions = await Transaction.find({ user: currentUser._id })
        .sort({ createdAt: -1 })
        .populate('creator', 'username')
        .populate('post', 'writeUp')
        .populate('subscriptionBundle', 'description price');

      for (const tx of transactions) {
        if (tx.type === 'subscription') totalSubscription += tx.amount;
        else if (tx.type === 'special') totalSpecial += tx.amount;
      }

      // Render the user dashboard
      res.render('dashboard', {
        user: currentUser,
        role: 'user',
        transactions,
        totalSubscription,
        totalSpecial
      });
    }
  } catch (err) {
    console.error('Error loading dashboard:', err);
    res.status(500).send('Error loading dashboard');
  }
});

// POST /dashboard/bank-details - your existing code for saving bank info
router.post('/bank-details', authCheck, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    if (currentUser.role !== 'creator') {
      return res.status(403).json({ message: 'Only creators can update bank details.' });
    }

    const { bankName, accountNumber } = req.body;
    currentUser.bankName = bankName;
    currentUser.accountNumber = accountNumber;
    await currentUser.save();

    res.json({ message: 'Bank details saved successfully!' });
  } catch (error) {
    console.error('Error saving bank details:', error);
    res.status(500).json({ message: 'Error saving bank details.' });
  }
});

// POST /dashboard/withdraw - IMMEDIATE withdrawal (no 24-hour delay)
router.post('/withdraw', authCheck, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    if (currentUser.role !== 'creator') {
      return res.status(403).json({ message: 'Only creators can withdraw funds.' });
    }

    // Check bank details
    if (!currentUser.bankName || !currentUser.accountNumber) {
      return res.status(400).json({ message: 'Please add your bank details first.' });
    }

    // Requested withdrawal amount from the client
    const { amount } = req.body;
    if (!amount || amount < 1000) {
      return res.status(400).json({ message: 'Withdrawal amount must be at least 1000.' });
    }

    // Ensure user has enough funds
    if (amount > currentUser.totalEarnings) {
      return res.status(400).json({ message: 'Insufficient balance to withdraw that amount.' });
    }

    // Deduct platform fee (example 25%)
    const fee = amount * 0.25;
    const payoutAmount = amount - fee;

    // Convert bank name to a bank code (example helper)
    const bankCode = mapBankNameToCode(currentUser.bankName);
    const accountNumber = currentUser.accountNumber;

    // Attempt immediate transfer
    const transferResponse = await transferToBank(bankCode, accountNumber, payoutAmount);
    if (transferResponse.status === 'success') {
      // Subtract the entire requested amount from totalEarnings
      currentUser.totalEarnings -= amount;
      await currentUser.save();

      return res.json({ message: 'Withdrawal successful!' });
    } else {
      // If the transfer fails, do not remove from totalEarnings
      return res.status(500).json({ message: 'Transfer failed.' });
    }
  } catch (err) {
    console.error('Withdraw error:', err);
    return res.status(500).json({ message: 'Error processing withdrawal.' });
  }
});

// Example helper to map bank names to codes
function mapBankNameToCode(bankName) {
  const bankMap = {
    'Access Bank': '044',
    'GTBank': '058',
    'Zenith Bank': '057',
    'First Bank': '011',
    'Sterling Bank': '232',
    // Add more if needed
  };
  return bankMap[bankName] || '044'; // default to Access if unknown
}

module.exports = router;
