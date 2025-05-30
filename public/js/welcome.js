document.addEventListener('DOMContentLoaded', function() {
    const togglePassword = document.querySelector('.wel-toggle-password');
    const passwordInput = document.getElementById('password');

    togglePassword.addEventListener('click', function() {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      this.textContent = type === 'password' ? '👁️' : '🙈';
    });
  });