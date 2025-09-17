// public/js/support.js
document.addEventListener('DOMContentLoaded', function () {
  console.info('[support.js] loaded');

  const MAX_WAIT_MS = 3000;
  const POLL_MS = 100;
  
  // Add a flag to prevent multiple initializations
  if (window.supportJsInitialized) {
    console.warn('[support.js] already initialized, skipping');
    return;
  }

  async function waitForClean() {
    console.info('[support.js] waiting for cleanup to complete...');
    const start = Date.now();
    
    while (Date.now() - start < MAX_WAIT_MS) {
      const cleanedFlag = sessionStorage.getItem('tawkCleaned');
      const loggedOutFlag = sessionStorage.getItem('tawkJustLoggedOut');
      
      if (cleanedFlag) {
        // Check if the cleanup happened recently (within last 10 seconds)
        const cleanedTime = parseInt(cleanedFlag);
        const loggedOutTime = parseInt(loggedOutFlag);
        
        if (cleanedTime && loggedOutTime && (cleanedTime >= loggedOutTime)) {
          sessionStorage.removeItem('tawkCleaned');
          sessionStorage.removeItem('tawkJustLoggedOut');
          console.info('[support.js] cleanup detected and flags cleared');
          return true;
        }
      }
      
      await new Promise(r => setTimeout(r, POLL_MS));
    }
    
    console.warn('[support.js] cleanup not detected (timeout)');
    // Clean up stale flags
    sessionStorage.removeItem('tawkJustLoggedOut');
    sessionStorage.removeItem('tawkCleaned');
    return false;
  }

  (async function preflight() {
    const loggedOutFlag = sessionStorage.getItem('tawkJustLoggedOut');
    const forceResetFlag = sessionStorage.getItem('tawkForceReset');
    
    if (forceResetFlag) {
      console.info('[support.js] detected tawkForceReset flag, clearing and proceeding with fresh init');
      sessionStorage.removeItem('tawkForceReset');
      sessionStorage.removeItem('tawkJustLoggedOut');
      sessionStorage.removeItem('tawkCleaned');
      
      // Extra cleanup for forced reset
      try {
        Object.keys(localStorage).forEach(k => { 
          if (/tawk/i.test(k)) localStorage.removeItem(k); 
        });
        Object.keys(sessionStorage).forEach(k => { 
          if (/tawk/i.test(k)) sessionStorage.removeItem(k); 
        });
      } catch (e) {}
      
      // Delay init after force reset to allow full state clear
      await new Promise(r => setTimeout(r, 1500));
    } else if (loggedOutFlag) {
      const loggedOutTime = parseInt(loggedOutFlag);
      const now = Date.now();
      
      // If the flag is older than 30 seconds, consider it stale
      if (now - loggedOutTime > 30000) {
        console.info('[support.js] stale tawkJustLoggedOut flag, clearing and proceeding');
        sessionStorage.removeItem('tawkJustLoggedOut');
        sessionStorage.removeItem('tawkCleaned');
      } else {
        console.info('[support.js] saw recent tawkJustLoggedOut — waiting for cleanup');
        await waitForClean();
        // Add a small delay to ensure cleanup is complete
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    window.supportJsInitialized = true;
    initSupport();
  })();

  async function initSupport() {
    const supportContainer = document.querySelector('.support-container');
    if (!supportContainer) {
      console.info('[support.js] no .support-container found, skipping init');
      return;
    }

    // Double-check for existing Tawk instances
    if (window.Tawk_API && window.Tawk_API._initialized) {
      console.warn('[support.js] Tawk already initialized, skipping');
      return;
    }

    // Remove any lingering Tawk elements before init (always clean)
    try {
      Array.from(document.querySelectorAll('script[src*="tawk.to"]')).forEach(s => s.remove());
      Array.from(document.querySelectorAll('iframe[src*="tawk.to"], [id*="tawk"], [class*="tawk"]')).forEach(el => el.remove());
      
      // Extra clear of storage before every init to prevent stale data
      Object.keys(localStorage).forEach(k => { 
        if (/tawk/i.test(k)) localStorage.removeItem(k); 
      });
      Object.keys(sessionStorage).forEach(k => { 
        if (/tawk/i.test(k) && !['tawkJustLoggedOut', 'tawkCleaned', 'tawkForceReset'].includes(k)) sessionStorage.removeItem(k); 
      });
    } catch (e) {
      console.warn('[support.js] Error cleaning up old tawk elements/storage:', e);
    }

    const domHash = supportContainer.dataset.userHash || '';
    const domName = supportContainer.dataset.userName || '';
    const domEmail = supportContainer.dataset.userEmail || '';
    const domId = supportContainer.dataset.userId || '';

    console.info('[support.js] domHash (first 12 chars):', domHash ? domHash.slice(0,12) : '(none)');
    console.info('[support.js] domName/domEmail/domId:', domName, domEmail, domId);

    async function fetchVisitorIdentity() {
      try {
        const resp = await fetch('/support/visitor-identity', { credentials: 'same-origin' });
        if (!resp.ok) return null;
        const json = await resp.json();
        return json && json.ok ? json : null;
      } catch (err) {
        console.error('Failed to fetch /support/visitor-identity:', err);
        return null;
      }
    }

    // Delay setAttributes until API is ready
    function applyAttributesAsSet(data, maxRetries = 5) {
      return new Promise((resolve) => {
        let retries = 0;
        function attemptSet() {
          if (window.Tawk_API?.setAttributes) {
            window.Tawk_API.setAttributes(data, function (err) {
              if (err) console.error('Tawk.setAttributes error:', err);
              else console.info('Tawk attributes set:', data);
              resolve();
            });
          } else if (retries < maxRetries) {
            retries++;
            setTimeout(attemptSet, 500);
          } else {
            console.warn('Tawk_API.setAttributes not available after retries');
            resolve();
          }
        }
        attemptSet();
      });
    }

    // Make applyLogin return a Promise for proper awaiting
    function applyLogin(data) {
      return new Promise((resolve, reject) => {
        if (window.Tawk_API?.login) {
          window.Tawk_API.login(data, function (err) {
            if (err) {
              console.error('Tawk.login error:', err);
              if (err.code === 'BadRequestError' && /INVALID_HASH/.test(err.message || '')) {
                console.warn('[support.js] INVALID_HASH — forcing session reset without reload');
                
                // Force session reset sequence without reload
                try { 
                  if (window.Tawk_API.endChat) window.Tawk_API.endChat();
                  if (window.Tawk_API.logout) window.Tawk_API.logout();
                  if (window.Tawk_API.visitor?.logout) window.Tawk_API.visitor.logout();
                  if (window.Tawk_API.shutdown) window.Tawk_API.shutdown();
                } catch (e) {}
                
                // Clear all tawk storage
                try {
                  Object.keys(localStorage).forEach(k => { 
                    if (/tawk/i.test(k)) localStorage.removeItem(k); 
                  });
                  Object.keys(sessionStorage).forEach(k => { 
                    if (/tawk/i.test(k)) sessionStorage.removeItem(k); 
                  });
                } catch (e) {}
                
                // Remove widget DOM completely
                try {
                  Array.from(document.querySelectorAll('iframe[src*="tawk"], [id*="tawk"], [class*="tawk"]')).forEach(el => el.remove());
                  Array.from(document.scripts).forEach(s => { 
                    if (s.src && /tawk\.to/.test(s.src)) s.remove(); 
                  });
                } catch (e) {}
                
                // Reset global variables
                try { delete window.Tawk_API; } catch (e) { window.Tawk_API = undefined; }
                try { delete window.Tawk_LoadStart; } catch (e) { window.Tawk_LoadStart = undefined; }
                
                // Reset loadHandled for re-init
                loadHandled = false;
                
                // Re-inject script after reset to start fresh
                setTimeout(() => {
                  window.Tawk_API = window.Tawk_API || {};
                  window.Tawk_LoadStart = new Date();
                  insertTawk(); // Re-call insert function
                }, 1500);
                
                reject(err); // Still reject to fallback
              } else {
                reject(err);
              }
            } else {
              console.info('Tawk login success');
              resolve();
            }
          });
        } else {
          console.warn('Tawk_API.login not available, falling back to attributes immediately');
          applyAttributesAsSet(data).then(resolve);
        }
      });
    }

    // Function to force end old session and prepare for new
    async function endOldSession() {
      console.info('[support.js] Ending any old session');
      if (window.Tawk_API?.hideWidget) {
        window.Tawk_API.hideWidget();
      }
      if (window.Tawk_API?.endChat) {
        window.Tawk_API.endChat();
      }
      if (window.Tawk_API?.logout) {
        await new Promise((resolve) => {
          window.Tawk_API.logout((error) => {
            if (error) console.warn('[support.js] Pre-login logout error:', error);
            resolve();
          });
        });
      }
      if (window.Tawk_API?.shutdown) {
        window.Tawk_API.shutdown();
      }
      await new Promise(r => setTimeout(r, 1500)); // Wait for disconnect
    }

    // Function to open the chat pane and force new session
    function openChatPane() {
      console.info('[support.js] Opening chat pane and forcing new session');
      if (window.Tawk_API?.endChat) {
        window.Tawk_API.endChat();
        console.info('[support.js] Ended any lingering chat to force new');
      }
      setTimeout(() => {
        if (window.Tawk_API?.maximize) {
          window.Tawk_API.maximize();
        }
        if (window.Tawk_API?.showWidget) {
          window.Tawk_API.showWidget();
        }
      }, 500);
    }

    // Initialize Tawk API
    window.Tawk_API = window.Tawk_API || {};
    window.Tawk_LoadStart = new Date();

    // Declare loadHandled in the scope and insertTawk function
    let loadHandled = false;

    function insertTawk() {
      // Final check for existing script
      if (document.querySelector('script[src*="embed.tawk.to"]')) {
        console.warn('[support.js] Tawk script already exists, not injecting');
        return;
      }
      
      const s1 = document.createElement('script');
      const s0 = document.getElementsByTagName('script')[0];
      s1.async = true;
      s1.src = 'https://embed.tawk.to/68c7154ca30a7b1922d4a94a/1j54qmdn1';
      s1.charset = 'UTF-8';
      s1.setAttribute('crossorigin', '*');
      
      s1.onload = () => {
        console.info('[support.js] Tawk script loaded successfully');
        // Give the widget a moment to initialize
        setTimeout(() => {
          if (window.Tawk_API?.onLoad && !loadHandled) {
            window.Tawk_API.onLoad();
          }
        }, 200);
      };
      
      s1.onerror = e => {
        console.error('Failed to load Tawk script', e);
        window.supportJsInitialized = false; // Allow retry
      };
      
      console.info('[support.js] Injecting Tawk script');
      s0.parentNode.insertBefore(s1, s0);
    }

    window.Tawk_API.onLoad = async function () {
      if (loadHandled) {
        console.warn('[support.js] onLoad already handled, skipping');
        return;
      }
      loadHandled = true;
      
      console.info('Tawk widget loaded (onLoad)');
      window.Tawk_API._initialized = true;
      
      let visitor = domHash ? 
        { hash: domHash, identifier: domId, name: domName, email: domEmail } :
        await fetchVisitorIdentity();

      console.info('[support.js] final visitor object (hash first 12):',
        visitor?.hash ? visitor.hash.slice(0,12) : '(none)');
      console.info('[support.js] visitor identifier:', visitor?.identifier);

      if (visitor?.hash && visitor?.identifier) {
        // Skip endOldSession to avoid interfering with new login session
        // await endOldSession(); // Commented out to prevent ending new session

        try {
          await applyLogin({
            hash: visitor.hash,
            userId: visitor.identifier || domId,
            name: visitor.name || domName || 'Visitor',
            email: visitor.email || domEmail || ''
          });
          
          // Start new connection after login
          if (window.Tawk_API?.start) {
            window.Tawk_API.start({ showWidget: true });
            console.info('[support.js] Started new Tawk connection');
          }
          
          // Force new chat and open pane after login
          setTimeout(openChatPane, 1000);
        } catch (loginErr) {
          console.warn('[support.js] Login failed, falling back to attributes');
          await applyAttributesAsSet({ 
            name: visitor.name || domName || 'Visitor', 
            email: visitor.email || domEmail || '', 
            id: visitor.identifier || domId || undefined 
          });
          
          // Still start connection
          if (window.Tawk_API?.start) {
            window.Tawk_API.start({ showWidget: true });
          }
          
          // Force new chat and open pane
          setTimeout(openChatPane, 1000);
        }
      } else {
        console.warn('[support.js] Missing hash or identifier, falling back to attributes');
        await applyAttributesAsSet({ 
          name: domName || 'Visitor', 
          email: domEmail || '', 
          id: domId || undefined 
        });
        
        if (window.Tawk_API?.start) {
          window.Tawk_API.start({ showWidget: true });
        }
        
        // Force new chat and open pane
        setTimeout(openChatPane, 1000);
      }
    };

    // Initial script injection
    insertTawk();
  }
});