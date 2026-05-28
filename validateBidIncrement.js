/**
 * validateBidIncrement
 * ═══════════════════════════════════════════════════════════════
 * Pure Function — ตรวจสอบการเคาะราคาประมูลขนส่ง
 * ป้องกัน: ฮั้วประมูล / ตัดราคาก่อกวน / เคาะต่ำกว่าเกณฑ์
 *
 * Logic สรุปเป็นข้อ:
 * ──────────────────────────────────────────────────────────────
 * 1. รับ input 3 ตัว: currentPrice, newBidPrice, vehicleType
 * 2. กำหนด Minimum Increment ตามประเภทพาหนะ
 *      - truck (รถบรรทุกทุกชนิด) → ลดอย่างน้อย 100 บาท
 *      - rider (ไรเดอร์/มอเตอร์ไซค์) → ลดอย่างน้อย 10 บาท
 * 3. คำนวณ: requiredDrop = currentPrice - newBidPrice
 *      - ถ้า requiredDrop < minIncrement → ปฏิเสธ + แจ้ง error
 *      - ถ้า newBidPrice >= currentPrice → ปฏิเสธ (ต้องต่ำกว่าเสมอ)
 *      - ถ้า newBidPrice < MIN_ABSOLUTE (200) → ปฏิเสธ
 *      - ผ่านทุกเงื่อนไข → อนุมัติ
 * 4. Return object: { valid, reason, minRequired, maxAllowed }
 *      - valid      : true/false
 *      - reason     : ข้อความแจ้งเตือน (แสดงใน Notification)
 *      - minRequired: ราคาต่ำสุดที่เสนอได้ (= currentPrice - minIncrement)
 *      - maxAllowed : ราคาสูงสุดที่เสนอได้ (= currentPrice - 1)
 * ═══════════════════════════════════════════════════════════════
 *
 * @param {number} currentPrice   ราคาล่าสุดในระบบ (บาท)
 * @param {number} newBidPrice    ราคาที่ผู้ขับต้องการเสนอ (บาท)
 * @param {string} vehicleType    'truck' | 'rider'
 *
 * @returns {{ valid, reason, minRequired, maxAllowed, increment }}
 */
