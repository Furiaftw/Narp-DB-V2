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

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

export const subscribeToPush = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  if (!VAPID_PUBLIC_KEY) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return existing;
    return await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  } catch (e) {
    console.warn('[NARP] Push subscribe error:', e);
    return null;
  }
};

export const unsubscribeFromPush = async () => {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe();
      return sub.endpoint;
    }
  } catch (e) {
    console.warn('[NARP] Push unsubscribe error:', e);
  }
  return null;
};
