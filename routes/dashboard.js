// routes/dashboard.js
const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const User = require('../models/users');
const WithdrawalRequest = require('../models/WithdrawalRequest'); 
const { transferToBank } = require('../utilis/flutter'); // The new transfer function

function authCheck(req, res, next) {
  if (!req.user) return res.redirect('/');
  next();
}

// GET /dashboard
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

      // Sum amounts by type (for display only)
      for (const tx of transactions) {
        if (tx.type === 'subscription') totalSubscription += tx.amount;
        else if (tx.type === 'special') totalSpecial += tx.amount;
      }

      // Render the creator dashboard
      // We'll also pass `totalEarnings` from the user doc (the actual available balance)
      res.render('dashboard', {
        user: currentUser,
        role: 'creator',
        transactions,
        totalSubscription,
        totalSpecial,
        totalEarnings: currentUser.totalEarnings // The real available balance
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

// POST /dashboard/bank-details
// Save/Update creator's bank info
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

// POST /dashboard/withdraw
// Let a creator withdraw if totalEarnings >= 1000
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

    // Validate withdrawal amount
    const { amount } = req.body;
    if (!amount || amount < 1000) {
      return res.status(400).json({ message: 'Withdrawal amount must be at least 1000.' });
    }

    if (amount > currentUser.totalEarnings) {
      return res.status(400).json({ message: 'Insufficient balance to withdraw that amount.' });
    }

    // Create a pending request first (before deducting from balance)
    const processTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    const withdrawal = await WithdrawalRequest.create({
      user: currentUser._id,
      amount,
      status: 'pending',
      processAt: processTime
    });

    if (!withdrawal) {
      return res.status(500).json({ message: 'Failed to create withdrawal request.' });
    }

    // Only deduct from totalEarnings if WithdrawalRequest creation succeeds
    currentUser.totalEarnings -= amount;
    await currentUser.save();

    return res.json({ message: 'Withdrawal requested. Funds will be transferred in 24 hours.' });
  } catch (err) {
    console.error('Withdraw error:', err);
    return res.status(500).json({ message: 'Error processing withdrawal.' });
  }
});

/**
 * Example helper to map bank name to bank code
 * In production, store these in a DB or a static dictionary
 */
function mapBankNameToCode(bankName) {
  const bankMap = {
    'Access Bank': '044',
    'GTBank': '058',
    'Zenith Bank': '057',
    'First Bank': '011',
    'Sterling Bank': '232'
    // ... add more as needed
  };
  return bankMap[bankName] || '044'; // default to Access if unknown
}

module.exports = router;