function validateBidIncrement(currentPrice, newBidPrice, vehicleType) {

  // ── 1. Minimum Increment Config ───────────────────────────
  var INCREMENT_MAP = {
    truck: 100,   // รถบรรทุกทุกชนิด: ลดขั้นต่ำ 100 บาท/ครั้ง
    rider: 10     // ไรเดอร์/มอเตอร์ไซค์: ลดขั้นต่ำ 10 บาท/ครั้ง
  };

  var MIN_ABSOLUTE = 200; // ราคาต่ำสุดสัมบูรณ์ทุกประเภท (บาท)

  // ── 2. Validate vehicleType ───────────────────────────────
  var VALID_TYPES = ['truck', 'rider'];
  if (VALID_TYPES.indexOf(vehicleType) < 0) {
    return {
      valid:       false,
      reason:      '❌ ประเภทพาหนะ "' + vehicleType + '" ไม่ถูกต้อง (ต้องเป็น truck หรือ rider)',
      minRequired: null,
      maxAllowed:  null,
      increment:   null
    };
  }

  var minIncrement = INCREMENT_MAP[vehicleType];
  var minRequired  = currentPrice - minIncrement; // ราคาต่ำสุดที่เสนอได้
  var maxAllowed   = currentPrice - 1;            // ต้องต่ำกว่าปัจจุบันเสมอ

  // ── 3. Validate input types ───────────────────────────────
  if (typeof newBidPrice !== 'number' || isNaN(newBidPrice)) {
    return {
      valid:       false,
      reason:      '❌ กรุณากรอกราคาเป็นตัวเลข',
      minRequired: minRequired,
      maxAllowed:  maxAllowed,
      increment:   minIncrement
    };
  }

  // ── 4. ต้องต่ำกว่าราคาปัจจุบัน ───────────────────────────
  if (newBidPrice >= currentPrice) {
    return {
      valid:       false,
      reason:      '❌ ราคาที่เสนอต้องต่ำกว่าราคาปัจจุบัน ฿' + currentPrice.toLocaleString('th-TH')
                 + ' (เสนอได้สูงสุด ฿' + maxAllowed.toLocaleString('th-TH') + ')',
      minRequired: minRequired,
      maxAllowed:  maxAllowed,
      increment:   minIncrement
    };
  }

  // ── 5. ตรวจ Minimum Increment ─────────────────────────────
  var actualDrop = currentPrice - newBidPrice;
  if (actualDrop < minIncrement) {
    var typeLabel = vehicleType === 'truck' ? 'รถบรรทุก' : 'ไรเดอร์';
    return {
      valid:       false,
      reason:      '❌ [' + typeLabel + '] ต้องลดราคาอย่างน้อย ฿' + minIncrement
                 + ' ต่อครั้ง — ราคาที่เสนอได้ไม่เกิน ฿' + maxAllowed.toLocaleString('th-TH')
                 + ' และไม่น้อยกว่า ฿' + minRequired.toLocaleString('th-TH')
                 + ' (ลดไปแค่ ฿' + actualDrop + ' ไม่ถึงเกณฑ์)',
      minRequired: minRequired,
      maxAllowed:  maxAllowed,
      increment:   minIncrement
    };
  }

  // ── 6. ตรวจราคาต่ำสุดสัมบูรณ์ ────────────────────────────
  if (newBidPrice < MIN_ABSOLUTE) {
    return {
      valid:       false,
      reason:      '❌ ราคาขั้นต่ำสุดของระบบคือ ฿' + MIN_ABSOLUTE
                 + ' (เสนอ ฿' + newBidPrice + ' ต่ำเกินไป)',
      minRequired: Math.max(minRequired, MIN_ABSOLUTE),
      maxAllowed:  maxAllowed,
      increment:   minIncrement
    };
  }

  // ── 7. ผ่านทุกเงื่อนไข → อนุมัติ ─────────────────────────
  return {
    valid:       true,
    reason:      '✅ ราคา ฿' + newBidPrice.toLocaleString('th-TH')
                + ' ผ่าน — ลดจากราคาปัจจุบัน ฿' + actualDrop
                + ' (เกณฑ์ขั้นต่ำ ฿' + minIncrement + ')',
    minRequired: minRequired,
    maxAllowed:  maxAllowed,
    increment:   minIncrement
  };
}


// ═══════════════════════════════════════════════════════════════
// ตัวอย่างการเชื่อมกับ Notification / Toast ในแอป
// ═══════════════════════════════════════════════════════════════
/**
 * ตัวอย่าง: เรียกใช้ใน placeBid() ก่อน submit Firestore
 *
 * function placeBid(jobId) {
 *   var price    = parseFloat(document.getElementById('bid-' + jobId).value);
 *   var jobType  = job.vehicleCategory; // 'truck' หรือ 'rider'
 *   var current  = job.currentLowestBid || job.ceiling_price;
 *
 *   var check = validateBidIncrement(current, price, jobType);
 *   if (!check.valid) {
 *     toast(check.reason, 'warn');   // แสดง Notification ทันที
 *     return;                        // หยุด — ไม่ส่งไป Firestore
 *   }
 *   // ผ่าน → บันทึก bid ได้
 *   fbDb.collection('jobs').doc(jobId).update({ ... });
 * }
 */


