document.addEventListener('DOMContentLoaded', function () {
  const isDevEnv = '<%= process.env.NODE_ENV %>' === 'development';
  const form = document.querySelector('.edit-profile-form');
  const usernameInput = document.getElementById('username');
  const originalUsername = usernameInput.value;
  const instagramUrlInput = document.getElementById('instagramUrl');
  const twitterUrlInput = document.getElementById('twitterUrl');

  form.addEventListener('submit', function (e) {
    const newUsername = usernameInput.value.trim();
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(newUsername)) {
      e.preventDefault();
      alert('Username must be 3-20 characters long, alphanumeric, and can include underscores.');
      if (isDevEnv) console.log('Username validation failed:', newUsername);
      return;
    }
    if (newUsername !== originalUsername) {
      if (!confirm('Changing your username will update your profile URL. Existing links to your profile may break. Are you sure you want to proceed?')) {
        e.preventDefault();
        if (isDevEnv) console.log('Username change cancelled by user');
        return;
      }
    }

    const instagramUrl = instagramUrlInput.value.trim();
    const twitterUrl = twitterUrlInput.value.trim();

    if (instagramUrl && !/^https?:\/\/(www\.)?instagram\.com\/.+$/.test(instagramUrl)) {
      e.preventDefault();
      alert('Please enter a valid Instagram URL');
      instagramUrlInput.focus();
      if (isDevEnv) console.log('Invalid Instagram URL:', instagramUrl);
      return;
    }

    if (twitterUrl && !/^https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+$/.test(twitterUrl)) {
      e.preventDefault();
      alert('Please enter a valid Twitter/X URL');
      twitterUrlInput.focus();
      if (isDevEnv) console.log('Invalid Twitter/X URL:', twitterUrl);
      return;
    }
  });

  // --- Debug FetchWithCsrf Availability ---
  if (isDevEnv && typeof fetchWithCsrf !== 'function') {
    console.error('fetchWithCsrf is not defined. Ensure utils.js is loaded before edit-profile.js');
  }
});