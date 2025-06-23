document.addEventListener('DOMContentLoaded', function () {
  const isDevEnv = '<%= process.env.NODE_ENV %>' === 'development';
  const togglePassword = document.querySelector('.wel-toggle-password');
  const passwordInput = document.getElementById('password');
  const emailInput = document.getElementById('email');
  const loginForm = document.querySelector('.wel-login-form'); // Adjust if different
  const signupLinks = document.querySelectorAll('a[href*="/signup"]');
  const forgotPasswordLink = document.querySelector('.wel-forgot-link');
  const googleLink = document.querySelector('.wel-a-sign');

  // Initialize FingerprintJS (global, no import)
  let fingerprint = null;
  if (typeof FingerprintJS !== 'undefined') {
    FingerprintJS.load()
      .then(fp => fp.get())
      .then(result => {
        fingerprint = result.visitorId;
        if (isDevEnv) console.log('Fingerprint initialized:', fingerprint);

        // Update signup links with fingerprint
        signupLinks.forEach(link => {
          const url = new URL(link.href, window.location.origin);
          url.searchParams.set('fingerprint', fingerprint);
          link.href = url.toString();
        });

        // Update forgot-password link
        if (forgotPasswordLink) {
          const url = new URL(forgotPasswordLink.href, window.location.origin);
          url.searchParams.set('fingerprint', fingerprint);
          forgotPasswordLink.href = url.toString();
        }

        // Update Google login link
        if (googleLink) {
          const url = new URL(googleLink.href, window.location.origin);
          url.searchParams.set('fingerprint', fingerprint);
          googleLink.href = url.toString();
        }
      })
      .catch(error => {
        if (isDevEnv) console.error('Error generating fingerprint:', error);
      });
  } else {
    if (isDevEnv) console.error('FingerprintJS is not loaded. Ensure FingerprintJS script is included.');
  }

  // Toggle password visibility
  if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', function () {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      this.textContent = type === 'password' ? '👁️' : '🙈';
    });
  }

  // Handle login form submission
  if (loginForm && emailInput && passwordInput) {
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      const email = emailInput.value.trim();
      const password = passwordInput.value;

      // Basic validation
      if (!email || !password) {
        if (isDevEnv) console.log('Email or password missing');
        alert('Please enter both email and password.');
        return;
      }

      // Check for fingerprint
      if (!fingerprint) {
        if (isDevEnv) console.error('Fingerprint not initialized');
        alert('Error: Device identification failed. Please try again.');
        return;
      }

      // Create JSON payload
      const data = {
        email,
        password,
        fingerprint
      };

      // Submit via fetchWithCsrf
      try {
        const response = await fetchWithCsrf(loginForm.action, {
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
            alert('Login successful!');
            window.location.href = '/profile'; // Adjust redirect as needed
            return;
          }
          throw new Error(`Failed to parse server response: ${parseError.message}`);
        }

        if (response.ok && dataResponse.status === 'success') {
          alert('Login successful!');
          window.location.href = '/profile'; // Adjust redirect as needed
        } else {
          alert(dataResponse.message || 'Error logging in.');
        }
      } catch (error) {
        if (isDevEnv) console.error('Login error:', error);
        alert('Error logging in: ' + error.message);
      }
    });
  } else {
    if (isDevEnv) console.error('Login form or inputs not found. Check selectors: .wel-login-form, #email, #password');
  }

  // Debug fetchWithCsrf availability
  if (isDevEnv && typeof fetchWithCsrf !== 'function') {
    console.error('fetchWithCsrf is not defined. Ensure utils.js is loaded before welcome.js');
  }
});