document.addEventListener('DOMContentLoaded', function () {
  const isDevEnv = '<%= process.env.NODE_ENV %>' === 'development';
  const form = document.querySelector('.edit-profile-form');
  const usernameInput = document.getElementById('username');
  const originalUsername = usernameInput.value;
  const instagramUrlInput = document.getElementById('instagramUrl');
  const twitterUrlInput = document.getElementById('twitterUrl');

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

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    // Validation
    const newUsername = usernameInput.value.trim();
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(newUsername)) {
      alert('Username must be 3-20 characters long, alphanumeric, and can include underscores.');
      if (isDevEnv) console.log('Username validation failed:', newUsername);
      return;
    }
    if (newUsername !== originalUsername) {
      if (!confirm('Changing your username will update your profile URL. Existing links to your profile may break. Are you sure you want to proceed?')) {
        if (isDevEnv) console.log('Username change cancelled by user');
        return;
      }
    }

    const instagramUrl = instagramUrlInput.value.trim();
    const twitterUrl = twitterUrlInput.value.trim();

    if (instagramUrl && !/^https?:\/\/(www\.)?instagram\.com\/.+$/.test(instagramUrl)) {
      alert('Please enter a valid Instagram URL');
      instagramUrlInput.focus();
      if (isDevEnv) console.log('Invalid Instagram URL:', instagramUrl);
      return;
    }

    if (twitterUrl && !/^https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+$/.test(twitterUrl)) {
      alert('Please enter a valid Twitter/X URL');
      twitterUrlInput.focus();
      if (isDevEnv) console.log('Invalid Twitter/X URL:', twitterUrl);
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
      username: newUsername,
      instagramUrl,
      twitterUrl,
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
          alert('Profile updated successfully!');
          window.location.href = '/profile';
          return;
        }
        throw new Error(`Failed to parse server response: ${parseError.message}`);
      }

      if (response.ok && dataResponse.status === 'success') {
        alert('Profile updated successfully!');
        window.location.href = '/profile';
      } else {
        alert(dataResponse.message || 'Error updating profile.');
      }
    } catch (error) {
      if (isDevEnv) console.error('Form submission error:', error);
      alert('Error updating profile: ' + error.message);
    }
  });

  if (isDevEnv && typeof fetchWithCsrf !== 'function') {
    console.error('fetchWithCsrf is not defined. Ensure utils.js or profile.js is loaded before edit-profile.js');
  }
});