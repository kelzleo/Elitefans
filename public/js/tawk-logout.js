// public/js/tawk-logout.js
document.addEventListener('DOMContentLoaded', function () {
  console.info('[tawk-logout.js] loaded');

  // Only proceed if this is the post-logout redirect
  const urlParams = new URLSearchParams(window.location.search);
  console.info('[tawk-logout.js] URL params detected:', Array.from(urlParams.entries()));
  if (!urlParams.has('tawk_logout')) {
    console.info('[tawk-logout.js] no logout flag, skipping');
    return;
  }

  console.info('[tawk-logout.js] detected tawk_logout=1, initiating cleanup');

  // Perform immediate cleanup
  async function performCleanup() {
    try {
      // Step 1: Hide widget if visible
      if (window.Tawk_API?.hideWidget) {
        window.Tawk_API.hideWidget();
        console.info('[tawk-logout.js] Hid Tawk widget');
      }

      // Step 2: End current chat if active
      if (window.Tawk_API?.endChat) {
        window.Tawk_API.endChat();
        console.info('[tawk-logout.js] Ended current chat');
      }

      // Step 3: Logout via Tawk API if available
      if (window.Tawk_API && typeof window.Tawk_API.logout === 'function') {
        console.info('[tawk-logout.js] Calling Tawk_API.logout()');
        await new Promise((resolve) => {
          window.Tawk_API.logout((error) => {
            if (error) console.warn('[tawk-logout.js] Logout error:', error);
            else console.info('[tawk-logout.js] Logout success');
            resolve();
          });
        });
      }

      // Step 4: Shutdown to disconnect socket/session
      if (window.Tawk_API?.shutdown) {
        window.Tawk_API.shutdown();
        console.info('[tawk-logout.js] Shutdown Tawk connection');
      }

      // Step 5: Clear all Tawk-related storage (local and session)
      try {
        Object.keys(localStorage).forEach(key => {
          if (/^tawk[A-Z]/.test(key)) {
            localStorage.removeItem(key);
            console.info('[tawk-logout.js] Removed localStorage key:', key);
          }
        });
      } catch (e) {
        console.warn('[tawk-logout.js] Error clearing localStorage:', e);
      }

      try {
        Object.keys(sessionStorage).forEach(key => {
          if (/^tawk[A-Z]/.test(key) || /tawk/i.test(key)) {
            sessionStorage.removeItem(key);
            console.info('[tawk-logout.js] Removed sessionStorage key:', key);
          }
        });
      } catch (e) {
        console.warn('[tawk-logout.js] Error clearing sessionStorage:', e);
      }

      // Step 6: Remove Tawk DOM elements and scripts
      try {
        // Remove scripts
        Array.from(document.querySelectorAll('script[src*="tawk.to"]')).forEach(script => {
          script.remove();
          console.info('[tawk-logout.js] Removed Tawk script');
        });

        // Remove iframes and other Tawk elements
        Array.from(document.querySelectorAll('iframe[src*="tawk.to"], [id*="tawk"], [class*="tawk_"], .tawk-element')).forEach(el => {
          el.remove();
          console.info('[tawk-logout.js] Removed Tawk element:', el.tagName || el.nodeName);
        });

        // Reset global Tawk variables
        if (window.Tawk_API) {
          delete window.Tawk_API;
          window.Tawk_API = undefined;
        }
        if (window.Tawk_LoadStart) {
          delete window.Tawk_LoadStart;
          window.Tawk_LoadStart = undefined;
        }
      } catch (e) {
        console.warn('[tawk-logout.js] Error removing DOM elements:', e);
      }

      // Step 7: Set flags for support.js to detect
      const now = Date.now().toString();
      sessionStorage.setItem('tawkJustLoggedOut', now);
      sessionStorage.setItem('tawkCleaned', now);
      console.info('[tawk-logout.js] Set cleanup flags:', now);

    } catch (err) {
      console.error('[tawk-logout.js] Cleanup error:', err);
    }
  }

  // Execute cleanup
  performCleanup().then(() => {
    console.info('[tawk-logout.js] Cleanup complete');
    
    // Clean URL by removing the query param - this will trigger a fresh load without param
    const newUrl = window.location.pathname + window.location.hash;
    window.location.replace(newUrl);
  });
});