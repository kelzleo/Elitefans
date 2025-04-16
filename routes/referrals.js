const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Transaction = require('../models/Transaction');

const authCheck = (req, res, next) => {
  if (!req.user) return res.redirect('/');
  if (req.user.role !== 'creator') return res.status(403).send('Only creators can access this page');
  next();
};

router.get('/', authCheck, async (req, res) => {
  try {
    const referredCreators = await User.find({
      referredBy: req.user._id,
      role: 'creator',
    }).select('username creatorSince');

    for (const creator of referredCreators) {
      const totalReferralEarnings = await Transaction.aggregate([
        { $match: { referrerId: req.user._id, creator: creator._id } },
        { $group: { _id: null, total: { $sum: '$referrerShare' } } },
      ]);
      creator.totalReferralEarnings = totalReferralEarnings[0]?.total || 0;
    }

    const totalReferralEarnings = await Transaction.aggregate([
      { $match: { referrerId: req.user._id } },
      { $group: { _id: null, total: { $sum: '$referrerShare' } } },
    ]);
    const total = totalReferralEarnings[0]?.total || 0;

    const referralLink = `https://onlyaccess.onrender.com/?ref=${req.user._id}`;

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