const socket = io();
const isDevEnv = '<%= process.env.NODE_ENV %>' === 'development';

socket.on('connect', () => {
  if (isDevEnv) console.log('Connected to Socket.io server for chat list');
  setInterval(() => {
    socket.emit('heartbeat');
  }, 15000);
});

socket.on('connect_error', (error) => {
  console.error('Socket.io connection error:', error);
  alert('Failed to connect to the chat server. Please try refreshing the page.');
});

function filterChats(filter) {
  const chatItems = document.querySelectorAll('.chat-item');
  chatItems.forEach(item => {
    const username = item.getAttribute('data-username')?.toLowerCase() || '';
    const tipAmount = parseFloat(item.getAttribute('data-tip')) || 0;
    const isOnline = item.getAttribute('data-online') === 'true';
    const isUnread = item.classList.contains('unread');

    let shouldShow = true;
    if (filter === 'unread' && !isUnread) shouldShow = false;
    if (filter === 'online' && !isOnline) shouldShow = false;
    if (filter === 'highest-tips' && tipAmount === 0) shouldShow = false;

    item.style.display = shouldShow ? 'block' : 'none';
  });

  if (filter === 'a-z' || filter === 'highest-tips') {
    const sortedItems = Array.from(chatItems).sort((a, b) => {
      if (filter === 'a-z') {
        const nameA = a.getAttribute('data-username')?.toLowerCase() || '';
        const nameB = b.getAttribute('data-username')?.toLowerCase() || '';
        return nameA.localeCompare(nameB);
      } else if (filter === 'highest-tips') {
        const tipA = parseFloat(a.getAttribute('data-tip')) || 0;
        const tipB = parseFloat(b.getAttribute('data-tip')) || 0;
        return tipB - tipA;
      }
    });
    const container = document.querySelector('.chat-list-container');
    sortedItems.forEach(item => container.appendChild(item));
  }
}

function searchChats() {
  const searchInput = document.getElementById('searchInput');
  if (!searchInput) {
    console.error('searchInput element not found');
    return;
  }
  const searchTerm = searchInput.value.toLowerCase().trim();
  const chatItems = document.querySelectorAll('.chat-item');
  chatItems.forEach(item => {
    const username = item.getAttribute('data-username')?.toLowerCase() || '';
    item.style.display = username.includes(searchTerm) ? 'block' : 'none';
  });
}

// Debounced search event listener
document.getElementById('searchInput')?.addEventListener('input', () => {
  clearTimeout(window.searchChatsTimeout);
  window.searchChatsTimeout = setTimeout(searchChats, 300);
});

// --- Debug FetchWithCsrf Availability ---
if (isDevEnv && typeof fetchWithCsrf !== 'function') {
  console.error('fetchWithCsrf is not defined. Ensure utils.js is loaded before chatlist.js');
}