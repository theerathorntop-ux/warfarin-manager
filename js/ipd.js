// IPD (initiation & LMWH bridging) logic + DOM wiring.
(function (global) {
    "use strict";

    // Pure decision logic: no DOM access, safe to unit test directly.
    // params: { day, inr, prevInr, isFrail, hasBledScore, lowTarget, highTarget }
    function ipdDoseDecision(params) {
        var day = params.day, inr = params.inr, prevInr = params.prevInr;
        var isFrail = params.isFrail, hasBledScore = params.hasBledScore;
        var lowTarget = params.lowTarget, highTarget = params.highTarget;

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
                ? "(เริ่มยา 2.5 mg เนื่องจาก HAS-BLED score " + hasBledScore + " หรือมีปัจจัยเสี่ยงสูง. ไม่แนะนำให้ Loading 10mg)"
                : "(เริ่มยามาตรฐาน 5 mg. ไม่แนะนำให้ Loading 10mg ป้องกันลด Protein C เร็วเกินไป)";
        }
        else if (day === 3 || day === 4) {
            if (isNaN(inr) || inr <= 0) { return { needsInr: true, isRapidRise: isRapidRise }; }

            if (isFrail && inr > 3.0) {
                doseText = "🛑 HOLD ยา ทันที";
                noteText = "<strong>⚠️ High Bleeding Risk (HAS-BLED " + hasBledScore + "):</strong> คนไข้ INR ชูตสูงและมีความเสี่ยง Bleeding สูง ควรงดยา 1 มื้อและเจาะซ้ำ";
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

    function calculateIPD() {
        var UI = global.WM.ui;
        var BR = global.WM.bleedingRisk;

        var checkedHasBled = [];
        document.querySelectorAll('#hasBledChecklist input[type="checkbox"]:checked').forEach(function (cb) {
            checkedHasBled.push(cb.id);
        });
        var hasBledScore = BR.computeScore(checkedHasBled);
        var isFrail = BR.isHighRisk(hasBledScore);

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

        document.getElementById('ipdOutput').style.display = 'block';
        document.getElementById('bridgingAlert').style.display = needBridge ? 'block' : 'none';
        document.getElementById('ipdTrendAlert').style.display = 'none';

        var result = ipdDoseDecision({
            day: day, inr: inr, prevInr: prevInr, isFrail: isFrail,
            hasBledScore: hasBledScore, lowTarget: lowTarget, highTarget: highTarget
        });

        if (result.needsInr) { UI.showFieldError(inrEl, 'กรุณาระบุ INR'); return; }

        if (result.isRapidRise && day >= 3) {
            document.getElementById('ipdTrendAlert').style.display = 'block';
            document.getElementById('ipdTrendAlert').innerHTML = "⚠️ <strong>Rapid INR Rise:</strong> INR พุ่งเร็วข้ามคืน (เพิ่มขึ้น ≥ 0.8) ระวังความเสี่ยง Overshoot หนักในวันพรุ่งนี้!";
        }

        document.getElementById('ipdDoseText').innerHTML = result.doseText;
        document.getElementById('ipdDoseNote').innerHTML = result.noteText;
    }

    var api = { calculateIPD: calculateIPD, ipdDoseDecision: ipdDoseDecision };
    global.WM = global.WM || {};
    global.WM.ipd = api;
    if (typeof window !== "undefined") window.calculateIPD = calculateIPD; // referenced by inline onclick in index.html
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : global);
