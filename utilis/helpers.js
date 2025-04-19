// utilis/helpers.js
const User = require('../models/users');

const getProfileUrl = async (userId) => {
  try {
    const user = await User.findById(userId).select('username');
    if (!user) throw new Error('User not found');
    return `/profile/${user.username}`;
  } catch (err) {
    console.error('Error generating profile URL:', err);
    return '/profile'; // Fallback
  }
};

module.exports = { getProfileUrl };