// ═══════════════════════════════════════════════════════════════
// TESTS — ลบออกก่อนนำไปใช้งานจริง
// ═══════════════════════════════════════════════════════════════
(function runTests() {
  var PASS = 0, FAIL = 0;

  function assert(label, actual, expected) {
    if (actual === expected) {
      console.log('✅ PASS | ' + label + ' → ' + actual);
      PASS++;
    } else {
      console.error('❌ FAIL | ' + label + ' | expected=' + expected + ' got=' + actual);
      FAIL++;
    }
  }

  console.log('\n══ TRUCK (ขั้นต่ำ 100 บาท) ════════════════════════');

  // TC1: truck, ลด 100 พอดี → ผ่าน
  var t1 = validateBidIncrement(5000, 4900, 'truck');
  assert('TC1 truck ลด 100 พอดี', t1.valid, true);

  // TC2: truck, ลด 150 → ผ่าน
  var t2 = validateBidIncrement(5000, 4850, 'truck');
  assert('TC2 truck ลด 150', t2.valid, true);

  // TC3: truck, ลด 99 → ไม่ผ่าน
  var t3 = validateBidIncrement(5000, 4901, 'truck');
  assert('TC3 truck ลด 99 (ต่ำกว่าเกณฑ์)', t3.valid, false);
  console.log('     reason:', t3.reason);

  // TC4: truck, เสนอเท่าเดิม → ไม่ผ่าน
  var t4 = validateBidIncrement(5000, 5000, 'truck');
  assert('TC4 truck เสนอเท่าราคาปัจจุบัน', t4.valid, false);

  // TC5: truck, เสนอสูงกว่า → ไม่ผ่าน
  var t5 = validateBidIncrement(5000, 5500, 'truck');
  assert('TC5 truck เสนอสูงกว่าปัจจุบัน', t5.valid, false);

  console.log('\n══ RIDER (ขั้นต่ำ 10 บาท) ════════════════════════');

  // TC6: rider, ลด 10 พอดี → ผ่าน
  var t6 = validateBidIncrement(300, 290, 'rider');
  assert('TC6 rider ลด 10 พอดี', t6.valid, true);

  // TC7: rider, ลด 9 → ไม่ผ่าน
  var t7 = validateBidIncrement(300, 291, 'rider');
  assert('TC7 rider ลด 9 (ต่ำกว่าเกณฑ์)', t7.valid, false);
  console.log('     reason:', t7.reason);

  // TC8: rider, ลด 50 → ผ่าน
  var t8 = validateBidIncrement(300, 250, 'rider');
  assert('TC8 rider ลด 50', t8.valid, true);

  console.log('\n══ EDGE CASES ══════════════════════════════════════');

  // TC9: ราคาหลังลดต่ำกว่า 200 → ไม่ผ่าน
  var t9 = validateBidIncrement(300, 150, 'rider');
  assert('TC9 ราคาต่ำกว่า MIN_ABSOLUTE 200', t9.valid, false);
  console.log('     reason:', t9.reason);

  // TC10: vehicleType ผิด → ไม่ผ่าน
  var t10 = validateBidIncrement(5000, 4800, 'bicycle');
  assert('TC10 vehicleType ผิด', t10.valid, false);

  // TC11: ราคาไม่ใช่ตัวเลข → ไม่ผ่าน
  var t11 = validateBidIncrement(5000, 'abc', 'truck');
  assert('TC11 newBidPrice ไม่ใช่ตัวเลข', t11.valid, false);

  console.log('\n─────────────────────────────────────────────────────');
  console.log('ผลรวม: ' + PASS + ' passed, ' + FAIL + ' failed');

  console.log('\n📋 ตัวอย่าง Notification ที่จะแสดงบนหน้าจอ:');
  console.log('TC3 (truck ลด 99):');
  console.log(' → ' + validateBidIncrement(5000, 4901, 'truck').reason);
  console.log('TC7 (rider ลด 9):');
  console.log(' → ' + validateBidIncrement(300, 291, 'rider').reason);
  console.log('TC1 (truck ลด 100 ผ่าน):');
  console.log(' → ' + validateBidIncrement(5000, 4900, 'truck').reason);
})();
