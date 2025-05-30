const isDevEnv = '<%= process.env.NODE_ENV %>' === 'development';
document.addEventListener('DOMContentLoaded', function() {
// Enable or disable the Withdraw button based on availableBalance
const availableBalanceEl = document.getElementById('availableBalance');
const withdrawBtn = document.getElementById('withdraw-btn');
if (availableBalanceEl && withdrawBtn) {
const availableBalance = parseFloat(availableBalanceEl.innerText || 0);
if (availableBalance >= 1000) {
withdrawBtn.disabled = false;
} else {
withdrawBtn.disabled = true;
}
}
// Handle Add Bank Form
const addBankForm = document.getElementById('add-bank-form');
if (addBankForm) {
addBankForm.addEventListener('submit', async (e) => {
e.preventDefault();
const bankName = document.getElementById('bankName').value;
const accountNumber = document.getElementById('accountNumber').value;
const messageEl = document.getElementById('add-bank-msg');
  try {
    if (typeof fetchWithCsrf !== 'function') {
      throw new Error('fetchWithCsrf is not defined');
    }
    
    messageEl.innerText = 'Processing...';
    messageEl.className = 'del-form-message del-processing';
    
    const res = await fetchWithCsrf('/dashboard/add-bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bankName, accountNumber })
    });
    
    const data = await res.json();
    
    if (data.success) {
      messageEl.innerText = data.message || 'Bank added successfully!';
      messageEl.className = 'del-form-message del-success';
      setTimeout(() => location.reload(), 1500);
    } else {
      messageEl.innerText = data.message || 'Error adding bank.';
      messageEl.className = 'del-form-message del-error';
    }
  } catch (error) {
    if (isDevEnv) console.error('Error adding bank:', error);
    messageEl.innerText = 'Error adding bank. Please try again.';
    messageEl.className = 'del-form-message del-error';
  }
});
}
// Handle Withdraw
if (withdrawBtn) {
withdrawBtn.addEventListener('click', async () => {
const bankSelect = document.getElementById('withdrawBank');
const bankId = bankSelect ? bankSelect.value : null;
const amountInput = document.getElementById('withdrawAmount');
const withdrawAmount = parseFloat(amountInput.value);
const messageEl = document.getElementById('withdraw-msg');
  if (!bankId) {
    messageEl.innerText = 'Please select a bank account.';
    messageEl.className = 'del-form-message del-error';
    return;
  }

  if (!withdrawAmount || withdrawAmount < 1000) {
    messageEl.innerText = 'Minimum withdrawal amount is ₦1000.';
    messageEl.className = 'del-form-message del-error';
    return;
  }

  try {
    if (typeof fetchWithCsrf !== 'function') {
      throw new Error('fetchWithCsrf is not defined');
    }
    
    messageEl.innerText = 'Processing withdrawal...';
    messageEl.className = 'del-form-message del-processing';
    withdrawBtn.disabled = true;
    
    const res = await fetchWithCsrf('/dashboard/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: withdrawAmount, bankId })
    });
    
    const data = await res.json();
    
    if (data.success) {
      messageEl.innerText = data.message || 'Withdrawal successful!';
      messageEl.className = 'del-form-message del-success';
      setTimeout(() => location.reload(), 1500);
    } else {
      messageEl.innerText = data.message || 'Error processing withdrawal.';
      messageEl.className = 'del-form-message del-error';
      withdrawBtn.disabled = false;
    }
  } catch (error) {
    if (isDevEnv) console.error('Error withdrawing:', error);
    messageEl.innerText = 'Error withdrawing funds. Please try again.';
    messageEl.className = 'del-form-message del-error';
    withdrawBtn.disabled = false;
  }
});
}
// Link fund wallet button to withdraw section if applicable
const fundWalletBtn = document.querySelector('.del-fund-wallet-btn');
if (fundWalletBtn) {
fundWalletBtn.addEventListener('click', () => {
const withdrawSection = document.querySelector('.del-section:nth-of-type(3)');
if (withdrawSection) {
withdrawSection.scrollIntoView({ behavior: 'smooth' });
}
});
}
// Debug FetchWithCsrf Availability
if (isDevEnv && typeof fetchWithCsrf !== 'function') {
console.error('fetchWithCsrf is not defined. Ensure utils.js is loaded before dashboard.js');
}
});