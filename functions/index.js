const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret }       = require('firebase-functions/params');
const admin = require('firebase-admin');
const Omise = require('omise');

admin.initializeApp();
const db = admin.firestore();

const OMISE_SECRET  = defineSecret('OMISE_SECRET_KEY');
const OMISE_PUBLIC  = defineSecret('OMISE_PUBLIC_KEY');
const OMISE_WEBHOOK = defineSecret('OMISE_WEBHOOK_SECRET');

// ══════════════════════════════════════════════════════════════
// createCharge — ล็อกเงิน Escrow
// ══════════════════════════════════════════════════════════════
exports.createCharge = onCall(
  { region: 'asia-southeast1', secrets: [OMISE_SECRET, OMISE_PUBLIC], cors: ['https://tidjaii.web.app','https://tidjaii.pages.dev'] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบก่อน');

    const { jobId, token } = request.data;
    if (!jobId || !token) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');

    const jobRef  = db.collection('jobs').doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) throw new HttpsError('not-found', 'ไม่พบงานนี้');

    const job = jobSnap.data();
    if (job.ownerId !== request.auth.uid) throw new HttpsError('permission-denied', 'ไม่ใช่เจ้าของงาน');
    if (job.escrow_status === 'locked')   throw new HttpsError('already-exists', 'ชำระเงินไปแล้ว');

    // ดึง amount จาก Firestore เท่านั้น — ไม่รับจาก client เพื่อป้องกันการแก้ราคา
    const amount = job.agreedPrice || job.escrow_amount;
    if (!amount || amount <= 0) throw new HttpsError('failed-precondition', 'ไม่พบราคาที่ตกลง');

    const omise = Omise({ secretKey: OMISE_SECRET.value(), omiseVersion: '2019-05-29' });

    try {
      const charge = await omise.charges.create({
        amount:      Math.round(amount * 100),
        currency:    'thb',
        card:        token,
        description: `Tidjaii Escrow - Job ${jobId}`,
        metadata:    { job_id: jobId, owner_id: request.auth.uid, from: job.fromName||'', to: job.toName||'' },
        capture:     true
      });

      if (charge.status !== 'successful') {
        throw new HttpsError('aborted', 'การชำระเงินไม่สำเร็จ: ' + charge.failure_message);
      }

      await jobRef.update({
        escrow_status:    'locked',
        escrow_charge_id: charge.id,
        escrow_amount:    amount,
        escrow_locked_at: admin.firestore.FieldValue.serverTimestamp()
      });

      return { success: true, charge_id: charge.id, amount };

    } catch (err) {
      console.error('Omise charge error:', err);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err.message || 'เกิดข้อผิดพลาด');
    }
  }
);

// ══════════════════════════════════════════════════════════════
// releaseEscrow — ปลดล็อกเงินหลังส่งสำเร็จ
// ══════════════════════════════════════════════════════════════
exports.releaseEscrow = onCall(
  { region: 'asia-southeast1', secrets: [OMISE_SECRET], cors: ['https://tidjaii.web.app','https://tidjaii.pages.dev'] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบก่อน');

    const { jobId } = request.data;
    const jobRef  = db.collection('jobs').doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) throw new HttpsError('not-found', 'ไม่พบงาน');

    const job      = jobSnap.data();
    const isOwner  = job.ownerId === request.auth.uid;
    const isDriver = job.matchedDriver && job.matchedDriver.driverId === request.auth.uid;
    if (!isOwner && !isDriver) throw new HttpsError('permission-denied', 'ไม่มีสิทธิ์');
    if (job.escrow_status !== 'locked') throw new HttpsError('failed-precondition', 'ยังไม่ได้ล็อกเงิน');
    // ตรวจสถานะ job — ต้องอยู่ใน matched หรือ delivering เท่านั้น
    const allowedStatus = ['matched', 'delivering', 'delivered'];
    if (!allowedStatus.includes(job.status)) throw new HttpsError('failed-precondition', 'สถานะงานไม่อนุญาตให้ปลดล็อกเงิน');

    const fare        = job.matchedDriver ? job.matchedDriver.price : 0;
    const platformFee = Math.ceil(fare * 0.10);
    const driverNet   = fare - platformFee;

    await jobRef.update({
      status:             'delivered',
      escrow_status:      'released',
      escrow_released_at: admin.firestore.FieldValue.serverTimestamp(),
      driver_net_amount:  driverNet,
      platform_revenue:   platformFee * 2
    });

    if (job.matchedDriver && job.matchedDriver.driverId) {
      await db.collection('users').doc(job.matchedDriver.driverId).update({
        bal:  admin.firestore.FieldValue.increment(driverNet),
        jobs: admin.firestore.FieldValue.increment(1),
        hist: admin.firestore.FieldValue.arrayUnion({
          t: 'รับเงินค่าขนส่ง', amt: driverNet, job: jobId,
          d: new Date().toLocaleDateString('th-TH')
        })
      });
    }

    return { success: true, driver_net: driverNet };
  }
);

