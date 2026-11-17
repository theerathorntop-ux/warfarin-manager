// IPD (initiation & LMWH bridging) logic + DOM wiring.
(function (global) {
    "use strict";

    // Patient factors that increase warfarin sensitivity, for which CHEST suggests a lower
    // starting dose (elderly, low body weight, liver disease, heart failure, poor nutrition,
    // interacting drugs). HAS-BLED >= 3 is kept as an additional low-dose trigger.
    var SENSITIVITY_ITEMS = [
        { id: 'sens_age', label: 'อายุ > 75 ปี' },
        { id: 'sens_weight', label: 'น้ำหนัก < 50 kg' },
        { id: 'sens_liver', label: 'โรคตับ / Albumin ต่ำ' },
        { id: 'sens_chf', label: 'หัวใจล้มเหลว (Decompensated CHF)' },
        { id: 'sens_nutrition', label: 'ทุพโภชนาการ / กินได้น้อย / NPO' },
        { id: 'sens_thyroid', label: 'Hyperthyroidism' }
    ];

    // Pure: reasons to start at the reduced dose. checkedSensitivity = labels of checked items;
    // incInrDrugs = names of checked INR-raising interacting drugs.
    function lowDoseStartReasons(hasBledScore, checkedSensitivity, incInrDrugs) {
        var reasons = (checkedSensitivity || []).slice();
        if (incInrDrugs && incInrDrugs.length) reasons.push('ใช้ยาที่เพิ่ม INR ร่วม (' + incInrDrugs.join(', ') + ')');
        if (hasBledScore >= 3) reasons.push('HAS-BLED ' + hasBledScore + ' (High bleeding risk)');
        return reasons;
    }

    // Pure decision logic: no DOM access, safe to unit test directly.
    // params: { day, inr, prevInr, isFrail, hasBledScore, lowTarget, highTarget, lowDoseReasons? }
    function ipdDoseDecision(params) {
        var day = params.day, inr = params.inr, prevInr = params.prevInr;
        var isFrail = params.isFrail, hasBledScore = params.hasBledScore;
        var lowTarget = params.lowTarget, highTarget = params.highTarget;
        var reasonText = (params.lowDoseReasons && params.lowDoseReasons.length)
            ? params.lowDoseReasons.join(', ')
            : 'HAS-BLED score ' + hasBledScore + ' หรือมีปัจจัยเสี่ยงสูง';

        var doseText = "";
        var noteText = "";
        var baseDose = isFrail ? 2.5 : 5.0;
        var needsInr = false;

        var isRapidRise = false;
        if (day >= 3 && !isNaN(inr) && !isNaN(prevInr)) {
            if (inr - prevInr >= 0.8) isRapidRise = true;
        }

        if (day === 1 || day === 2) {
            doseText = "ให้ยา " + baseDose + " mg";
            noteText = isFrail
                ? "(เริ่มยา 2.5 mg เนื่องจาก: " + reasonText + ". ไม่แนะนำให้ Loading 10mg)"
                : "(เริ่มยามาตรฐาน 5 mg. ไม่แนะนำให้ Loading 10mg ป้องกันลด Protein C เร็วเกินไป)";
        }
        else if (day === 3 || day === 4) {
            if (isNaN(inr) || inr <= 0) { return { needsInr: true, isRapidRise: isRapidRise }; }

            if (isFrail && inr > 3.0) {
                doseText = "🛑 HOLD ยา ทันที";
                noteText = "<strong>⚠️ High-risk patient (" + reasonText + "):</strong> คนไข้ INR ชูตสูงและไวต่อยา/เสี่ยง Bleeding สูง ควรงดยา 1 มื้อและเจาะซ้ำ";
            }
            else if (baseDose === 5.0) {
                if (inr < 1.5) {
                    doseText = "5.0 mg";
                    noteText = "INR ยังไม่ขยับ (ยาออกฤทธิ์ดีเลย์ 36-72 ชม.) คงขนาดยาเดิม";
                }
                else if (inr >= 1.5 && inr < lowTarget) {
                    doseText = isRapidRise ? "2.0 - 3.0 mg" : "3.0 - 5.0 mg";
                    noteText = "INR เริ่มตอบสนอง ให้ยาลดลงเล็กน้อย" + (isRapidRise ? " (ลดเยอะขึ้นเพราะพุ่งเร็ว)" : "");
                }
                else if (inr >= lowTarget && inr <= highTarget) {
                    var nearUpper = (highTarget - inr) <= 0.2;
                    if (nearUpper || isRapidRise) {
                        doseText = "1.0 - 2.0 mg";
                        noteText = "INR ใกล้ขอบบนเป้าหมาย (หรือพุ่งเร็ว) แนะนำลดยาให้ต่ำลงเพื่อป้องกัน Overshoot พรุ่งนี้";
                    } else {
                        doseText = "2.0 - 3.0 mg";
                        noteText = "INR ถึงเป้าหมายแล้ว ลดขนาดยาลงเพื่อป้องกัน Overdose";
                    }
                }
                else {
                    doseText = "🛑 HOLD ยา";
                    noteText = "INR ทะลุเป้าหมาย ควรงดยา 1 มื้อและเจาะซ้ำ";
                }
            }
            else {
                if (inr < 1.5) {
                    doseText = "2.5 - 5.0 mg";
                    noteText = "ปรับเพิ่มยาอย่างระมัดระวัง (ยาออกฤทธิ์ดีเลย์ 36-72 ชม.)";
                }
                else if (inr >= 1.5 && inr < lowTarget) {
                    doseText = isRapidRise ? "1.0 - 1.5 mg" : "1.5 - 2.5 mg";
                    noteText = "INR เริ่มตอบสนอง ให้ยาลดลงเล็กน้อย";
                }
                else if (inr >= lowTarget && inr <= highTarget) {
                    var nearUpper2 = (highTarget - inr) <= 0.2;
                    if (nearUpper2 || isRapidRise) {
                        doseText = "0.5 - 1.0 mg";
                        noteText = "INR ใกล้ขอบบน (หรือพุ่งเร็ว) ลดขนาดยาลงอีกขั้น";
                    } else {
                        doseText = "1.0 - 2.0 mg";
                        noteText = "INR ถึงเป้าหมายแล้ว ลดขนาดยาลงเพื่อป้องกัน Overdose";
                    }
                }
                else {
                    doseText = "🛑 HOLD ยา";
                    noteText = "INR ทะลุเป้าหมาย ควรงดยา 1 มื้อและเจาะซ้ำ";
                }
            }
        }
        else if (day >= 5) {
            if (isNaN(inr) || inr <= 0) { return { needsInr: true, isRapidRise: isRapidRise }; }

            if (inr < lowTarget) {
                doseText = "ปรับเพิ่ม 10-20% (OPD Tab)";
                noteText = "<strong>Transition to maintenance adjustment:</strong> (ใช้ <strong>Tab: OPD</strong> เพื่อคำนวณ) และอย่าเพิ่งหยุด LMWH";
            }
            else if (inr >= lowTarget && inr <= highTarget) {
                doseText = "ใช้ขนาดยาเดิม (Maintenance)";
                noteText = "ระดับยาคงที่แล้ว หาก INR ถึงเป้า ≥ 24 ชม. และ LMWH ครบ 5 วัน ให้พิจารณา Off LMWH ได้";
            }
            else {
                doseText = "ลดยา หรือ HOLD ยา (OPD Tab)";
                noteText = "<strong>Transition to maintenance adjustment:</strong> (ใช้ <strong>Tab: OPD</strong> เพื่อคำนวณการงดยาและปรับลด)";
            }
        }

        return { needsInr: needsInr, doseText: doseText, noteText: noteText, isRapidRise: isRapidRise };
    }

    // DOM: gathers checked sensitivity factors + INR-raising drugs from the shared interaction checklist.
    function currentLowDoseReasons(hasBledScore) {
        var checked = [];
        SENSITIVITY_ITEMS.forEach(function (item) {
            var cb = document.getElementById(item.id);
            if (cb && cb.checked) checked.push(item.label);
        });
        var upDrugs = [];
        document.querySelectorAll('#interactionChecklist input[data-category="up"]:checked').forEach(function (cb) {
            upDrugs.push(cb.getAttribute('data-label'));
        });
        return lowDoseStartReasons(hasBledScore, checked, upDrugs);
    }

    function calculateIPD() {
        var UI = global.WM.ui;
        var BR = global.WM.bleedingRisk;

        var checkedHasBled = [];
        document.querySelectorAll('#hasBledChecklist input[type="checkbox"]:checked').forEach(function (cb) {
            checkedHasBled.push(cb.id);
        });
        var hasBledScore = BR.computeScore(checkedHasBled);
        var lowDoseReasons = currentLowDoseReasons(hasBledScore);
        var isFrail = lowDoseReasons.length > 0;

        var needBridge = document.getElementById('ipdBridging').checked;
        var day = parseInt(document.getElementById('ipdDay').value, 10);
        var inrEl = document.getElementById('ipdINR');
        var inr = parseFloat(inrEl.value);
        var prevInrInput = document.getElementById('ipdPrevINR').value;
        var prevInr = parseFloat(prevInrInput);
        var targetRange = document.getElementById('ipdTargetRange').value;

        var lowTarget = targetRange === "2-3" ? 2.0 : 2.5;
        var highTarget = targetRange === "2-3" ? 3.0 : 3.5;

        UI.clearFieldError(inrEl);

        document.getElementById('bridgingAlert').style.display = needBridge ? 'block' : 'none';
        document.getElementById('ipdTrendAlert').style.display = 'none';

        var result = ipdDoseDecision({
            day: day, inr: inr, prevInr: prevInr, isFrail: isFrail,
            hasBledScore: hasBledScore, lowTarget: lowTarget, highTarget: highTarget, lowDoseReasons: lowDoseReasons
        });

        // Only reveal the output once a valid recommendation exists, so a missing INR never leaves
        // the previous day's dose on screen.
        if (result.needsInr) {
            document.getElementById('ipdOutput').style.display = 'none';
            UI.showFieldError(inrEl, 'กรุณาระบุ INR');
            return;
        }
        document.getElementById('ipdOutput').style.display = 'block';

        if (result.isRapidRise && day >= 3) {
            document.getElementById('ipdTrendAlert').style.display = 'block';
            document.getElementById('ipdTrendAlert').innerHTML = "⚠️ <strong>Rapid INR Rise:</strong> INR พุ่งเร็วข้ามคืน (เพิ่มขึ้น ≥ 0.8) ระวังความเสี่ยง Overshoot หนักในวันพรุ่งนี้!";
        }

        document.getElementById('ipdDoseText').innerHTML = result.doseText;
        document.getElementById('ipdDoseNote').innerHTML = result.noteText;
    }

    var api = {
        calculateIPD: calculateIPD, ipdDoseDecision: ipdDoseDecision,
        SENSITIVITY_ITEMS: SENSITIVITY_ITEMS, lowDoseStartReasons: lowDoseStartReasons, currentLowDoseReasons: currentLowDoseReasons
    };
    global.WM = global.WM || {};
    global.WM.ipd = api;
    if (typeof window !== "undefined") window.calculateIPD = calculateIPD; // referenced by inline onclick in index.html
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : global);
