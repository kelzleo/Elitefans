const crypto = require('crypto');
require('dotenv').config(); // Load environment variables from .env file

function generateCookieKey() {
  return crypto.randomBytes(32).toString('hex');
}

console.log('GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS);

module.exports = {
  google: {
    clientID: '11278174447-0rvejmk1n3fjf7a5a0g8er364o2agapa.apps.googleusercontent.com',
    clientSecret: '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',
  },
  email: {
    user: 'blessingf2925@gmail.com', // e.g., example@gmail.com
    pass: 'jeai wgvv tkim qbgf', // Gmail App Password
  },
  session: {
    cookieKey: generateCookieKey(), // Optional: used for session cookies
  },
  googleCloud: {
    keyFilePath: './google.json', // Path to credentials file
  },
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    publicKey: 'pk_test_46affad2f7a0b55785032e17711dc131a7314802',
  },
};