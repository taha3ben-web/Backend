import assert from "node:assert/strict";
import { round2, roundMoney } from "../src/common/money.util";
import {
  haversineKm,
  estimateDurationSec,
} from "../src/modules/matching/geo.util";
import { computeFare } from "../src/modules/matching/pricing.util";
import { computeSettlement } from "../src/modules/trips/settlement.util";
import {
  canTransition,
  TRANSITIONS,
} from "../src/modules/trips/trip-transitions";

let passed = 0;
function test(name: string, run: () => void) {
  try {
    run();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    throw error;
  }
}

test("التقريب المالي يعالج أنصاف السنت", () => {
  assert.equal(round2(292.675), 292.68);
  assert.equal(roundMoney(10.555, 2), 10.56);
});

test("حساب المسافة متسق ومتناظر", () => {
  const a = haversineKm(36.7538, 3.0588, 35.6971, -0.6331);
  const b = haversineKm(35.6971, -0.6331, 36.7538, 3.0588);
  assert.ok(a > 340 && a < 360);
  assert.ok(Math.abs(a - b) < 1e-9);
  assert.equal(estimateDurationSec(28), 3600);
});

test("محرك الأجرة يطبق الذروة والحدود", () => {
  const rule = {
    baseFare: 50,
    perKm: 20,
    perMin: 3,
    minFare: 100,
    maxFare: 500,
  };
  assert.equal(computeFare(rule, 10, 1200, 1).fare, 310);
  assert.equal(computeFare(rule, 10, 1200, 1.5).fare, 465);
  assert.equal(computeFare(rule, 100, 7200, 1).fare, 500);
});

test("التسوية تحفظ معادلة الإجمالي", () => {
  const result = computeSettlement(333.33, 0.15);
  assert.deepEqual(result, { gross: 333.33, commission: 50, net: 283.33 });
  assert.equal(round2(result.commission + result.net), result.gross);
});

test("دورة الرحلة تمنع القفز وإحياء الحالات النهائية", () => {
  assert.equal(canTransition("SEARCHING", "ACCEPTED"), true);
  assert.equal(canTransition("ACCEPTED", "ARRIVING"), true);
  assert.equal(canTransition("ARRIVING", "IN_PROGRESS"), true);
  assert.equal(canTransition("IN_PROGRESS", "COMPLETED"), true);
  assert.equal(canTransition("SEARCHING", "COMPLETED"), false);
  assert.equal(canTransition("COMPLETED", "ACCEPTED"), false);
  assert.equal(TRANSITIONS.CANCELLED.length, 0);
});

console.log(`\nنجحت ${passed} مجموعات اختبار منطقية.`);
