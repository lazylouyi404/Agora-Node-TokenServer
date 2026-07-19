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
// FIREBASE_SERVICE_ACCOUNT harus diisi di environment variable Vercel, isinya
// seluruh isi file JSON service account (Project Settings > Service Accounts >
// Generate new private key di Firebase Console), di-copy sebagai satu baris string.
// FIREBASE_DATABASE_URL isinya URL Realtime Database, contoh:
// https://rndtalk-4ab15-default-rtdb.asia-southeast1.firebasedatabase.app
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
  // set response header
  resp.header('Access-Control-Allow-Origin', '*');
  // get channel name
  const channelName = req.params.channel;
  if (!channelName) {
    return resp.status(500).json({ 'error': 'channel is required' });
  }
  // get uid
  let uid = req.params.uid;
  if(!uid || uid === '') {
    return resp.status(500).json({ 'error': 'uid is required' });
  }
  // get role
  let role;
  if (req.params.role === 'publisher') {
    role = RtcRole.PUBLISHER;
  } else if (req.params.role === 'audience') {
    role = RtcRole.SUBSCRIBER
  } else {
    return resp.status(500).json({ 'error': 'role is incorrect' });
  }
  // get the expire time
  let expireTime = req.query.expiry;
  if (!expireTime || expireTime === '') {
    expireTime = 3600;
  } else {
    expireTime = parseInt(expireTime, 10);
  }
  // calculate privilege expire time
  const currentTime = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTime + expireTime;
  // build the token
  let token;
  if (req.params.tokentype === 'userAccount') {
    token = RtcTokenBuilder.buildTokenWithAccount(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpireTime);
  } else if (req.params.tokentype === 'uid') {
    token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpireTime);
  } else {
    return resp.status(500).json({ 'error': 'token type is invalid' });
  }
  // return the token
  return resp.json({ 'rtcToken': token });
}

const generateRTMToken = (req, resp) => {
  // set response header
  resp.header('Access-Control-Allow-Origin', '*');

  // get uid
  let uid = req.params.uid;
  if(!uid || uid === '') {
    return resp.status(500).json({ 'error': 'uid is required' });
  }
  // get role
  let role = RtmRole.Rtm_User;
   // get the expire time
  let expireTime = req.query.expiry;
  if (!expireTime || expireTime === '') {
    expireTime = 3600;
  } else {
    expireTime = parseInt(expireTime, 10);
  }
  // calculate privilege expire time
  const currentTime = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTime + expireTime;
  // build the token
  console.log(APP_ID, APP_CERTIFICATE, uid, role, privilegeExpireTime)
  const token = RtmTokenBuilder.buildToken(APP_ID, APP_CERTIFICATE, uid, role, privilegeExpireTime);
  // return the token
  return resp.json({ 'rtmToken': token });
}

const generateRTEToken = (req, resp) => {
  // set response header
  resp.header('Access-Control-Allow-Origin', '*');
  // get channel name
  const channelName = req.params.channel;
  if (!channelName) {
    return resp.status(500).json({ 'error': 'channel is required' });
  }
  // get uid
  let uid = req.params.uid;
  if(!uid || uid === '') {
    return resp.status(500).json({ 'error': 'uid is required' });
  }
  // get role
  let role;
  if (req.params.role === 'publisher') {
    role = RtcRole.PUBLISHER;
  } else if (req.params.role === 'audience') {
    role = RtcRole.SUBSCRIBER
  } else {
    return resp.status(500).json({ 'error': 'role is incorrect' });
  }
  // get the expire time
  let expireTime = req.query.expiry;
  if (!expireTime || expireTime === '') {
    expireTime = 3600;
  } else {
    expireTime = parseInt(expireTime, 10);
  }
  // calculate privilege expire time
  const currentTime = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTime + expireTime;
  // build the token
  const rtcToken = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpireTime);
  const rtmToken = RtmTokenBuilder.buildToken(APP_ID, APP_CERTIFICATE, uid, role, privilegeExpireTime);
  // return the token
  return resp.json({ 'rtcToken': rtcToken, 'rtmToken': rtmToken });
}

// ===== Endpoint baru: kirim push notification (FCM) ke satu user =====
// Body request (JSON):
// {
//   "targetUid": "uid tujuan di Firebase",
//   "type": "message" atau "call",
//   "title": "judul notifikasi",
//   "body": "isi notifikasi",
//   "data": { ...field tambahan bebas, misal roomId/channelName/fromName... }
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
  if (!type || (type !== 'message' && type !== 'call')) {
    return resp.status(400).json({ 'error': 'type harus "message" atau "call"' });
  }

  try {
    // Ambil fcmToken milik targetUid dari Realtime Database
    const snapshot = await admin.database()
      .ref(`users/${targetUid}/fcmToken`)
      .get();

    const fcmToken = snapshot.val();
    if (!fcmToken) {
      return resp.status(404).json({ 'error': 'targetUid tidak punya fcmToken (belum login/belum generate token)' });
    }

    // Kirim sebagai DATA MESSAGE (bukan notification message bawaan FCM),
    // supaya Android yang mengontrol penuh tampilan notifikasi -- termasuk
    // nanti untuk full-screen incoming call. Semua value di "data" HARUS
    // berupa string (syarat FCM data message).
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

    const response = await admin.messaging().send(messagePayload);
    return resp.json({ 'success': true, 'messageId': response });
  } catch (e) {
    console.error('Gagal mengirim notifikasi:', e);
    return resp.status(500).json({ 'error': e.message });
  }
}

app.options('*', cors());
app.get('/ping', nocache, ping)
app.get('/rtc/:channel/:role/:tokentype/:uid', nocache , generateRTCToken);
app.get('/rtm/:uid/', nocache , generateRTMToken);
app.get('/rte/:channel/:role/:tokentype/:uid', nocache , generateRTEToken);
app.post('/send-notification', cors(), sendNotification);

app.listen(PORT, () => {
  console.log(`Listening on port: ${PORT}`);
});
