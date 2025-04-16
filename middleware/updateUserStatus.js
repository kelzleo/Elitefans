// middleware/updateUserStatus.js
const User = require('../models/users');

const updateUserStatus = async (req, res, next) => {
  if (req.user) {
    try {
      await User.findByIdAndUpdate(req.user._id, {
        isOnline: true,
        lastSeen: new Date(),
      });
    } catch (err) {
      console.error('Error updating user status:', err);
    }
  }
  next();
};

module.exports = updateUserStatus;