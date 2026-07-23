const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const {RtcTokenBuilder, RtcRole, RtmTokenBuilder, RtmRole} = require('agora-access-token');
const admin = require('firebase-admin');

dotenv.config();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const APP_ID = process.env.APP_ID;
const APP_CERTIFICATE = process.env.APP_CERTIFICATE;

// ===== Setup Firebase Admin (untuk kirim push notification & baca database) =====
let firebaseInitialized = false;
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  firebaseInitialized = true;
  console.log('Firebase Admin berhasil diinisialisasi.');
} catch (e) {
  console.error('Firebase Admin GAGAL diinisialisasi:', e.message);
}

const nocache = (_, resp, next) => {
  resp.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  resp.header('Expires', '-1');
  resp.header('Pragma', 'no-cache');
  next();
}

const ping = (req, resp) => {
  resp.send({message: 'pong'});
}

const generateRTCToken = (req, resp) => {
  resp.header('Access-Control-Allow-Origin', '*');
  const channelName = req.params.channel;
  if (!channelName) {
    return resp.status(500).json({ 'error': 'channel is required' });
  }
  let uid = req.params.uid;
  if(!uid || uid === '') {
    return resp.status(500).json({ 'error': 'uid is required' });
  }
  let role;
  if (req.params.role === 'publisher') {
    role = RtcRole.PUBLISHER;
  } else if (req.params.role === 'audience') {
    role = RtcRole.SUBSCRIBER
  } else {
    return resp.status(500).json({ 'error': 'role is incorrect' });
  }
  let expireTime = req.query.expiry;
  if (!expireTime || expireTime === '') {
    expireTime = 3600;
  } else {
    expireTime = parseInt(expireTime, 10);
  }
  const currentTime = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTime + expireTime;
  let token;
  if (req.params.tokentype === 'userAccount') {
    token = RtcTokenBuilder.buildTokenWithAccount(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpireTime);
  } else if (req.params.tokentype === 'uid') {
    token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpireTime);
  } else {
    return resp.status(500).json({ 'error': 'token type is invalid' });
  }
  return resp.json({ 'rtcToken': token });
}

const generateRTMToken = (req, resp) => {
  resp.header('Access-Control-Allow-Origin', '*');
  let uid = req.params.uid;
  if(!uid || uid === '') {
    return resp.status(500).json({ 'error': 'uid is required' });
  }
  let role = RtmRole.Rtm_User;
  let expireTime = req.query.expiry;
  if (!expireTime || expireTime === '') {
    expireTime = 3600;
  } else {
    expireTime = parseInt(expireTime, 10);
  }
  const currentTime = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTime + expireTime;
  console.log(APP_ID, APP_CERTIFICATE, uid, role, privilegeExpireTime)
  const token = RtmTokenBuilder.buildToken(APP_ID, APP_CERTIFICATE, uid, role, privilegeExpireTime);
  return resp.json({ 'rtmToken': token });
}

const generateRTEToken = (req, resp) => {
  resp.header('Access-Control-Allow-Origin', '*');
  const channelName = req.params.channel;
  if (!channelName) {
    return resp.status(500).json({ 'error': 'channel is required' });
  }
  let uid = req.params.uid;
  if(!uid || uid === '') {
    return resp.status(500).json({ 'error': 'uid is required' });
  }
  let role;
  if (req.params.role === 'publisher') {
    role = RtcRole.PUBLISHER;
  } else if (req.params.role === 'audience') {
    role = RtcRole.SUBSCRIBER
  } else {
    return resp.status(500).json({ 'error': 'role is incorrect' });
  }
  let expireTime = req.query.expiry;
  if (!expireTime || expireTime === '') {
    expireTime = 3600;
  } else {
    expireTime = parseInt(expireTime, 10);
  }
  const currentTime = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTime + expireTime;
  const rtcToken = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpireTime);
  const rtmToken = RtmTokenBuilder.buildToken(APP_ID, APP_CERTIFICATE, uid, role, privilegeExpireTime);
  return resp.json({ 'rtcToken': rtcToken, 'rtmToken': rtmToken });
}

