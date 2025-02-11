require('dotenv').config();
const axios = require('axios');
const flw = new Flutterwave(process.env.FLW_PUBLIC_KEY, process.env.FLW_SECRET_KEY); // Ensure this is set in your environment variables
const SubscriptionBundle = require('../models/SubscriptionBundle'); // Import your SubscriptionBundle model
const User = require('../models/users'); // Import your User model

// Function to create a bank transfer payment link
const createPaymentLink = async (userId, creatorId, bundleId) => {
try {
console.log("Starting to create payment link...");
console.log(`Fetching bundle with ID: ${bundleId}`);

// Fetch the bundle from the database
const bundle = await SubscriptionBundle.findById(bundleId);

if (!bundle) {
throw new Error('Bundle not found');
}

console.log(`Found bundle: ${bundle}, price: ${bundle.price}`);

// Fetch user email and username dynamically
const user = await User.findById(userId);
console.log('User data:', user);

if (!user) {
throw new Error('User not found');
}

console.log(`Found user: ${user.username}, email: ${user.email}`);

// Prepare the details for the bank transfer
const paymentData = {
tx_ref: `sub-${userId}-${creatorId}-${bundleId}-${Date.now()}_PMCK`,
amount: bundle.price,
currency: 'NGN',
customer: {
email: user.email,
name: user.username,
},
redirect_url: 'http://localhost:4000/profile/verify-payment',
account_bank: '044',
account_number: '0690000031',
};

console.log('Payment data prepared:', paymentData);

// Create the payment link using the Flutterwave API
const response = await axios.post(
`https://api.flutterwave.com/v3/payments`,
paymentData,
{
headers: {
Authorization: `Bearer ${FLUTTERWAVE_API_KEY}`,
'Content-Type': 'application/json',
},
}
);

console.log('Payment link created:', response.data);

// Redirect the user to the payment link
return response.data.data.link;
} catch (error) {
console.error('Error creating bank transfer payment link:', error);
throw new Error('Error creating bank transfer payment link');
}
};

// Function to verify payment
const verifyPayment = async (reference) => {
try {
const response = await axios.get(
`https://api.flutterwave.com/v3/transactions/${reference}/verify`,
{
headers: {
Authorization: `Bearer ${FLUTTERWAVE_API_KEY}`,
},
}
);

return response.data.data; // Return payment verification data
} catch (error) {
console.error('Error verifying payment:', error);
throw new Error('Error verifying payment');
}
};

// Call the createPaymentLink function and redirect to the payment link
async function main() {
try {
const userId = '6756f9709a167105a5000c60'; // Replace with the actual user ID
const creatorId = '6778e282cbe17c5038fef574'; // Replace with the actual creator ID
const bundleId = '6783795ce3d88e8c8f756bff'; // Replace with the actual bundle ID

const paymentLink = await createPaymentLink(userId, creatorId, bundleId);
console.log('Payment link:', paymentLink);
window.location.href = paymentLink;
} catch (error) {
console.error('Error redirecting to payment link:', error);
}
}

main();

module.exports = { createPaymentLink, verifyPayment };