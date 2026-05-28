/**
 * calculateAuctionBasePrice + validateBid
 * ─────────────────────────────────────────────────────────────
 * ไฟล์นี้มี 2 Pure Functions:
 *
 *  1. calculateAuctionBasePrice(...)
 *     → คำนวณ Ceiling Price (ราคากลาง/เพดานประมูล)
 *
 *  2. validateBid(bidPrice, ceilingPrice, currentLowestBid, vehicleType)
 *     → ตรวจสอบว่าราคาที่คนขับเสนอ "ผ่าน" กฎ Ceiling หรือไม่
 *
 * ─────────────────────────────────────────────────────────────
 * กฎ Ceiling Price:
 *   - คนขับเสนอราคาได้ไม่เกิน ceilingPrice เด็ดขาด
 *   - ถ้าเป็นการเสนอแรก: bid <= ceiling
 *   - ถ้ามี bid อื่นอยู่แล้ว: bid < currentLowestBid (ต้องต่ำกว่าต่ำสุดที่มี)
 *   - ราคาขั้นต่ำสุด: 200 บาท (ทุกประเภทรถ)
 * ─────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────
// FUNCTION 1: คำนวณ Ceiling Price
// ─────────────────────────────────────────────────────────────

/**
 * @param {string}  vehicleType     '4wheel' | '6wheel' | '10wheel'
 * @param {number}  distanceKm      ระยะทางรวม (กม.)
 * @param {boolean} isCongestedZone true = พื้นที่รถติด (+15%)
 * @param {boolean} isNightTime     true = 22:00–05:00 น. (+10%)
 * @param {number}  fuelPrice       ราคาดีเซล (บาท/ลิตร)
 *
 * @returns {{ ceilingPrice: number, breakdown: object }}
 */
function calculateAuctionBasePrice(
  vehicleType,
  distanceKm,
  isCongestedZone,
  isNightTime,
  fuelPrice
) {
  // ── Validate ───────────────────────────────────────────────
  var VALID_TYPES = ['4wheel', '6wheel', '10wheel'];
  if (VALID_TYPES.indexOf(vehicleType) < 0) {
    throw new Error(
      'vehicleType "' + vehicleType + '" ไม่ถูกต้อง ต้องเป็น 4wheel | 6wheel | 10wheel'
    );
  }
  if (typeof distanceKm !== 'number' || distanceKm < 0) {
    throw new Error('distanceKm ต้องเป็นตัวเลข >= 0');
  }
  if (typeof fuelPrice !== 'number' || fuelPrice <= 0) {
    throw new Error('fuelPrice ต้องเป็นตัวเลข > 0');
  }

  // ── Base Config ────────────────────────────────────────────
  var CONFIG = {
    '4wheel':  { label: 'รถ 4 ล้อ',  baseService: 300,  ratePerKm: 12, kmPerLiter: 10 },
    '6wheel':  { label: 'รถ 6 ล้อ',  baseService: 2000, ratePerKm: 18, kmPerLiter: 6  },
    '10wheel': { label: 'รถ 10 ล้อ', baseService: 3500, ratePerKm: 25, kmPerLiter: 4  }
  };
  var cfg = CONFIG[vehicleType];

  // ── คำนวณ ──────────────────────────────────────────────────
  // A. ราคาฐานตามระยะทาง
  var baseDistancePrice = cfg.baseService + (distanceKm * cfg.ratePerKm);

  // B. ค่าน้ำมันแปรผันตามระยะทาง
  var fuelCost = (distanceKm / cfg.kmPerLiter) * fuelPrice;

  // C. รวมขั้นต้น
  var subtotal = baseDistancePrice + fuelCost;

  // D. ตัวคูณสภาวะแวดล้อม
  var congestedMultiplier = isCongestedZone ? 1.15 : 1.00;
  var nightMultiplier     = isNightTime     ? 1.10 : 1.00;
  var afterCongested      = subtotal * congestedMultiplier;
  var afterNight          = afterCongested * nightMultiplier;

  // E. ปัดเศษ
  var ceilingPrice = Math.round(afterNight);

  // ── Return ─────────────────────────────────────────────────
  return {
    ceilingPrice: ceilingPrice,       // ← เพดานประมูล คนขับเสนอได้ไม่เกินนี้
    breakdown: {
      vehicleType:         vehicleType,
      vehicleLabel:        cfg.label,
      distanceKm:          distanceKm,
      fuelPrice:           fuelPrice,
      isCongestedZone:     isCongestedZone,
      isNightTime:         isNightTime,
      baseService:         cfg.baseService,
      baseDistancePrice:   Math.round(baseDistancePrice * 100) / 100,
      fuelCost:            Math.round(fuelCost * 100) / 100,
      subtotal:            Math.round(subtotal * 100) / 100,
      congestedMultiplier: congestedMultiplier,
      nightMultiplier:     nightMultiplier,
      ceilingPrice:        ceilingPrice
    }
  };
}