// ══════════════════════════════════════════════════════════════
// refundCharge — คืนเงินเมื่อยกเลิก
// ══════════════════════════════════════════════════════════════
exports.refundCharge = onCall(
  { region: 'asia-southeast1', secrets: [OMISE_SECRET], cors: ['https://tidjaii.web.app','https://tidjaii.pages.dev'] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบก่อน');

    const { jobId } = request.data;
    const jobRef  = db.collection('jobs').doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) throw new HttpsError('not-found', 'ไม่พบงาน');

    const job = jobSnap.data();
    if (job.ownerId !== request.auth.uid) throw new HttpsError('permission-denied', 'ไม่มีสิทธิ์');
    if (!job.escrow_charge_id) throw new HttpsError('failed-precondition', 'ไม่มี Charge ID');

    const cancelFee    = job.status === 'matched' ? Math.ceil(job.escrow_amount * 0.10) : 0;
    const refundAmount = job.escrow_amount - cancelFee;

    const omise = Omise({ secretKey: OMISE_SECRET.value(), omiseVersion: '2019-05-29' });

    try {
      await omise.charges.createRefund(job.escrow_charge_id, {
        amount: Math.round(refundAmount * 100)
      });

      await jobRef.update({
        status:        'cancelled',
        escrow_status: 'refunded',
        cancel_fee:    cancelFee,
        refund_amount: refundAmount,
        cancelled_at:  admin.firestore.FieldValue.serverTimestamp()
      });

      return { success: true, refund_amount: refundAmount, cancel_fee: cancelFee };
    } catch (err) {
      throw new HttpsError('internal', err.message);
    }
  }
);

