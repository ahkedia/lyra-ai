import webpush from 'web-push';

export function createPushSender() {
  const { LYRA_VAPID_PUBLIC_KEY: publicKey, LYRA_VAPID_PRIVATE_KEY: privateKey, LYRA_VAPID_SUBJECT: subject = 'mailto:akash@localhost' } = process.env;
  if (!publicKey || !privateKey) return { publicKey: null, send: async () => ({ delivered: false, reason: 'VAPID keys not configured' }) };
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return { publicKey, send: async (subscription, payload) => { await webpush.sendNotification(subscription, JSON.stringify(payload)); return { delivered: true }; } };
}
