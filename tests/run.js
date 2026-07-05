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
