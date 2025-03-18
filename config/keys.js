const crypto = require('crypto');
require('dotenv').config(); // Load environment variables from .env file

function generateCookieKey() {
  return crypto.randomBytes(32).toString('hex');
}



module.exports = {
  google: {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },
  email: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  session: {
    // Use the provided cookie key or generate one if not set
    cookieKey: process.env.COOKIE_KEY || generateCookieKey(),
  },
 
};