// ─────────────────────────────────────────────────────────────
// FUNCTION 2: ตรวจสอบราคาที่คนขับเสนอ vs Ceiling
// ─────────────────────────────────────────────────────────────

/**
 * @param {number}      bidPrice         ราคาที่คนขับต้องการเสนอ (บาท)
 * @param {number}      ceilingPrice     เพดานประมูล จาก calculateAuctionBasePrice
 * @param {number|null} currentLowestBid ราคาต่ำสุดที่มีอยู่แล้ว (null = ยังไม่มีใครเสนอ)
 * @param {string}      vehicleType      '4wheel' | '6wheel' | '10wheel'
 *
 * @returns {{ valid: boolean, reason: string, maxAllowed: number }}
 *   valid      — true = เสนอได้, false = เสนอไม่ได้
 *   reason     — ข้อความอธิบาย (แสดงให้คนขับเห็น)
 *   maxAllowed — ราคาสูงสุดที่เสนอได้ ณ ขณะนี้
 */
function validateBid(bidPrice, ceilingPrice, currentLowestBid, vehicleType) {

  var MIN_PRICE = 200; // ราคาต่ำสุดทุกประเภทรถ

  // ── กำหนด maxAllowed ───────────────────────────────────────
  // ถ้ายังไม่มีใครเสนอ → เสนอได้ถึง ceilingPrice
  // ถ้ามีคนเสนอแล้ว    → ต้องต่ำกว่า currentLowestBid อย่างน้อย 1 บาท
  var maxAllowed = (currentLowestBid === null || currentLowestBid === undefined)
    ? ceilingPrice
    : currentLowestBid - 1;

  // ── ตรวจสอบเงื่อนไข ────────────────────────────────────────

  // 1. ต้องเป็นตัวเลข
  if (typeof bidPrice !== 'number' || isNaN(bidPrice)) {
    return {
      valid:      false,
      reason:     'กรุณากรอกราคาเป็นตัวเลข',
      maxAllowed: maxAllowed
    };
  }

  // 2. ต้องไม่ต่ำกว่าราคาขั้นต่ำ
  if (bidPrice < MIN_PRICE) {
    return {
      valid:      false,
      reason:     'ราคาต่ำสุดที่เสนอได้คือ ฿' + MIN_PRICE,
      maxAllowed: maxAllowed
    };
  }

  // 3. ต้องไม่เกิน Ceiling Price
  if (bidPrice > ceilingPrice) {
    return {
      valid:      false,
      reason:     'ราคาเกินเพดานประมูล (Ceiling ฿' + ceilingPrice + ') — เสนอได้ไม่เกิน ฿' + ceilingPrice,
      maxAllowed: maxAllowed
    };
  }

  // 4. ถ้ามี bid อยู่แล้ว ต้องต่ำกว่า currentLowestBid
  if (currentLowestBid !== null && currentLowestBid !== undefined) {
    if (bidPrice >= currentLowestBid) {
      return {
        valid:      false,
        reason:     'ต้องเสนอต่ำกว่าราคาต่ำสุดที่มีอยู่ (฿' + currentLowestBid + ') — เสนอได้ไม่เกิน ฿' + maxAllowed,
        maxAllowed: maxAllowed
      };
    }
  }

  // ── ผ่านทุกเงื่อนไข ────────────────────────────────────────
  return {
    valid:      true,
    reason:     'ราคา ฿' + bidPrice + ' ผ่าน — ต่ำกว่าเพดาน ฿' + ceilingPrice + ' และถูกต้องตามกฎประมูล',
    maxAllowed: maxAllowed
  };
}


