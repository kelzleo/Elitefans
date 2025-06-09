document.addEventListener('DOMContentLoaded', function () {
  const isDevEnv = '<%= process.env.NODE_ENV %>' === 'development';
  const form = document.querySelector('.edit-profile-form');
  const usernameInput = document.getElementById('username');
  const originalUsername = usernameInput.value;
  const instagramUrlInput = document.getElementById('instagramUrl');
  const twitterUrlInput = document.getElementById('twitterUrl');

  form.addEventListener('submit', async function (e) {
    e.preventDefault(); // Prevent default submission

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

    // Create FormData
    const formData = new FormData(form);

    // Submit via fetchWithCsrf
    try {
      const response = await fetchWithCsrf(form.action, {
        method: 'POST',
        body: formData,
      });

      // Check for redirect
      if (response.redirected) {
        window.location.href = response.url;
        return;
      }

      // Handle JSON response (in case of error)
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        if (isDevEnv) console.error('Non-JSON response:', text, parseError);
        if (response.ok) {
          alert('Profile updated successfully!');
          window.location.href = '/profile';
          return;
        }
        throw new Error(`Failed to parse server response: ${parseError.message}`);
      }

      if (response.ok && data.status === 'success') {
        alert('Profile updated successfully!');
        window.location.href = '/profile';
      } else {
        alert(data.message || 'Error updating profile.');
      }
    } catch (error) {
      if (isDevEnv) console.error('Form submission error:', error);
      alert('Error updating profile: ' + error.message);
    }
  });

  // Debug FetchWithCsrf Availability
  if (isDevEnv && typeof fetchWithCsrf !== 'function') {
    console.error('fetchWithCsrf is not defined. Ensure utils.js is loaded before edit-profile.js');
  }
});