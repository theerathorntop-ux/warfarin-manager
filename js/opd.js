// OPD (maintenance / dose-adjustment) logic: dosing math + regimen search + DOM wiring.
(function (global) {
    "use strict";

    var TO = (typeof module !== "undefined" && module.exports) ? require("./tabletOptimizer.js") : global.WM.tabletOptimizer;

    // Pure dosing math: given current weekly dose + INR (+ optional previous INR for trend),
    // returns candidate weekly regimens. No DOM access - safe to unit test directly.
    function warfarinAdjustment(currentWeekly, currentINR, targetRange, prevInr) {
        var low = targetRange === "2-3" ? 2.0 : 2.5;
        var high = targetRange === "2-3" ? 3.0 : 3.5;

        var factor = 1.0;
        if (currentINR < low) { factor = (currentINR < 1.5) ? 1.20 : 1.10; }
        else if (currentINR > high) {
            if (currentINR >= 4.5) factor = 0.80;
            else if (currentINR > 4.0) factor = 0.85;
            else factor = 0.90;
        }

        // Time-weighted INR trend adjustment
        var trendModifier = 1.0;
        var trendMessage = "";
        if (!isNaN(prevInr)) {
            var delta = currentINR - prevInr;
            if (delta >= 0.8) {
                trendModifier = 0.9;
                trendMessage = "⚠️ <strong>Trend correction applied:</strong> INR เพิ่มขึ้นอย่างรวดเร็ว (≥ 0.8) ระบบปรับลดความแรงในการเพิ่มยาลง เพื่อป้องกัน Overshoot";
            } else if (delta <= -0.8) {
                trendModifier = 1.1;
                trendMessage = "⚠️ <strong>Trend correction applied:</strong> INR ลดลงอย่างรวดเร็ว (≤ -0.8) ระบบเร่งการเพิ่มยาขึ้นเล็กน้อย เพื่อป้องกัน Subtherapeutic";
            }
        }
        factor = factor * trendModifier;

        var exactTargetS = currentWeekly * factor;
        if (exactTargetS < 3.5) exactTargetS = 3.5;

        var validPlans = [];
        var maxDeviation = Math.max(exactTargetS * 0.15, 1.5);

        // Precompute combos for every representable half-mg dose once, instead of recomputing
        // the same tablet-combination DP on every (dWd, dWe) pair in the search below.
        var comboCache = TO.buildComboCache(0, 15);

        for (var pattern = 0; pattern <= 2; pattern++) {
            for (var dWd = 0.5; dWd <= 15; dWd += 0.5) {
                for (var dWe = 0; dWe <= 15; dWe += 0.5) {
                    if (pattern === 0 && dWd !== dWe) continue;
                    var currentS = ((7 - pattern) * dWd) + (pattern * dWe);
                    var deviation = Math.abs(currentS - exactTargetS);

                    if (deviation > maxDeviation) continue;

                    var comboWd = comboCache[dWd];
                    var comboWe = comboCache[dWe];
                    if (!comboWd || (!comboWe && dWe !== 0) || comboWd.cost > 3 || (comboWe && comboWe.cost > 3)) continue;

                    var score = deviation * 10;
                    if (pattern === 1) score += 5;
                    if (pattern === 2) score += 12;
                    score += (comboWd.cost * (7 - pattern)) * 1.5;
                    if (comboWe) score += (comboWe.cost * pattern) * 1.5;

                    if (dWe === 0) score -= 15;
                    if (dWe === dWd * 2) score -= 10;
                    if (dWe === dWd / 2) score -= 10;
                    if (dWd % 1 === 0 && dWe % 1 === 0) score -= 5;
                    if (dWe !== 0 && dWe !== dWd * 2 && dWe !== dWd / 2) score += Math.abs(dWd - dWe) * 4;

                    // Pharmacist pill-packing tweak (strength counting)
                    var uniqueStrengths = new Set();
                    comboWd.combo.forEach(function (c) { uniqueStrengths.add(TO.getBaseTablet(c.d)); });
                    if (comboWe && dWe !== 0) {
                        comboWe.combo.forEach(function (c) { uniqueStrengths.add(TO.getBaseTablet(c.d)); });
                    }

                    var strengthCount = uniqueStrengths.size;
                    if (strengthCount === 2) score += 4;
                    if (strengthCount >= 3) score += 10;

                    validPlans.push({ dWd: dWd, dWe: dWe, pattern: pattern, weeklyTotal: currentS, comboWd: comboWd, comboWe: comboWe, score: score, deviation: deviation });
                }
            }
        }

        validPlans.sort(function (a, b) { return a.score - b.score; });
        var topPlans = [];
        if (validPlans.length > 0) {
            topPlans.push(validPlans[0]);
            for (var i = 1; i < validPlans.length; i++) {
                if (validPlans[i].dWd !== topPlans[0].dWd || validPlans[i].pattern !== topPlans[0].pattern) {
                    topPlans.push(validPlans[i]); break;
                }
            }
        } else {
            var avg = Math.round((exactTargetS / 7) * 2) / 2;
            var fallbackCombo = TO.getBestCombo(avg) || { cost: 0, combo: [{ d: avg, detail: "เม็ด", qty: 1 }] };
            topPlans.push({ dWd: avg, dWe: avg, pattern: 0, weeklyTotal: avg * 7, comboWd: fallbackCombo, comboWe: fallbackCombo });
        }
        return { topPlans: topPlans, exactTargetS: exactTargetS, trendMessage: trendMessage };
    }

    function createOptionCard(plan, optionNumber, isPrimary) {
        var dWd = plan.dWd, dWe = plan.dWe, pattern = plan.pattern, comboWd = plan.comboWd, comboWe = plan.comboWe, weeklyTotal = plan.weeklyTotal;
        var html = '<div class="option-card ' + (isPrimary ? 'primary' : '') + '">'
            + '<div class="option-badge">Option ' + optionNumber + (isPrimary ? ' (แนะนำ)' : '') + '</div>'
            + '<div class="option-total">รวม ' + weeklyTotal + ' mg/สัปดาห์</div>'
            + '<div class="regimen-detail">';

        if (pattern === 0) { html += '<p>✅ <strong>ทุกวัน:</strong> ' + dWd + ' mg</p>'; }
        else if (pattern === 1) {
            html += '<p>✅ <strong>จันทร์-เสาร์:</strong> ' + dWd + ' mg</p>';
            html += '<p>' + (dWe === 0 ? "🛑" : "⭐") + ' <strong>อาทิตย์:</strong> ' + (dWe === 0 ? "งดยา" : dWe + " mg") + '</p>';
        }
        else if (pattern === 2) {
            html += '<p>✅ <strong>จันทร์-ศุกร์:</strong> ' + dWd + ' mg</p>';
            html += '<p>' + (dWe === 0 ? "🛑" : "⭐") + ' <strong>เสาร์-อาทิตย์:</strong> ' + (dWe === 0 ? "งดยา" : dWe + " mg") + '</p>';
        }

        html += '</div><div class="tablet-hint"><strong>วิธีหยิบยาจากซอง:</strong><ul>';

        if (pattern === 0) { html += TO.formatComboText(comboWd.combo); }
        else {
            html += '<li class="day-header">▶ วันที่ทาน ' + dWd + ' mg:</li>';
            html += TO.formatComboText(comboWd.combo);
            html += '<li class="day-header">▶ วันที่ทาน ' + (dWe === 0 ? '0' : dWe) + ' mg:</li>';
            if (dWe === 0) html += '<li>งดยา (0 mg)</li>'; else html += TO.formatComboText(comboWe.combo);
        }
        html += '</ul></div></div>';
        return html;
    }

    function calculateOPD() {
        var UI = global.WM.ui;
        var currentDoseEl = document.getElementById('currentDose');
        var currentINREl = document.getElementById('currentINR');

        var currentDose = parseFloat(currentDoseEl.value);
        var currentINR = parseFloat(currentINREl.value);
        var prevInrInput = document.getElementById('prevInrOpd').value;
        var prevInr = parseFloat(prevInrInput);
        var targetRange = document.getElementById('targetRange').value;
        var wasStable = document.getElementById('wasStable').checked;

        var lowTarget = targetRange === "2-3" ? 2.0 : 2.5;
        var highTarget = targetRange === "2-3" ? 3.0 : 3.5;

        UI.clearFieldError(currentDoseEl);
        UI.clearFieldError(currentINREl);
        var hasError = false;
        if (isNaN(currentDose) || currentDose <= 0) { UI.showFieldError(currentDoseEl, 'กรุณากรอกขนาดยาปัจจุบัน'); hasError = true; }
        if (isNaN(currentINR) || currentINR <= 0) { UI.showFieldError(currentINREl, 'กรุณากรอก INR'); hasError = true; }
        if (hasError) return;

        // Reset UI states
        document.getElementById('emergencyAlert').style.display = 'none';
        document.getElementById('stableAlert').style.display = 'none';
        document.getElementById('trendAlert').style.display = 'none';
        document.getElementById('holdStep').style.display = 'none';
        document.getElementById('maintenanceStep').style.display = 'block';
        document.getElementById('maintenanceHeader').innerText = "▶ New Maintenance Regimen";
        document.getElementById('regimenDisplay').style.display = 'grid';
        document.getElementById('optionsTitle').style.display = 'block';

        var data = warfarinAdjustment(currentDose, currentINR, targetRange, prevInr);

        var trendAlertDiv = document.getElementById('trendAlert');
        if (data.trendMessage) {
            trendAlertDiv.style.display = 'block';
            trendAlertDiv.innerHTML = data.trendMessage;
        } else if (!isNaN(prevInr)) {
            if (currentINR - prevInr >= 1.5) {
                trendAlertDiv.style.display = 'block';
                trendAlertDiv.innerHTML = "⚠️ <strong>Rapid INR Fluctuation:</strong> INR แกว่งขึ้นอย่างรวดเร็วมาก โปรดซักประวัติยาที่ตีกัน (เช่น Abx) หรืออาหารเสริม";
            } else if (prevInr - currentINR >= 1.5) {
                trendAlertDiv.style.display = 'block';
                trendAlertDiv.innerHTML = "⚠️ <strong>Rapid INR Fluctuation:</strong> INR แกว่งลงอย่างรวดเร็วมาก โปรดซักประวัติเรื่อง Adherence เป็นพิเศษ";
            }
        }

        if (currentINR > 10.0) {
            var emDiv = document.getElementById('emergencyAlert');
            emDiv.style.display = 'block';
            emDiv.innerHTML = "<h3>🚨 URGENT: CRITICAL INR LEVEL (&gt; 10)</h3><ul><li><strong>HOLD Warfarin ทันที</strong></li><li><strong>ประเมิน Bleeding:</strong> หากมี Major bleed พิจารณา 4-factor PCC + Vit K 5-10 mg IV ทันที</li><li><strong>หากไม่มี Bleed:</strong> ให้ Vit K 2.5 - 5 mg PO</li><li>พิจารณาส่งประเมินที่โรงพยาบาล</li></ul>";
            document.getElementById('maintenanceStep').style.display = 'none';
            document.getElementById('followupBox').innerHTML = "📅 <strong>นัดเจาะ INR ครั้งต่อไป:</strong> ภายใน 24 ชั่วโมง หรือประเมินซ้ำแบบวิกฤต<br><br><em>หมายเหตุ: กำหนดขนาดยา Maintenance ใหม่หลังจาก INR กลับมาคงที่แล้วเท่านั้น</em>";
            document.getElementById('opdOutput').style.display = 'block';
            return;
        }

        var isMinorDeviation = (currentINR >= lowTarget - 0.3 && currentINR < lowTarget) || (currentINR > highTarget && currentINR <= highTarget + 0.3);
        if (wasStable && isMinorDeviation) {
            document.getElementById('stableAlert').style.display = 'block';
            document.getElementById('stableAlert').innerHTML = "<strong>ℹ️ Patient Stability Suggestion:</strong><br>คนไข้เคยมีค่า INR Stable มาก่อน และแกว่งเล็กน้อย (±0.3) <em>พิจารณาคงขนาดยาเดิม (" + currentDose + " mg/wk)</em> และตรวจสอบปัจจัยรบกวน";
        }

        var isHoldingDose = false;
        if (currentINR >= 4.0) {
            isHoldingDose = true;
            var holdDiv = document.getElementById('holdStep');
            var instructions = "";
            if (currentINR >= 4.5 && currentINR <= 10.0) {
                instructions = "<strong>งดยา (Hold dose) 1-2 วันแรก</strong><br><span style=\"color:#7f8c8d; font-size:14px;\">(พิจารณาให้ Vit K 1-2.5 mg PO ร่วมด้วย เฉพาะรายที่ High bleed risk)</span>";
                document.getElementById('maintenanceHeader').innerText = "▶ Step 2: เริ่มยาตารางใหม่นี้ (เมื่อ INR < " + highTarget + ")";
            } else if (currentINR >= 4.0 && currentINR < 4.5) {
                instructions = "<strong>งดยา (Hold dose) 1 มื้อแรก</strong>";
                document.getElementById('maintenanceHeader').innerText = "▶ Step 2: ตารางยาหลังจากงด 1 มื้อ";
            }
            holdDiv.style.display = 'block';
            document.getElementById('holdInstructions').innerHTML = instructions;
        }

        var percentChange = ((data.exactTargetS - currentDose) / currentDose) * 100;
        var percentBadge = "";
        var pVal = Math.round(percentChange);

        if (pVal > 0) percentBadge = '<span class="badge increase">⬆️ ต้องเพิ่มยา +' + pVal + '%</span>';
        else if (pVal < 0) percentBadge = '<span class="badge decrease">⬇️ ต้องลดยา ' + pVal + '%</span>';
        else percentBadge = '<span class="badge neutral">➖ ขนาดยาคงเดิม</span>';

        if (wasStable && isMinorDeviation && pVal === 0) {
            document.getElementById('weeklyDoseDisplay').innerHTML = '<span>แนะนำให้ใช้ยาเดิม: ' + currentDose + ' mg/สัปดาห์</span> ' + percentBadge;
            document.getElementById('calcNoteDisplay').innerText = "ระบบคำนวณได้ตารางยาเดิม เนื่องจากเป็น Minor fluctuation";
        } else {
            document.getElementById('weeklyDoseDisplay').innerHTML = '<span>เป้าหมายใหม่ (Target): ' + data.exactTargetS.toFixed(1) + ' mg/สัปดาห์</span> ' + percentBadge;
            document.getElementById('calcNoteDisplay').innerText = "ระบบจัดทางเลือกการแบ่งยาที่ใกล้เคียงเป้าหมายให้ดังนี้";
        }

        var optionsHtml = createOptionCard(data.topPlans[0], 1, true);
        if (data.topPlans.length > 1) { optionsHtml += createOptionCard(data.topPlans[1], 2, false); }
        document.getElementById('regimenDisplay').innerHTML = optionsHtml;

        var followupText = "";
        if (wasStable && isMinorDeviation && pVal === 0) followupText = "4 สัปดาห์ <span style='font-size:14px; font-weight:normal;'>(เนื่องจากคนไข้มีประวัติคงที่และไม่ได้ปรับยา)</span>";
        else if (isHoldingDose) followupText = "3 - 5 วัน <span style='font-size:14px; font-weight:normal;'>(ติดตามหลังงดยา)</span>";
        else followupText = "1 - 2 สัปดาห์ <span style='font-size:14px; font-weight:normal;'>(ติดตามหลังปรับขนาดยา)</span>";

        document.getElementById('followupBox').innerHTML = "📅 <strong>นัดเจาะ INR ครั้งต่อไป:</strong> " + followupText;
        document.getElementById('opdOutput').style.display = 'block';
    }

    var api = { warfarinAdjustment: warfarinAdjustment, createOptionCard: createOptionCard, calculateOPD: calculateOPD };

    if (typeof window !== "undefined") {
        window.WM = window.WM || {};
        window.WM.opd = api;
        window.calculateOPD = calculateOPD; // referenced by inline onclick in index.html
    }
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : global);
