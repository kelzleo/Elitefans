document.addEventListener('DOMContentLoaded', function() {
    const togglePassword = document.querySelector('.sel-toggle-password');
    const passwordInput  = document.querySelector('input[name="password"]');
    const usernameInput  = document.querySelector('input[name="username"]');
    const emailInput     = document.querySelector('input[name="email"]');
    const form           = document.getElementById('sel-signupForm');
    const errorDiv       = document.getElementById('sel-passwordError');

    function validatePassword() {
      const pwd      = passwordInput.value;
      const uname    = usernameInput.value.toLowerCase();
      const emailL   = emailInput.value.toLowerCase();
      let msg        = '';

      if (pwd.length < 8) {
        msg = 'At least 8 characters.';
      } else {
        const checks = [
          /[A-Z]/.test(pwd),
          /[a-z]/.test(pwd),
          /[0-9]/.test(pwd),
          /[!@#$%^&*]/.test(pwd)
        ].filter(Boolean).length;
        if (checks < 3) {
          msg = 'Include 3 of: uppercase, lowercase, number, symbol.';
        } else if (pwd.toLowerCase().includes(uname) || pwd.toLowerCase().includes(emailL)) {
          msg = 'Don’t include username or email.';
        }
      }

      errorDiv.textContent   = msg;
      errorDiv.style.display = msg ? 'block' : 'none';
    }

    togglePassword.addEventListener('click', () => {
      const type = passwordInput.type === 'password' ? 'text' : 'password';
      passwordInput.type = type;
      togglePassword.textContent = type === 'password' ? '👁️' : '🙈';
    });

    passwordInput.addEventListener('input', validatePassword);
    usernameInput.addEventListener('input', validatePassword);
    emailInput.addEventListener('input', validatePassword);

    form.addEventListener('submit', function(e) {
      validatePassword();
      if (errorDiv.textContent) e.preventDefault();
    });
  });