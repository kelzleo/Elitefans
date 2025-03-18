// cron.js
require('dotenv').config();
const mongoose = require('mongoose');
const cron = require('node-cron');
const WithdrawalRequest = require('./models/WithdrawalRequest');
const User = require('./models/users');
const { transferToBank } = require('./utilis/flutter');

// Connect to your DB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));


// Run every 10 minutes (adjust as needed)
cron.schedule('*/10 * * * *', async () => {
  console.log('Checking pending withdrawals...');
  try {
    const now = new Date();
    const pendingRequests = await WithdrawalRequest.find({
      status: 'pending',
      processAt: { $lte: now }
    });

    for (const req of pendingRequests) {
      const user = await User.findById(req.user);
      if (!user) {
        req.status = 'failed';
        req.reason = 'User not found';
        await req.save();
        continue;
      }

      // Example 25% fee calculation:
      const fee = req.amount * 0.25;
      const payoutAmount = req.amount - fee;

      // Use the user’s stored bank info
      const bankCode = mapBankNameToCode(user.bankName);
      const accountNumber = user.accountNumber;

      try {
        const transferResponse = await transferToBank(bankCode, accountNumber, payoutAmount);
        if (transferResponse.status === 'success') {
          req.status = 'completed';
          req.processedAt = new Date();
        } else {
          req.status = 'failed';
          req.reason = 'Transfer failed';
        }
        await req.save();
      } catch (error) {
        console.error('Error transferring funds:', error);
        req.status = 'failed';
        req.reason = error.message;
        await req.save();
      }
    }
  } catch (error) {
    console.error('Error in cron job:', error);
  }
});
