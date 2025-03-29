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

// GET /dashboard
router.get('/', authCheck, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);

    let transactions = [];
    let totalSubscription = 0;
    let totalSpecial = 0;
    let totalTips = 0; // New variable for tip earnings

    if (currentUser.role === 'creator') {
      // Fetch transactions where this user is the creator
      transactions = await Transaction.find({ creator: currentUser._id })
        .sort({ createdAt: -1 })
        .populate('user', 'username')
        .populate('post', 'writeUp')
        .populate('subscriptionBundle', 'description price');

      // Sum amounts by type
      for (const tx of transactions) {
        if (tx.type === 'subscription') {
          totalSubscription += tx.amount;
        } else if (tx.type === 'special') {
          totalSpecial += tx.amount;
        } else if (tx.type === 'tip') { // Handle tip transactions
          totalTips += tx.amount;
        }
      }

      // Render the creator dashboard with tip earnings included
      res.render('dashboard', {
        user: currentUser,
        role: 'creator',
        transactions,
        totalSubscription,
        totalSpecial,
        totalTips, // Pass total tips to the view
        totalEarnings: currentUser.totalEarnings
      });
    } else {
      // Normal user dashboard remains unchanged
      transactions = await Transaction.find({ user: currentUser._id })
        .sort({ createdAt: -1 })
        .populate('creator', 'username')
        .populate('post', 'writeUp')
        .populate('subscriptionBundle', 'description price');

      for (const tx of transactions) {
        if (tx.type === 'subscription') {
          totalSubscription += tx.amount;
        } else if (tx.type === 'special') {
          totalSpecial += tx.amount;
        }
      }

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


/**
 * POST /dashboard/add-bank
 * Adds a new bank to the user's array of banks
 */
router.post('/add-bank', authCheck, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    if (currentUser.role !== 'creator') {
      return res.status(403).json({ message: 'Only creators can add banks.' });
    }

    const { bankName, accountNumber } = req.body;
    if (!bankName || !accountNumber) {
      return res.status(400).json({ message: 'Please provide bank name and account number.' });
    }

    // Push a new bank object to the array
    currentUser.banks.push({ bankName, accountNumber });
    await currentUser.save();

    res.json({ message: 'Bank added successfully!' });
  } catch (error) {
    console.error('Error adding bank:', error);
    res.status(500).json({ message: 'Error adding bank.' });
  }
});

/**
 * POST /dashboard/withdraw
 * Let a creator withdraw to a chosen bank
 */
router.post('/withdraw', authCheck, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    if (currentUser.role !== 'creator') {
      return res.status(403).json({ message: 'Only creators can withdraw funds.' });
    }

    const { amount, bankId } = req.body; // bankId is the index or _id from the user’s banks array

    // Validate the requested withdrawal amount
    if (!amount || amount < 1000) {
      return res.status(400).json({ message: 'Withdrawal amount must be at least 1000.' });
    }

    if (amount > currentUser.totalEarnings) {
      return res.status(400).json({ message: 'Insufficient balance to withdraw that amount.' });
    }

    // Find the chosen bank
    const chosenBank = currentUser.banks.id(bankId); // if bankId is an ObjectId
    if (!chosenBank) {
      return res.status(400).json({ message: 'Invalid bank selection.' });
    }

    // Deduct 25% fee
    const fee = amount * 0.25;
    const payoutAmount = amount - fee;

    // Convert bank name to code
    const bankCode = mapBankNameToCode(chosenBank.bankName);

    // Attempt immediate transfer
    let transferResponse;
    try {
      transferResponse = await transferToBank(bankCode, chosenBank.accountNumber, payoutAmount);
      console.log('Full transferResponse object:', transferResponse);
    } catch (err) {
      console.error('transferToBank error:', err);
      return res.status(500).json({
        message: 'Error calling transferToBank.',
        error: err.message
      });
    }

    if (transferResponse.status === 'success') {
      // On success, subtract from totalEarnings
      currentUser.totalEarnings -= amount;
      await currentUser.save();

      return res.json({ message: 'Withdrawal successful!' });
    } else {
      // If the transfer fails
      console.error('Flutterwave transfer failed:', transferResponse);
      return res.status(500).json({ message: 'Transfer failed.', data: transferResponse });
    }
  } catch (err) {
    console.error('Withdraw error:', err);
    return res.status(500).json({ message: 'Error processing withdrawal.', error: err.message });
  }
});

/**
 * Helper function: map bankName to bankCode
 */
function mapBankNameToCode(bankName) {
  // Extended dictionary of ~40 banks in Nigeria (example)
  const bankMap = {
    'Access Bank': '044',
    'ALAT by Wema': '035',
    'Citibank Nigeria': '023',
    'Ecobank Nigeria': '050',
    'Fidelity Bank': '070',
    'First Bank of Nigeria': '011',
    'First City Monument Bank (FCMB)': '214',
    'Globus Bank': '103',
    'Guaranty Trust Bank (GTBank)': '058',
    'Heritage Bank': '030',
    'Jaiz Bank': '301',
    'Keystone Bank': '082',
    'Kuda Bank': '50211',
    'Moniepoint Microfinance Bank': '50515',
    'OPay': '100', // or sometimes '999991' or '999992'—varies
    'Palmpay': '999992', // approximate
    'Parallex Bank': '526',
    'Polaris Bank': '076',
    'PremiumTrust Bank': '50746',
    'Providus Bank': '101',
    'Stanbic IBTC Bank': '221',
    'Standard Chartered Bank': '068',
    'Sterling Bank': '232',
    'SunTrust Bank': '100',
    'Titan Trust Bank': '102',
    'Union Bank of Nigeria': '032',
    'United Bank for Africa (UBA)': '033',
    'Unity Bank': '215',
    'Wema Bank': '035',
    'Zenith Bank': '057',
    // ... add more if needed
  };

  return bankMap[bankName] || '044'; // default to Access if unknown
}

module.exports = router;
