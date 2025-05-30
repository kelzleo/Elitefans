// public/scripts/utils.js
async function fetchWithCsrf(url, options = {}) {
  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  if (!csrfMeta) {
    console.error('CSRF meta tag not found');
    throw new Error('CSRF meta tag not found');
  }
  const csrfToken = csrfMeta.getAttribute('content');
  if (!csrfToken) {
    console.error('CSRF token is empty');
    throw new Error('CSRF token empty');
  }

  const headers = {
    'X-CSRF-Token': csrfToken,
    ...options.headers,
  };

  // Only set Content-Type to application/json if the body is not FormData
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const fetchOptions = {
    ...options,
    headers,
    credentials: 'include',
  };

  try {
    const response = await fetch(url, fetchOptions);
    return response;
  } catch (error) {
    console.error('Fetch error:', error.message);
    throw error;
  }
}

window.fetchWithCsrf = fetchWithCsrf; // Expose globally