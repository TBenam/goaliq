/* ====================================================
   GoalIQ — Firebase Messaging Service Worker
   Handles background FCM push notifications.
   MUST be at the root of the PWA (same scope as SW).
   ==================================================== */

// !! IMPORTANT: Remplacer FIREBASE_CONFIG_PLACEHOLDER par votre config Firebase
//    Une fois que vous avez vos identifiants Firebase, mettez à jour :
//    firebaseConfig = { apiKey: "...", projectId: "...", messagingSenderId: "...", appId: "..." }

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// ← Remplacer par votre vraie config Firebase
const firebaseConfig = {
  apiKey: "AIzaSyA26ONSrmGIMw66QY__fClwDMlnFo-6UN4",
  authDomain: "goliat-8bf4a.firebaseapp.com",
  projectId: "goliat-8bf4a",
  storageBucket: "goliat-8bf4a.firebasestorage.app",
  messagingSenderId: "126041681895",
  appId: "1:126041681895:web:ddd88974dde8895b3bd742"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// ── Background message handler ─────────────────────
// Triggered when app is in background or closed
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM SW] Message reçu en background:', payload);

  const { title, body, imageUrl } = payload.notification || {};
  const data = payload.data || {};

  const notificationTitle = title || '🔥 GoalIQ — Nouvelle alerte';
  const notificationOptions = {
    body: body || 'Un nouveau prono est disponible !',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    image: imageUrl,
    tag: data.type || 'goaliq-prono',
    requireInteraction: data.urgent === 'true',
    data: { url: data.url || '/#pronos' },
    actions: [
      { action: 'voir', title: '🎯 Voir le prono' },
      { action: 'ignorer', title: 'Plus tard' }
    ],
    vibrate: [200, 100, 200]
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// ── Notification click ─────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  if (event.action === 'voir' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        const existing = clientList.find(c => c.url.includes('goaliq') || c.url.includes('localhost'));
        if (existing) {
          existing.focus();
          existing.navigate(url);
        } else {
          clients.openWindow(url);
        }
      })
    );
  }
});