// ══════════════════════════════════════════════════════════════
// createWalletDeposit — สร้าง QR PromptPay สำหรับฝากเงิน Wallet
// ใช้ onRequest เพราะ driver/sender session อาจหมดหลัง OTP signOut
// ══════════════════════════════════════════════════════════════
exports.createWalletDeposit = onRequest(
  { region: 'asia-southeast1', secrets: [OMISE_SECRET, OMISE_PUBLIC], cors: ['https://tidjaii.web.app','https://tidjaii.pages.dev'] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
    const { uid, idToken, amount } = body || {};

    // ตรวจ Firebase ID Token
    if (!idToken) { res.status(401).json({ error: 'ไม่มี ID Token' }); return; }
    let verifiedUid;
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      verifiedUid = decoded.uid;
    } catch(e) { res.status(401).json({ error: 'Token ไม่ถูกต้อง' }); return; }

    if (!uid || uid !== verifiedUid) { res.status(403).json({ error: 'uid ไม่ตรงกับ Token' }); return; }
    if (!amount || amount < 20) { res.status(400).json({ error: 'ยอดฝากขั้นต่ำ ฿20' }); return; }
    const omise = Omise({ secretKey: OMISE_SECRET.value(), omiseVersion: '2019-05-29' });

    try {
      // สร้าง Charge ด้วย PromptPay โดยตรง (ไม่ต้องสร้าง source แยก)
      const charge = await omise.charges.create({
        amount:      Math.round(amount * 100),
        currency:    'thb',
        source:      { type: 'promptpay' },
        description: `Tidjaii Wallet Deposit - ${uid}`,
        metadata:    { uid, type: 'wallet_deposit', amount },
        return_uri:  'https://tidjaii.web.app'
      });

      console.log('Charge created:', JSON.stringify({
        id: charge.id,
        status: charge.status,
        source_type: charge.source && charge.source.type,
        scannable: charge.source && charge.source.scannable_code ? 'yes' : 'no'
      }));

      // ดึง QR image URL
      const qrImage = charge.source
        && charge.source.scannable_code
        && charge.source.scannable_code.image
        ? charge.source.scannable_code.image.download_uri
        : null;

      // บันทึก pending deposit ใน Firestore
      await db.collection('wallet_deposits').doc(charge.id).set({
        uid,
        amount,
        charge_id:  charge.id,
        status:     'pending',
        qr_image:   qrImage,
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });

      res.json({ success: true, charge_id: charge.id, qr_image: qrImage, amount });

    } catch(err) {
      console.error('createWalletDeposit error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// omiseWebhook — รับ event จาก Omise แล้วเติมเงิน Wallet
// ══════════════════════════════════════════════════════════════
exports.omiseWebhook = onRequest(
  { region: 'asia-southeast1', secrets: [OMISE_WEBHOOK] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    // ตรวจลายเซ็น Webhook
    const crypto = require('crypto');
    const secret = OMISE_WEBHOOK.value();
    if (secret) {
      const sig  = req.headers['omise-signature'] || '';
      const body = JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
      if (sig !== expected) {
        console.warn('Webhook signature mismatch');
        res.status(401).send('Invalid signature');
        return;
      }
    }

    const event = req.body;
    // รับเฉพาะ charge.complete ที่เป็น wallet_deposit
    if (event.key !== 'charge.complete') { res.json({ received: true }); return; }

    const charge = event.data;
    if (!charge || charge.status !== 'successful') { res.json({ received: true }); return; }

    try {
      const depositRef  = db.collection('wallet_deposits').doc(charge.id);
      const depositSnap = await depositRef.get();
      if (!depositSnap.exists) { res.json({ received: true }); return; }

      const deposit = depositSnap.data();
      if (deposit.status === 'paid') { res.json({ received: true }); return; } // ป้องกัน duplicate

      const amount = deposit.amount;
      const uid    = deposit.uid;

      // อัปเดต deposit status
      await depositRef.update({ status: 'paid', paid_at: admin.firestore.FieldValue.serverTimestamp() });

      // เติมเงินใน Firestore user
      await db.collection('users').doc(uid).update({
        bal:  admin.firestore.FieldValue.increment(amount),
        hist: admin.firestore.FieldValue.arrayUnion({
          t: 'ฝากเงิน QR PromptPay',
          amt: amount,
          d:   new Date().toLocaleDateString('th-TH')
        })
      });

      console.log('Wallet topped up:', uid, amount);
      res.json({ received: true });
    } catch(e) {
      console.error('omiseWebhook error:', e);
      res.status(500).json({ error: e.message });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// createUserProfile — สร้าง Firestore user document
// ใช้ onRequest เพราะ phone session signOut ก่อน doReg() ทำให้ onCall 401
// ══════════════════════════════════════════════════════════════
exports.createUserProfile = onRequest(
  { region: 'asia-southeast1', cors: ['https://tidjaii.web.app','https://tidjaii.pages.dev'] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    // parse body ถ้า Content-Type เป็น application/json
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }

    const { uid, userData, idToken } = body || {};

    // ตรวจ Firebase ID Token — ป้องกันใครก็ได้เขียนทับ user document
    if (!idToken) {
      res.status(401).json({ error: 'ไม่มี ID Token' }); return;
    }
    let verifiedUid;
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      verifiedUid = decoded.uid;
    } catch(e) {
      res.status(401).json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ' }); return;
    }

    // uid ที่ส่งมาต้องตรงกับ token
    if (!uid || uid !== verifiedUid) {
      res.status(403).json({ error: 'uid ไม่ตรงกับ Token' }); return;
    }
    if (!userData || !userData.name) {
      res.status(400).json({ error: 'ข้อมูลไม่ครบ' }); return;
    }

    try {
      // ตรวจว่ามีบัญชีอยู่แล้วหรือยัง
      const existing = await db.collection('users').doc(uid).get();
      if (existing.exists) {
        res.json({ success: true, existed: true }); return;
      }

      // เพิ่ม uid และ timestamp
      const profile = Object.assign({}, userData, {
        uid:       uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      await db.collection('users').doc(uid).set(profile);
      res.json({ success: true, existed: false });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  }
);
