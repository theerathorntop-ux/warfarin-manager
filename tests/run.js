// Plain Node test runner for the pure logic modules - no framework/npm dependency by design,
// so tests can run on any machine with Node installed, matching the app's zero-build-tool philosophy.
// Usage: node tests/run.js
"use strict";

var assert = require('assert');
var TO = require('../js/tabletOptimizer.js');
var OPD = require('../js/opd.js');
var IPD = require('../js/ipd.js');
var BR = require('../js/bleedingRisk.js');

var passed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  ok - ' + name);
    } catch (e) {
        console.error('  FAIL - ' + name);
        console.error('    ' + e.message);
        process.exitCode = 1;
    }
}

function comboSum(comboArr) {
    return comboArr.reduce(function (sum, c) { return sum + c.d * c.qty; }, 0);
}

console.log('tabletOptimizer.js');
test('getBestCombo(21) sums to 21mg', function () {
    var res = TO.getBestCombo(21);
    assert.ok(res, 'expected a combo');
    assert.strictEqual(comboSum(res.combo), 21);
});
test('getBestCombo(17.5) sums to 17.5mg', function () {
    var res = TO.getBestCombo(17.5);
    assert.ok(res);
    assert.strictEqual(comboSum(res.combo), 17.5);
});
test('getBestCombo(0) returns zero-cost empty combo', function () {
    var res = TO.getBestCombo(0);
    assert.strictEqual(res.cost, 0);
});
test('getBestCombo(0.5) is unrepresentable (min tablet fragment is 1mg) -> null', function () {
    assert.strictEqual(TO.getBestCombo(0.5), null);
});
test('buildComboCache produces a single 5mg tablet for dose 5 (cost 1)', function () {
    var cache = TO.buildComboCache(0, 15);
    assert.strictEqual(cache[5].cost, 1);
});

console.log('opd.js: warfarinAdjustment()');
test('INR in target, no prior INR -> dose unchanged (factor 1.0)', function () {
    var data = OPD.warfarinAdjustment(21, 2.5, '2-3', NaN);
    assert.strictEqual(data.exactTargetS, 21);
    assert.ok(data.topPlans.length >= 1);
});
test('INR < 1.5 -> factor 1.20 (aggressive increase)', function () {
    var data = OPD.warfarinAdjustment(20, 1.2, '2-3', NaN);
    assert.strictEqual(data.exactTargetS, 24);
});
test('INR >= 4.5 -> factor 0.80 (aggressive decrease)', function () {
    var data = OPD.warfarinAdjustment(20, 5.0, '2-3', NaN);
    assert.strictEqual(data.exactTargetS, 16);
});
test('reference scenario: 21mg/wk, INR 4.2 -> factor 0.85 -> target ~17.85', function () {
    var data = OPD.warfarinAdjustment(21, 4.2, '2-3', NaN);
    assert.ok(Math.abs(data.exactTargetS - 17.85) < 1e-9, 'exactTargetS was ' + data.exactTargetS);
    var top = data.topPlans[0];
    assert.ok(Math.abs(top.weeklyTotal - 17.85) <= Math.max(17.85 * 0.15, 1.5));
});
test('rapid rise in INR (delta >= 0.8) triggers trend correction message', function () {
    var data = OPD.warfarinAdjustment(21, 3.5, '2-3', 2.6);
    assert.ok(data.trendMessage.length > 0);
});
test('rapid fall in INR (delta <= -0.8) triggers trend correction message', function () {
    var data = OPD.warfarinAdjustment(21, 2.0, '2-3', 3.0);
    assert.ok(data.trendMessage.length > 0);
});

