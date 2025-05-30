document.addEventListener('DOMContentLoaded', () => {
  console.log('layout.ejs script loaded');

  // Function to add CSRF token to forms
  function addCsrfTokenToForms() {
    try {
      const csrfMeta = document.querySelector('meta[name="csrf-token"]');
      if (!csrfMeta) {
        console.error('CSRF meta tag not found.');
        return;
      }
      const csrfToken = csrfMeta.getAttribute('content');
      if (!csrfToken) {
        console.error('CSRF token is empty.');
        return;
      }

      document.querySelectorAll('form').forEach(form => {
        if (!form.querySelector('input[name="_csrf"]')) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = '_csrf';
          input.value = csrfToken;
          form.appendChild(input);
        }
      });
    } catch (error) {
      console.error('Error adding CSRF token to forms:', error.message);
    }
  }

  // Run CSRF token addition initially
  addCsrfTokenToForms();

  // Handle dynamic forms
  try {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === 'FORM' || node.querySelector('form'))) {
            addCsrfTokenToForms();
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  } catch (error) {
    console.error('Error setting up MutationObserver:', error.message);
  }

  // Profile menu toggle
  const profileNavTrigger = document.querySelector('.profile-nav-trigger');
  const profileMenu = document.querySelector('#profileMenu');
  if (profileNavTrigger && profileMenu) {
    profileNavTrigger.addEventListener('click', () => {
      try {
        profileMenu.classList.toggle('open');
      } catch (error) {
        console.error('Error toggling profile menu:', error.message);
      }
    });

    document.addEventListener('click', event => {
      try {
        if (
          profileMenu.classList.contains('open') &&
          !profileMenu.contains(event.target) &&
          !profileNavTrigger.contains(event.target)
        ) {
          profileMenu.classList.remove('open');
        }
      } catch (error) {
        console.error('Error handling profile menu click outside:', error.message);
      }
    });
  }
});