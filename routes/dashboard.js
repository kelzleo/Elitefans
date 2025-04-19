// routes/dashboard.js
const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const User = require('../models/users');
const { transferToBank } = require('../utilis/flutter');
const logger = require('../logs/logger'); // Import Winston logger at top

function authCheck(req, res, next) {
  if (!req.user) {
    logger.warn('Unauthorized access attempt to dashboard page');
    return res.redirect('/');
  }
  next();
}

router.get('/', authCheck, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);

    let transactions = [];
    let totalSubscription = 0;
    let totalSpecial = 0;
    let totalTips = 0;

    if (currentUser.role === 'creator') {
      transactions = await Transaction.find({ creator: currentUser._id })
        .sort({ createdAt: -1 })
        .populate('user', 'username')
        .populate('post', 'writeUp')
        .populate('subscriptionBundle', 'description price');

      for (const tx of transactions) {
        if (tx.type === 'subscription') {
          totalSubscription += tx.amount;
        } else if (tx.type === 'special') {
          totalSpecial += tx.amount;
        } else if (tx.type === 'tip') {
          totalTips += tx.amount;
        }
      }

      res.render('dashboard', {
        user: currentUser,
        role: 'creator',
        transactions,
        totalSubscription,
        totalSpecial,
        totalTips,
        totalEarnings: currentUser.totalEarnings
      });
    } else {
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
    logger.error(`Error loading dashboard: ${err.message}`);
    res.status(500).send('Error loading dashboard');
  }
});

router.post('/add-bank', authCheck, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    if (currentUser.role !== 'creator') {
      logger.warn('Non-creator attempted to add bank');
      return res.status(403).json({ message: 'Only creators can add banks.' });
    }

    const { bankName, accountNumber } = req.body;
    if (!bankName || !accountNumber) {
      logger.warn('Missing bank name or account number in add-bank');
      return res.status(400).json({ message: 'Please provide bank name and account number.' });
    }

    currentUser.banks.push({ bankName, accountNumber });
    await currentUser.save();

    res.json({ message: 'Bank added successfully!' });
  } catch (error) {
    logger.error(`Error adding bank: ${error.message}`);
    res.status(500).json({ message: 'Error adding bank.' });
  }
});

router.post('/withdraw', authCheck, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    if (currentUser.role !== 'creator') {
      logger.warn('Non-creator attempted to withdraw funds');
      return res.status(403).json({ message: 'Only creators can withdraw funds.' });
    }

    const { amount, bankId } = req.body;
    const withdrawalAmount = parseFloat(amount);

    if (!withdrawalAmount || withdrawalAmount < 1000) {
      logger.warn('Invalid withdrawal amount in withdraw');
      return res.status(400).json({ message: 'Withdrawal amount must be at least 1000.' });
    }

    if (withdrawalAmount > currentUser.totalEarnings) {
      logger.warn('Insufficient balance for withdrawal');
      return res.status(400).json({ message: 'Insufficient balance to withdraw that amount.' });
    }

    const chosenBank = currentUser.banks.id(bankId);
    if (!chosenBank) {
      logger.warn('Invalid bank selection in withdraw');
      return res.status(400).json({ message: 'Invalid bank selection.' });
    }

    const bankCode = mapBankNameToCode(chosenBank.bankName);

    let transferResponse;
    try {
      transferResponse = await transferToBank(bankCode, chosenBank.accountNumber, withdrawalAmount);
    } catch (err) {
      logger.error(`transferToBank error: ${err.message}`);
      return res.status(500).json({
        message: 'Error calling transferToBank.',
        error: err.message
      });
    }

    if (transferResponse.status === 'success') {
      currentUser.totalEarnings -= withdrawalAmount;
      await currentUser.save();

      return res.json({ message: 'Withdrawal successful!' });
    } else {
      logger.error('Flutterwave transfer failed');
      return res.status(500).json({ message: 'Transfer failed.', data: transferResponse });
    }
  } catch (err) {
    logger.error(`Error processing withdrawal: ${err.message}`);
    return res.status(500).json({ message: 'Error processing withdrawal.', error: err.message });
  }
});

function mapBankNameToCode(bankName) {
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
    'OPay': '100',
    'Palmpay': '999992',
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
  };
  return bankMap[bankName] || '044';
}

module.exports = router;