console.log('opd.js: rapidFluctuationMessage() / isMinorDeviation()');
test('swing >= +1.5 -> interaction fluctuation message (was unreachable before)', function () {
    assert.ok(OPD.rapidFluctuationMessage(3.6, 2.0).indexOf('แกว่งขึ้น') !== -1);
});
test('swing <= -1.5 -> adherence fluctuation message', function () {
    assert.ok(OPD.rapidFluctuationMessage(1.4, 3.0).indexOf('แกว่งลง') !== -1);
});
test('swing of 1.0 or missing previous INR -> no fluctuation message', function () {
    assert.strictEqual(OPD.rapidFluctuationMessage(3.0, 2.0), '');
    assert.strictEqual(OPD.rapidFluctuationMessage(3.0, NaN), '');
});
test('isMinorDeviation uses the CHEST 0.5 margin: 1.5/3.5 minor for 2-3; 1.4/3.6/2.5 not', function () {
    assert.strictEqual(OPD.isMinorDeviation(1.5, 2.0, 3.0), true);
    assert.strictEqual(OPD.isMinorDeviation(3.5, 2.0, 3.0), true);
    assert.strictEqual(OPD.isMinorDeviation(1.4, 2.0, 3.0), false);
    assert.strictEqual(OPD.isMinorDeviation(3.6, 2.0, 3.0), false);
    assert.strictEqual(OPD.isMinorDeviation(2.5, 2.0, 3.0), false);
});
test('isMinorDeviation never overlaps a hold-level INR (4.0 for target 2.5-3.5)', function () {
    assert.strictEqual(OPD.isMinorDeviation(4.0, 2.5, 3.5), false);
    assert.strictEqual(OPD.isMinorDeviation(3.9, 2.5, 3.5), true);
});

console.log('opd.js: plan search guarantees');
test('every suggested plan moves the dose in the target direction (10-70 mg/wk, several INRs)', function () {
    for (var w = 10; w <= 70; w += 0.5) {
        [1.2, 1.7, 3.2, 3.8, 4.2, 5].forEach(function (inr) {
            var d = OPD.warfarinAdjustment(w, inr, '2-3', NaN);
            var dir = Math.sign(d.exactTargetS - w);
            d.topPlans.forEach(function (p) {
                assert.strictEqual(Math.sign(p.weeklyTotal - w), dir, 'w=' + w + ' INR=' + inr + ' plan ' + p.weeklyTotal);
            });
        });
    }
});
test('previously-bad case 12 mg/wk INR 3.2 no longer recommends "no change"', function () {
    var d = OPD.warfarinAdjustment(12, 3.2, '2-3', NaN);
    assert.ok(d.topPlans[0].weeklyTotal < 12);
});
test('primary plan lands within 5% (or 1 mg) of target for a typical 28 mg/wk, INR 1.8', function () {
    var d = OPD.warfarinAdjustment(28, 1.8, '2-3', NaN);
    assert.ok(Math.abs(d.topPlans[0].weeklyTotal - d.exactTargetS) <= Math.max(28 * 0.05, 1.0));
    assert.ok(typeof d.topPlans[0].percentChange === 'number');
});
test('3.5 mg floor never raises the dose when a reduction is needed', function () {
    var d = OPD.warfarinAdjustment(3, 5.0, '2-3', NaN);
    assert.ok(d.exactTargetS <= 3);
});

console.log('opd.js: trend correction');
test('INR in range + rapid rise -> message only, dose unchanged', function () {
    var d = OPD.warfarinAdjustment(28, 2.5, '2-3', 1.5);
    assert.strictEqual(d.exactTargetS, 28);
    assert.ok(d.trendMessage.length > 0);
});
test('low INR rising fast -> increase is dampened but still an increase', function () {
    var d = OPD.warfarinAdjustment(28, 1.8, '2-3', 0.9);
    assert.ok(d.exactTargetS > 28 && d.exactTargetS < 28 * 1.1);
});
test('high INR falling fast -> reduction is NOT weakened', function () {
    var withTrend = OPD.warfarinAdjustment(28, 4.6, '2-3', 6.5).exactTargetS;
    var noTrend = OPD.warfarinAdjustment(28, 4.6, '2-3', NaN).exactTargetS;
    assert.strictEqual(withTrend, noTrend);
});

console.log('opd.js: adjust current day-by-day regimen');
test('adjustCurrentRegimen changes few days, moderately, toward the target', function () {
    var d = OPD.warfarinAdjustment(21, 1.8, '2-3', NaN, [3, 3, 3, 3, 3, 3, 3]);
    var a = d.adjustedCurrent;
    assert.ok(a, 'expected an adjusted-current option');
    assert.ok(a.weeklyTotal > 21);
    assert.ok(a.changedDays.length <= 3);
    a.changedDays.forEach(function (i) { assert.ok(a.daily[i] - 3 <= 1); });
});
test('adjustCurrentRegimen not offered without a day-by-day regimen or when no change needed', function () {
    assert.strictEqual(OPD.warfarinAdjustment(21, 1.8, '2-3', NaN).adjustedCurrent, null);
    assert.strictEqual(OPD.warfarinAdjustment(21, 2.5, '2-3', NaN, [3, 3, 3, 3, 3, 3, 3]).adjustedCurrent, null);
});

