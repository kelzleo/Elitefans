// routes/referrals.js
const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Transaction = require('../models/Transaction');

// Authentication middleware
const authCheck = (req, res, next) => {
  if (!req.user) return res.redirect('/');
  if (req.user.role !== 'creator') return res.status(403).send('Only creators can access this page');
  next();
};

router.get('/', authCheck, async (req, res) => {
  try {
    // Fetch creators referred by this user
    const referredCreators = await User.find({
      referredBy: req.user._id,
      role: 'creator',
    }).select('username creatorSince');

    // Calculate referral earnings per referred creator
    for (const creator of referredCreators) {
      const totalReferralEarnings = await Transaction.aggregate([
        { $match: { referrerId: req.user._id, creator: creator._id } },
        { $group: { _id: null, total: { $sum: '$referrerShare' } } },
      ]);
      creator.totalReferralEarnings = totalReferralEarnings[0]?.total || 0;
    }

    // Calculate total referral earnings
    const totalReferralEarnings = await Transaction.aggregate([
      { $match: { referrerId: req.user._id } },
      { $group: { _id: null, total: { $sum: '$referrerShare' } } },
    ]);
    const total = totalReferralEarnings[0]?.total || 0;

    // Generate referral link
    const referralLink = `https://onlyaccess.onrender.com/signup?ref=${req.user._id}`;

    res.render('referrals', {
      referredCreators,
      totalReferralEarnings: total,
      referralLink,
      currentUser: req.user,
    });
  } catch (err) {
    console.error('Error loading referrals:', err);
    res.status(500).send('Error loading referrals');
  }
});

module.exports = router;