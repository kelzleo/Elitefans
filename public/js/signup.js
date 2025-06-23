document.addEventListener('DOMContentLoaded', function () {
  const isDevEnv = '<%= process.env.NODE_ENV %>' === 'development';
  const togglePassword = document.querySelector('.sel-toggle-password');
  const passwordInput = document.querySelector('input[name="password"]');
  const usernameInput = document.querySelector('input[name="username"]');
  const emailInput = document.querySelector('input[name="email"]');
  const form = document.getElementById('sel-signupForm');
  const errorDiv = document.getElementById('sel-passwordError');

  // Initialize FingerprintJS (global, no import)
  let fingerprint = null;
  if (typeof FingerprintJS !== 'undefined') {
    FingerprintJS.load()
      .then(fp => fp.get())
      .then(result => {
        fingerprint = result.visitorId;
        if (isDevEnv) console.log('Fingerprint initialized:', fingerprint);
      })
      .catch(err => {
        if (isDevEnv) console.error('Failed to get fingerprint:', err);
      });
  } else {
    if (isDevEnv) console.error('FingerprintJS is not loaded. Ensure FingerprintJS script is included.');
  }

  // Password validation function
  function validatePassword() {
    const pwd = passwordInput ? passwordInput.value : '';
    const uname = usernameInput ? usernameInput.value.toLowerCase() : '';
    const emailL = emailInput ? emailInput.value.toLowerCase() : '';
    let msg = '';

    if (pwd.length < 8) {
      msg = 'At least 8 characters.';
    } else {
      const checks = [
        /[A-Z]/.test(pwd),
        /[a-z]/.test(pwd),
        /[0-9]/.test(pwd),
        /[!@#$%^&*]/.test(pwd),
      ].filter(Boolean).length;
      if (checks < 3) {
        msg = 'Include 3 of: uppercase, lowercase, number, symbol.';
      } else if (pwd.toLowerCase().includes(uname) || pwd.toLowerCase().includes(emailL)) {
        msg = 'Don’t include username or email.';
      }
    }

    if (errorDiv) {
      errorDiv.textContent = msg;
      errorDiv.style.display = msg ? 'block' : 'none';
    }
  }

  // Toggle password visibility
  if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', () => {
      const type = passwordInput.type === 'password' ? 'text' : 'password';
      passwordInput.type = type;
      togglePassword.textContent = type === 'password' ? '👁️' : '🙈';
    });
  }

  // Validate inputs on change
  if (passwordInput) passwordInput.addEventListener('input', validatePassword);
  if (usernameInput) usernameInput.addEventListener('input', validatePassword);
  if (emailInput) emailInput.addEventListener('input', validatePassword);

  // Handle form submission
  if (form && usernameInput && emailInput && passwordInput && errorDiv) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      validatePassword();
      if (errorDiv.textContent) {
        if (isDevEnv) console.log('Form validation failed:', errorDiv.textContent);
        return;
      }

      const username = usernameInput.value.trim();
      const email = emailInput.value.trim();
      const password = passwordInput.value;

      // Check for fingerprint
      if (!fingerprint) {
        if (isDevEnv) console.error('Fingerprint not initialized');
        alert('Error: Device identification failed. Please try again.');
        return;
      }

      // Create JSON payload
      const data = {
        username,
        email,
        password,
        fingerprint
      };

      // Submit via fetchWithCsrf
      try {
        const response = await fetchWithCsrf(form.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        if (response.redirected) {
          window.location.href = response.url;
          return;
        }

        const text = await response.text();
        let dataResponse;
        try {
          dataResponse = JSON.parse(text);
        } catch (parseError) {
          if (isDevEnv) console.error('Non-JSON response:', text, parseError);
          if (response.ok) {
            alert('Signup successful!');
            window.location.href = '/profile'; // Adjust redirect as needed
            return;
          }
          throw new Error(`Failed to parse server response: ${parseError.message}`);
        }

        if (response.ok && dataResponse.status === 'success') {
          alert('Signup successful!');
          window.location.href = '/profile'; // Adjust redirect as needed
        } else {
          alert(dataResponse.message || 'Error signing up.');
        }
      } catch (error) {
        if (isDevEnv) console.error('Signup error:', error);
        alert('Error signing up: ' + error.message);
      }
    });
  } else {
    if (isDevEnv) console.error('Form or inputs not found. Check selectors: #sel-signupForm, input[name=username], input[name=email], input[name=password], #sel-passwordError');
  }

  // Debug fetchWithCsrf availability
  if (isDevEnv && typeof fetchWithCsrf !== 'function') {
    console.error('fetchWithCsrf is not defined. Ensure utils.js is loaded before signup.js');
  }
});