console.log('opd.js: valve advisory');
test('mechanical valve + low INR -> bridging advisory; AF or in-range -> none', function () {
    assert.ok(OPD.valveLowInrMessage('valve_mitral', 2.0, 2.5).indexOf('bridging') !== -1);
    assert.strictEqual(OPD.valveLowInrMessage('af', 1.5, 2.0), '');
    assert.strictEqual(OPD.valveLowInrMessage('valve_aortic', 2.4, 2.0), '');
});

console.log('ipd.js: ipdDoseDecision()');
test('day 1, standard risk -> 5.0mg starting dose', function () {
    var r = IPD.ipdDoseDecision({ day: 1, inr: NaN, prevInr: NaN, isFrail: false, hasBledScore: 0, lowTarget: 2, highTarget: 3 });
    assert.strictEqual(r.doseText, 'ให้ยา 5 mg');
});
test('day 1, high bleeding risk -> 2.5mg starting dose', function () {
    var r = IPD.ipdDoseDecision({ day: 1, inr: NaN, prevInr: NaN, isFrail: true, hasBledScore: 4, lowTarget: 2, highTarget: 3 });
    assert.strictEqual(r.doseText, 'ให้ยา 2.5 mg');
});
test('day 3 with missing INR -> needsInr flag set', function () {
    var r = IPD.ipdDoseDecision({ day: 3, inr: NaN, prevInr: NaN, isFrail: false, hasBledScore: 0, lowTarget: 2, highTarget: 3 });
    assert.strictEqual(r.needsInr, true);
});
test('day 3-4, high bleeding risk + INR > 3.0 -> HOLD', function () {
    var r = IPD.ipdDoseDecision({ day: 3, inr: 3.5, prevInr: NaN, isFrail: true, hasBledScore: 4, lowTarget: 2, highTarget: 3 });
    assert.strictEqual(r.doseText, '🛑 HOLD ยา ทันที');
});
test('day 3-4, standard risk, INR < 1.5 -> continue 5.0mg', function () {
    var r = IPD.ipdDoseDecision({ day: 3, inr: 0.9, prevInr: NaN, isFrail: false, hasBledScore: 0, lowTarget: 2, highTarget: 3 });
    assert.strictEqual(r.doseText, '5.0 mg');
});
test('day 5+, INR within target -> maintenance, no change', function () {
    var r = IPD.ipdDoseDecision({ day: 5, inr: 2.5, prevInr: NaN, isFrail: false, hasBledScore: 0, lowTarget: 2, highTarget: 3 });
    assert.strictEqual(r.doseText, 'ใช้ขนาดยาเดิม (Maintenance)');
});
test('lowDoseStartReasons: sensitivity factor, INR-raising drug, or HAS-BLED >= 3 each trigger low start', function () {
    assert.deepStrictEqual(IPD.lowDoseStartReasons(0, [], []), []);
    assert.strictEqual(IPD.lowDoseStartReasons(0, ['อายุ > 75 ปี'], []).length, 1);
    assert.ok(IPD.lowDoseStartReasons(0, [], ['Amiodarone'])[0].indexOf('Amiodarone') !== -1);
    assert.strictEqual(IPD.lowDoseStartReasons(3, [], []).length, 1);
    assert.strictEqual(IPD.lowDoseStartReasons(2, [], []).length, 0);
});
test('day 1 low-dose note lists the actual reasons', function () {
    var r = IPD.ipdDoseDecision({ day: 1, inr: NaN, prevInr: NaN, isFrail: true, hasBledScore: 0, lowTarget: 2, highTarget: 3, lowDoseReasons: ['น้ำหนัก < 50 kg'] });
    assert.strictEqual(r.doseText, 'ให้ยา 2.5 mg');
    assert.ok(r.noteText.indexOf('น้ำหนัก < 50 kg') !== -1);
});

console.log('bleedingRisk.js: HAS-BLED');
test('computeScore sums one point per checked item', function () {
    assert.strictEqual(BR.computeScore(['hb_elderly', 'hb_htn']), 2);
});
test('isHighRisk true at score >= 3', function () {
    assert.strictEqual(BR.isHighRisk(3), true);
    assert.strictEqual(BR.isHighRisk(2), false);
});

console.log('\n' + passed + ' test(s) passed.');
if (process.exitCode) {
    console.error('Some tests FAILED.');
} else {
    console.log('All tests passed.');
}