// ===== Endpoint: kirim push notification (FCM) ke SATU user =====
// Body request (JSON):
// {
//   "targetUid": "uid tujuan di Firebase",
//   "type": "message" | "call" | "alarm",
//   "title": "judul notifikasi",
//   "body": "isi notifikasi",
//   "data": { ...field tambahan bebas... }
// }
const sendNotification = async (req, resp) => {
  resp.header('Access-Control-Allow-Origin', '*');

  if (!firebaseInitialized) {
    return resp.status(500).json({ 'error': 'Firebase Admin belum siap di server, cek environment variable.' });
  }

  const { targetUid, type, title, body, data } = req.body || {};

  if (!targetUid) {
    return resp.status(400).json({ 'error': 'targetUid is required' });
  }
  if (!type || (type !== 'message' && type !== 'call' && type !== 'alarm')) {
    return resp.status(400).json({ 'error': 'type harus "message", "call", atau "alarm"' });
  }

  try {
    const result = await sendToOneUid(targetUid, type, title, body, data);
    if (!result.success) {
      return resp.status(result.status || 500).json({ 'error': result.error });
    }
    return resp.json({ 'success': true, 'messageId': result.messageId });
  } catch (e) {
    console.error('Gagal mengirim notifikasi:', e);
    return resp.status(500).json({ 'error': e.message });
  }
}

// ===== Endpoint BARU: kirim push notification (FCM) ke BANYAK user sekaligus =====
// Dipakai untuk broadcast ke semua anggota grup, misalnya fitur @alarm di
// GroupChatActivity: satu request, semua anggota grup dapat data alarm yang
// sama, lalu masing-masing device menjadwalkan alarm lokal sendiri.
//
// Body request (JSON):
// {
//   "targetUids": ["uid1", "uid2", "uid3", ...],
//   "type": "message" | "call" | "alarm",
//   "title": "judul notifikasi",
//   "body": "isi notifikasi",
//   "data": { ...field tambahan bebas, sama untuk semua target... }
// }
//
// Response: { success: true, results: [ { targetUid, success, messageId? , error? }, ... ] }
// Tetap mengembalikan 200 walau sebagian gagal (misal 1 anggota belum pernah
// login jadi tidak punya fcmToken) -- caller bisa cek array "results" untuk
// detail per-anggota tanpa seluruh broadcast dianggap gagal.
const sendNotificationBulk = async (req, resp) => {
  resp.header('Access-Control-Allow-Origin', '*');

  if (!firebaseInitialized) {
    return resp.status(500).json({ 'error': 'Firebase Admin belum siap di server, cek environment variable.' });
  }

  const { targetUids, type, title, body, data } = req.body || {};

  if (!Array.isArray(targetUids) || targetUids.length === 0) {
    return resp.status(400).json({ 'error': 'targetUids harus array dan tidak boleh kosong' });
  }
  if (!type || (type !== 'message' && type !== 'call' && type !== 'alarm')) {
    return resp.status(400).json({ 'error': 'type harus "message", "call", atau "alarm"' });
  }

  const results = await Promise.all(
    targetUids.map(async (uid) => {
      const r = await sendToOneUid(uid, type, title, body, data);
      return { targetUid: uid, ...r };
    })
  );

  return resp.json({ 'success': true, 'results': results });
}

/**
 * Helper inti: ambil fcmToken milik satu uid dari Realtime Database, lalu
 * kirim sebagai FCM DATA MESSAGE (bukan notification message bawaan),
 * supaya Android yang mengontrol penuh tampilan notifikasi & bisa memicu
 * aksi lokal (mis. AlarmScheduler.schedule untuk type "alarm").
 */
async function sendToOneUid(targetUid, type, title, body, data) {
  try {
    const snapshot = await admin.database()
      .ref(`users/${targetUid}/fcmToken`)
      .get();

    const fcmToken = snapshot.val();
    if (!fcmToken) {
      return { success: false, status: 404, error: 'targetUid tidak punya fcmToken (belum login/belum generate token)' };
    }

    const messagePayload = {
      token: fcmToken,
      data: {
        type: type,
        title: title || '',
        body: body || '',
        ...(data ? Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ) : {}),
      },
      android: {
        priority: 'high',
      },
    };

    const messageId = await admin.messaging().send(messagePayload);
    return { success: true, messageId };
  } catch (e) {
    console.error(`Gagal mengirim notifikasi ke ${targetUid}:`, e);
    return { success: false, status: 500, error: e.message };
  }
}

app.options('*', cors());
app.get('/ping', nocache, ping)
app.get('/rtc/:channel/:role/:tokentype/:uid', nocache , generateRTCToken);
app.get('/rtm/:uid/', nocache , generateRTMToken);
app.get('/rte/:channel/:role/:tokentype/:uid', nocache , generateRTEToken);
app.post('/send-notification', cors(), sendNotification);
app.post('/send-notification-bulk', cors(), sendNotificationBulk);

app.listen(PORT, () => {
  console.log(`Listening on port: ${PORT}`);
});