// ─────────────────────────────────────────────────────────────
// TESTS — ลบออกก่อนนำไปใช้งานจริง
// ─────────────────────────────────────────────────────────────
(function runTests() {
  var PASS = 0, FAIL = 0;

  function assert(label, actual, expected) {
    if (actual === expected) {
      console.log('✅ ' + label + ' → ' + actual);
      PASS++;
    } else {
      console.error('❌ ' + label + ' | expected=' + expected + ' got=' + actual);
      FAIL++;
    }
  }

  console.log('\n══ calculateAuctionBasePrice (Ceiling) ══════════════');

  // TC1: 4wheel, 50km, ปกติ, น้ำมัน 33
  // base=900, fuel=165, sub=1065, x1 x1 → ceiling=1065
  var r1 = calculateAuctionBasePrice('4wheel', 50, false, false, 33);
  assert('TC1 ceiling', r1.ceilingPrice, 1065);

  // TC2: 6wheel, 100km, ติด, น้ำมัน 34
  // base=3800, fuel=566.67, sub=4366.67 x1.15 → ceiling=5022
  var r2 = calculateAuctionBasePrice('6wheel', 100, true, false, 34);
  assert('TC2 ceiling', r2.ceilingPrice, 5022);

  // TC3: 10wheel, 200km, กลางคืน, น้ำมัน 35
  // base=8500, fuel=1750, sub=10250 x1.10 → ceiling=11275
  var r3 = calculateAuctionBasePrice('10wheel', 200, false, true, 35);
  assert('TC3 ceiling', r3.ceilingPrice, 11275);

  // TC4: 6wheel, 80km, ติด+กลางคืน, น้ำมัน 33.5
  // base=3440, fuel=446.67, sub=3886.67 x1.15 x1.10 → ceiling=4917
  var r4 = calculateAuctionBasePrice('6wheel', 80, true, true, 33.5);
  assert('TC4 ceiling ติด+กลางคืน', r4.ceilingPrice, 4917);

  console.log('\n══ validateBid (Ceiling Guard) ══════════════════════');
  var CEILING = r1.ceilingPrice; // 1065

  // TC5: เสนอครั้งแรก ต่ำกว่า ceiling → ผ่าน
  var v1 = validateBid(1000, CEILING, null, '4wheel');
  assert('TC5 bid แรก ต่ำกว่า ceiling', v1.valid, true);

  // TC6: เสนอครั้งแรก เท่ากับ ceiling → ผ่าน (ceiling คือราคาสูงสุดที่เสนอได้)
  var v2 = validateBid(1065, CEILING, null, '4wheel');
  assert('TC6 bid แรก = ceiling', v2.valid, true);

  // TC7: เสนอครั้งแรก เกิน ceiling → ไม่ผ่าน
  var v3 = validateBid(1200, CEILING, null, '4wheel');
  assert('TC7 bid เกิน ceiling', v3.valid, false);

  // TC8: มี lowest bid อยู่แล้ว 900 → เสนอ 850 ผ่าน
  var v4 = validateBid(850, CEILING, 900, '4wheel');
  assert('TC8 bid < lowestBid', v4.valid, true);

  // TC9: มี lowest bid 900 → เสนอ 900 ไม่ผ่าน (ต้องต่ำกว่า)
  var v5 = validateBid(900, CEILING, 900, '4wheel');
  assert('TC9 bid = lowestBid', v5.valid, false);

  // TC10: เสนอต่ำกว่า 200 → ไม่ผ่าน
  var v6 = validateBid(150, CEILING, null, '4wheel');
  assert('TC10 bid < 200', v6.valid, false);

  console.log('\n─────────────────────────────────────────────────────');
  console.log('ผลรวม: ' + PASS + ' passed, ' + FAIL + ' failed');

  console.log('\n📋 Breakdown TC4 (6wheel, 80km, ติด+กลางคืน, ฿33.5):');
  console.log(JSON.stringify(r4.breakdown, null, 2));

  console.log('\n📋 validateBid TC7 (เกิน ceiling):');
  console.log(JSON.stringify(validateBid(1200, 1065, null, '4wheel'), null, 2));
})();
