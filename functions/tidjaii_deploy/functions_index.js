const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret }       = require('firebase-functions/params');
const admin = require('firebase-admin');
const Omise = require('omise');

admin.initializeApp();
const db = admin.firestore();

const OMISE_SECRET = defineSecret('OMISE_SECRET_KEY');
const OMISE_PUBLIC = defineSecret('OMISE_PUBLIC_KEY');

// ══════════════════════════════════════════════════════════════
// createCharge — ล็อกเงิน Escrow
// ══════════════════════════════════════════════════════════════
exports.createCharge = onCall(
  { region: 'asia-southeast1', secrets: [OMISE_SECRET, OMISE_PUBLIC], cors: ['https://tidjaii.web.app','https://tidjaii.pages.dev'] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบก่อน');

    const { jobId, token, amount } = request.data;
    if (!jobId || !token || !amount) throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');

    const jobRef  = db.collection('jobs').doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) throw new HttpsError('not-found', 'ไม่พบงานนี้');

    const job = jobSnap.data();
    if (job.ownerId !== request.auth.uid) throw new HttpsError('permission-denied', 'ไม่ใช่เจ้าของงาน');
    if (job.escrow_status === 'locked')   throw new HttpsError('already-exists', 'ชำระเงินไปแล้ว');

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
// createUserProfile — สร้าง Firestore user document
// เรียกหลัง Phone OTP verified แทนการเขียนจาก client โดยตรง
// ══════════════════════════════════════════════════════════════
exports.createUserProfile = onCall(
  { region: 'asia-southeast1', cors: ['https://tidjaii.web.app','https://tidjaii.pages.dev'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'กรุณาเข้าสู่ระบบก่อน');
    }

    const uid      = request.auth.uid;
    const userData = request.data.userData;

    if (!userData || !userData.name) {
      throw new HttpsError('invalid-argument', 'ข้อมูลไม่ครบ');
    }

    // ตรวจว่ามีบัญชีอยู่แล้วหรือยัง
    const existing = await db.collection('users').doc(uid).get();
    if (existing.exists) {
      // มีแล้ว → return ข้อมูลเดิม
      return { success: true, existed: true, data: existing.data() };
    }

    // เพิ่ม uid และ timestamp
    const profile = Object.assign({}, userData, {
      uid:       uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await db.collection('users').doc(uid).set(profile);

    return { success: true, existed: false };
  }
);
