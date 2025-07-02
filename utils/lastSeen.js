// utils/lastSeen.js
const getLastSeenDisplay = (isOnline, lastSeen) => {
    if (isOnline) {
      return 'Available Now';
    }
    if (!lastSeen) {
      return 'Not available';
    }
  
    const timeDiff = Math.floor((Date.now() - new Date(lastSeen)) / (1000 * 60)); // Minutes
    if (timeDiff < 1) {
      return 'Last seen less than a minute ago';
    }
    if (timeDiff < 60) {
      return `Last seen ${timeDiff} min${timeDiff === 1 ? '' : 's'} ago`;
    }
    if (timeDiff < 1440) {
      const hours = Math.floor(timeDiff / 60);
      return `Last seen ${hours} hour${hours === 1 ? '' : 's'} ago`;
    }
    const days = Math.floor(timeDiff / (60 * 24));
    return `Last seen ${days} day${days === 1 ? '' : 's'} ago`;
  };
  
  module.exports = { getLastSeenDisplay };