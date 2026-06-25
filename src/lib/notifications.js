const NOTIF_KEY = 'narp_notifs_v1';

export const isNotifEnabled = () => {
  try {
    return localStorage.getItem(NOTIF_KEY) === 'true';
  } catch {
    return false;
  }
};

export const setNotifEnabled = (enabled) => {
  try {
    localStorage.setItem(NOTIF_KEY, enabled ? 'true' : 'false');
  } catch {}
};

export const requestNotifPermission = async () => {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return await Notification.requestPermission();
};

export const getNotifPermission = () => {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
};

export const showChatNotification = ({ title, body, tag }) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!isNotifEnabled()) return;
  try {
    const n = new Notification(title, {
      body,
      tag,
      icon: '/icons/icon-192.png',
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch (e) {
    console.warn('[NARP] Notification error:', e);
  }
};
