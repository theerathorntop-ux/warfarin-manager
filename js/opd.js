// OPD (maintenance / dose-adjustment) logic: dosing math + regimen search + DOM wiring.
(function (global) {
    "use strict";

    var TO = (typeof module !== "undefined" && module.exports) ? require("./tabletOptimizer.js") : global.WM.tabletOptimizer;

    // CHEST 2012 (Holbrook et al.): a previously stable patient with a single INR <= 0.5 below or
    // above the therapeutic range -> continue the current dose and retest within 1-2 weeks.
    var MINOR_DEVIATION_MARGIN = 0.5;
    // Hold-dose threshold used by calculateOPD; a minor deviation never overlaps a hold.
    var HOLD_INR = 4.0;
    // A suggested regimen must change the dose in the same direction as the target and land
    // within this many mg/week of it (first pass); the second pass widens it before giving up.
    var PLAN_TOLERANCE = { pct: 5, minMg: 1.0 };
    var PLAN_TOLERANCE_RELAXED = { pct: 10, minMg: 1.5 };

    // Pure: trend correction from the previous INR. Only applied when the INR is outside the
    // target range, and never in a way that weakens a dose reduction for a supratherapeutic INR.
    // Returns the adjusted factor; a dampened increase stays an increase (never flips direction).
    function trendAdjustment(factor, currentINR, prevInr) {
        if (isNaN(prevInr) || isNaN(currentINR)) return { factor: factor, message: "" };
        var delta = currentINR - prevInr;
        var p = "⚠️ <strong>Trend:</strong> ";
        if (delta >= 0.8) {
            if (factor > 1) return { factor: 1 + (factor - 1) * 0.5, message: p + "INR ต่ำกว่าเป้าแต่เพิ่มขึ้นอย่างรวดเร็ว (≥ 0.8) ระบบลดการเพิ่มยาลงครึ่งหนึ่ง เพื่อป้องกัน Overshoot" };
            if (factor < 1) return { factor: factor * 0.9, message: p + "INR สูงกว่าเป้าและยังเพิ่มขึ้นอย่างรวดเร็ว (≥ 0.8) ระบบลดยาลงเพิ่มอีก 10%" };
            return { factor: factor, message: "ℹ️ <strong>Trend:</strong> INR เพิ่มขึ้นเร็ว (≥ 0.8) แต่ยังอยู่ในช่วงเป้าหมาย — ไม่ปรับขนาดยา พิจารณานัดเจาะ INR เร็วขึ้น" };
        }
        if (delta <= -0.8) {
            if (factor > 1) return { factor: factor * 1.1, message: p + "INR ต่ำกว่าเป้าและลดลงอย่างรวดเร็ว (≤ -0.8) ระบบเพิ่มยาขึ้นอีกเล็กน้อย เพื่อป้องกัน Subtherapeutic" };
            if (factor < 1) return { factor: factor, message: "ℹ️ <strong>Trend:</strong> INR ลดลงเร็วแต่ยังสูงกว่าเป้า — ใช้การลดยาตามปกติ (ไม่ลดความแรงในการลดยา)" };
            return { factor: factor, message: "ℹ️ <strong>Trend:</strong> INR ลดลงเร็ว (≤ -0.8) แต่ยังอยู่ในช่วงเป้าหมาย — ไม่ปรับขนาดยา พิจารณานัดเจาะ INR เร็วขึ้น" };
        }
        return { factor: factor, message: "" };
    }

    function sign(x) { return x > 1e-9 ? 1 : (x < -1e-9 ? -1 : 0); }
    function pct(newTotal, current) { return ((newTotal - current) / current) * 100; }
    function maxDeviationFor(currentWeekly, tol) { return Math.max(currentWeekly * tol.pct / 100, tol.minMg); }

    // Days changed (Mon=0 .. Sun=6) when adjusting k days of the patient's current regimen,
    // spread through the week so a change never lands on consecutive days when avoidable.
    var ADJUST_SPREAD = { 1: [6], 2: [2, 6], 3: [0, 2, 4], 4: [0, 2, 4, 6], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };

    // Pure: smallest change to the patient's current day-by-day regimen that reaches the target.
    // Patients follow a familiar schedule more reliably than a brand-new pattern.
    function adjustCurrentRegimen(currentDaily, exactTargetS, currentWeekly, comboCache, maxDev) {
        var direction = sign(exactTargetS - currentWeekly);
        if (!currentDaily || currentDaily.length !== 7 || direction === 0) return null;
        var best = null;
        [0.5, 1, 1.5, 2, 2.5, 3].forEach(function (step) {
            for (var k = 1; k <= 7; k++) {
                var daily = currentDaily.slice();
                var ok = true, cost = 0;
                ADJUST_SPREAD[k].forEach(function (idx) {
                    var nd = Math.round((currentDaily[idx] + direction * step) * 2) / 2;
                    // Never create a new skip day or exceed the search ceiling, and keep each
                    // day's change modest (<= 1 mg or ~30% of that day's dose) rather than loading one day.
                    if (step > Math.max(1, currentDaily[idx] * 0.3)) { ok = false; return; }
                    if (nd <= 0 || nd > 15 || !comboCache[nd] || comboCache[nd].cost > 3) { ok = false; return; }
                    daily[idx] = nd;
                    cost += comboCache[nd].cost;
                });
                if (!ok) continue;
                var total = daily.reduce(function (s, d) { return s + d; }, 0);
                if (sign(total - currentWeekly) !== direction) continue;
                var deviation = Math.abs(total - exactTargetS);
                if (deviation > maxDev) continue;
                var score = deviation * 10 + k * 3 + cost;
                if (!best || score < best.score) {
                    best = { daily: daily, changedDays: ADJUST_SPREAD[k].slice(), weeklyTotal: total, deviation: deviation, score: score, percentChange: pct(total, currentWeekly) };
                }
            }
        });
        return best;
    }

    // Pure dosing math: given current weekly dose + INR (+ optional previous INR for trend and
    // optional current day-by-day regimen), returns candidate weekly regimens. No DOM access.
    function warfarinAdjustment(currentWeekly, currentINR, targetRange, prevInr, currentDaily) {
        var low = targetRange === "2-3" ? 2.0 : 2.5;
        var high = targetRange === "2-3" ? 3.0 : 3.5;

        var factor = 1.0;
        if (currentINR < low) { factor = (currentINR < 1.5) ? 1.20 : 1.10; }
        else if (currentINR > high) {
            if (currentINR >= 4.5) factor = 0.80;
            else if (currentINR > 4.0) factor = 0.85;
            else factor = 0.90;
        }

        var trend = trendAdjustment(factor, currentINR, prevInr);
        factor = trend.factor;

        var exactTargetS = currentWeekly * factor;
        // 3.5 mg/wk floor - but a dose reduction must never end up *raising* the dose.
        if (exactTargetS < 3.5) exactTargetS = factor < 1 ? Math.min(3.5, currentWeekly) : 3.5;
        var direction = sign(exactTargetS - currentWeekly);

        // Precompute combos for every representable half-mg dose once, instead of recomputing
        // the same tablet-combination DP on every (dWd, dWe) pair in the search below.
        var comboCache = TO.buildComboCache(0, 15);

        function searchPlans(maxDeviation) {
            var plans = [];
            for (var pattern = 0; pattern <= 2; pattern++) {
                for (var dWd = 0.5; dWd <= 15; dWd += 0.5) {
                    for (var dWe = 0; dWe <= 15; dWe += 0.5) {
                        if (pattern === 0 && dWd !== dWe) continue;
                        var currentS = ((7 - pattern) * dWd) + (pattern * dWe);
                        var deviation = Math.abs(currentS - exactTargetS);
                        if (deviation > maxDeviation) continue;
                        // When a change is needed, the regimen must actually move the dose that way.
                        if (direction !== 0 && sign(currentS - currentWeekly) !== direction) continue;

                        var comboWd = comboCache[dWd];
                        var comboWe = comboCache[dWe];
                        if (!comboWd || (!comboWe && dWe !== 0) || comboWd.cost > 3 || (comboWe && comboWe.cost > 3)) continue;

                        var score = deviation * 10;
                        if (pattern === 1) score += 5;
                        if (pattern === 2) score += 12;
                        score += (comboWd.cost * (7 - pattern)) * 1.5;
                        if (comboWe) score += (comboWe.cost * pattern) * 1.5;

                        // Skip days (dWe === 0) get no special bonus: they confuse many patients.
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

                        plans.push({ dWd: dWd, dWe: dWe, pattern: pattern, weeklyTotal: currentS, comboWd: comboWd, comboWe: comboWe, score: score, deviation: deviation, percentChange: pct(currentS, currentWeekly) });
                    }
                }
            }
            plans.sort(function (a, b) { return a.score - b.score; });
            return plans;
        }

        var validPlans = searchPlans(maxDeviationFor(currentWeekly, PLAN_TOLERANCE));
        if (validPlans.length === 0) validPlans = searchPlans(maxDeviationFor(currentWeekly, PLAN_TOLERANCE_RELAXED));

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
            topPlans.push({ dWd: avg, dWe: avg, pattern: 0, weeklyTotal: avg * 7, comboWd: fallbackCombo, comboWe: fallbackCombo, percentChange: pct(avg * 7, currentWeekly) });
        }

        var adjustedCurrent = adjustCurrentRegimen(currentDaily, exactTargetS, currentWeekly, comboCache,
            maxDeviationFor(currentWeekly, PLAN_TOLERANCE_RELAXED));
        if (adjustedCurrent) {
            adjustedCurrent.combos = adjustedCurrent.daily.map(function (d) { return d > 0 ? comboCache[d] : null; });
        }

        return { topPlans: topPlans, adjustedCurrent: adjustedCurrent, exactTargetS: exactTargetS, trendMessage: trend.message };
    }

    // Pure: separate from the >= 0.8 trend correction above, a swing of >= 1.5 in either
    // direction prompts the clinician to look for a cause (interacting drug / adherence).
    function rapidFluctuationMessage(currentINR, prevInr) {
        if (isNaN(prevInr) || isNaN(currentINR)) return "";
        var delta = currentINR - prevInr;
        if (delta >= 1.5) return "⚠️ <strong>Rapid INR Fluctuation:</strong> INR แกว่งขึ้นอย่างรวดเร็วมาก โปรดซักประวัติยาที่ตีกัน (เช่น Abx) หรืออาหารเสริม";
        if (delta <= -1.5) return "⚠️ <strong>Rapid INR Fluctuation:</strong> INR แกว่งลงอย่างรวดเร็วมาก โปรดซักประวัติเรื่อง Adherence เป็นพิเศษ";
        return "";
    }

    // Pure: INR just outside the target range (within MINOR_DEVIATION_MARGIN), never a hold-level INR.
    function isMinorDeviation(currentINR, lowTarget, highTarget) {
        var below = currentINR >= lowTarget - MINOR_DEVIATION_MARGIN && currentINR < lowTarget;
        var above = currentINR > highTarget && currentINR <= highTarget + MINOR_DEVIATION_MARGIN && currentINR < HOLD_INR;
        return below || above;
    }

    // Pure: advisory text for situations the dose math does not cover.
    function valveLowInrMessage(indication, currentINR, lowTarget) {
        if (!indication || indication.indexOf('valve') !== 0 || !(currentINR < lowTarget)) return "";
        return "⚠️ <strong>Mechanical Valve + INR ต่ำกว่าเป้า:</strong> ประเมินความเสี่ยง Valve thrombosis/Stroke "
            + "พิจารณาให้ LMWH/UFH bridging จน INR เข้าเป้า โดยเฉพาะ Mitral valve, มี AF/ประวัติ Thromboembolism หรือ INR < 1.5 และนัดเจาะ INR ภายใน 1 สัปดาห์";
    }

    function signedPct(p) { var r = Math.round(p); return (r > 0 ? "+" : "") + r + "%"; }

    function createKeepCurrentCard(currentDose) {
        return '<div class="option-card primary">'
            + '<div class="option-badge">Option 1 (แนะนำ)</div>'
            + '<div class="option-total">รวม ' + currentDose + ' mg/สัปดาห์ <span class="option-pct">(คงเดิม)</span></div>'
            + '<div class="regimen-detail"><p>✅ <strong>คงตารางยาเดิม</strong> (ไม่ต้องเปลี่ยนวิธีทานยา)</p></div>'
            + '<div class="tablet-hint">ตรวจสอบปัจจัยรบกวน (Adherence, อาหาร, ยาที่ตีกัน, ภาวะเจ็บป่วย) ก่อนตัดสินใจปรับยา</div>'
            + '</div>';
    }

    function cardHeader(optionNumber, isPrimary, plan, label) {
        return '<div class="option-card ' + (isPrimary ? 'primary' : '') + '">'
            + '<div class="option-badge">Option ' + optionNumber + (isPrimary ? ' (แนะนำ)' : '') + (label ? ' · ' + label : '') + '</div>'
            + '<div class="option-total">รวม ' + plan.weeklyTotal + ' mg/สัปดาห์'
            + (plan.percentChange !== undefined ? ' <span class="option-pct">(' + signedPct(plan.percentChange) + ' จากเดิม)</span>' : '')
            + '</div>';
    }

    // Card for "adjust the current day-by-day regimen": lists every day, marking changed ones.
    function createAdjustedCurrentCard(plan, currentDaily, optionNumber, isPrimary) {
        var html = cardHeader(optionNumber, isPrimary, plan, 'ปรับจากตารางเดิม') + '<div class="regimen-detail">';
        DAYS.forEach(function (day, idx) {
            var changed = plan.changedDays.indexOf(idx) !== -1;
            var dose = plan.daily[idx];
            html += '<p class="' + (changed ? 'day-changed' : '') + '">' + (changed ? '✏️' : '✅') + ' <strong>' + day.label + ':</strong> '
                + (dose === 0 ? 'งดยา' : dose + ' mg')
                + (changed ? ' <span class="option-pct">(เดิม ' + currentDaily[idx] + ' mg)</span>' : '') + '</p>';
        });
        html += '</div><div class="tablet-hint"><strong>วิธีหยิบยาจากซอง (วันที่เปลี่ยน):</strong><ul>';
        var shown = {};
        plan.changedDays.forEach(function (idx) {
            var dose = plan.daily[idx];
            if (shown[dose]) return;
            shown[dose] = true;
            html += '<li class="day-header">▶ วันที่ทาน ' + dose + ' mg:</li>' + TO.formatComboText(plan.combos[idx].combo);
        });
        html += '</ul></div></div>';
        return html;
    }

    function createOptionCard(plan, optionNumber, isPrimary) {
        var dWd = plan.dWd, dWe = plan.dWe, pattern = plan.pattern, comboWd = plan.comboWd, comboWe = plan.comboWe;
        var html = cardHeader(optionNumber, isPrimary, plan) + '<div class="regimen-detail">';

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

    // Day-by-day dose entry: lets a nurse/clinician report the actual tablets taken each day
    // (strength x quantity, matching the same 2/3/5mg tablet strengths used by the tablet
    // optimizer) instead of having to pre-calculate a weekly total themselves.
    var DAYS = [
        { key: 'mon', label: 'จันทร์' }, { key: 'tue', label: 'อังคาร' }, { key: 'wed', label: 'พุธ' },
        { key: 'thu', label: 'พฤหัสบดี' }, { key: 'fri', label: 'ศุกร์' }, { key: 'sat', label: 'เสาร์' },
        { key: 'sun', label: 'อาทิตย์' }
    ];
    var DAILY_STRENGTHS = [2, 3, 5];

    function renderDailyDoseTable(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var html = '';
        DAYS.forEach(function (day) {
            html += '<div class="daily-dose-row" data-day="' + day.key + '">'
                + '<span class="day-label">' + day.label + '</span>'
                + '<select class="daily-strength" data-day="' + day.key + '">'
                + DAILY_STRENGTHS.map(function (s) { return '<option value="' + s + '">' + s + ' mg/เม็ด</option>'; }).join('')
                + '</select>'
                + '<input type="number" class="daily-qty" data-day="' + day.key + '" min="0" max="4" step="0.5" value="0">'
                + '<span class="daily-computed" data-day="' + day.key + '">0 mg</span>'
                + '</div>';
        });
        container.innerHTML = html;
    }

    // Returns the 7 daily doses (Mon..Sun) from the day-by-day table.
    function getDailyDoses() {
        return DAYS.map(function (day) {
            var strengthEl = document.querySelector('.daily-strength[data-day="' + day.key + '"]');
            var qtyEl = document.querySelector('.daily-qty[data-day="' + day.key + '"]');
            if (!strengthEl || !qtyEl) return 0;
            var strength = parseFloat(strengthEl.value);
            var qty = parseFloat(qtyEl.value);
            return (isNaN(strength) || isNaN(qty) || qty < 0) ? 0 : Math.round(strength * qty * 2) / 2;
        });
    }

    function computeDailyDoseTotal() {
        var daily = getDailyDoses();
        DAYS.forEach(function (day, idx) {
            var computedEl = document.querySelector('.daily-computed[data-day="' + day.key + '"]');
            if (computedEl) computedEl.textContent = daily[idx] + ' mg';
        });
        var total = Math.round(daily.reduce(function (s, d) { return s + d; }, 0) * 10) / 10;
        var totalDisplay = document.getElementById('dailyDoseTotalDisplay');
        if (totalDisplay) totalDisplay.textContent = total;
        return total;
    }

    function getActiveDoseInputMode() {
        var checked = document.querySelector('input[name="doseInputMode"]:checked');
        return checked ? checked.value : 'total';
    }

    function showAlert(id, html) {
        var el = document.getElementById(id);
        if (!el) return;
        el.style.display = html ? 'block' : 'none';
        el.innerHTML = html || '';
    }

    function calculateOPD() {
        var UI = global.WM.ui;
        var currentDoseEl = document.getElementById('currentDose');
        var currentINREl = document.getElementById('currentINR');
        var dailyDoseErrorEl = document.getElementById('dailyDoseError');
        var mode = getActiveDoseInputMode();

        var currentDose = (mode === 'byday') ? computeDailyDoseTotal() : parseFloat(currentDoseEl.value);
        var currentDaily = (mode === 'byday') ? getDailyDoses() : null;
        var currentINR = parseFloat(currentINREl.value);
        var prevInr = parseFloat(document.getElementById('prevInrOpd').value);
        var targetRange = document.getElementById('targetRange').value;
        var wasStable = document.getElementById('wasStable').checked;
        var bleedingEl = document.getElementById('bleedingStatus');
        var bleeding = bleedingEl ? bleedingEl.value : 'none';
        var indicationEl = document.getElementById('indicationSelect');
        var indication = indicationEl ? indicationEl.value : '';

        var lowTarget = targetRange === "2-3" ? 2.0 : 2.5;
        var highTarget = targetRange === "2-3" ? 3.0 : 3.5;

        UI.clearFieldError(currentDoseEl);
        UI.clearFieldError(currentINREl);
        if (dailyDoseErrorEl) dailyDoseErrorEl.classList.remove('visible');
        var hasError = false;
        if (mode === 'byday') {
            if (isNaN(currentDose) || currentDose <= 0) {
                if (dailyDoseErrorEl) { dailyDoseErrorEl.textContent = 'กรุณากรอกขนาดยาอย่างน้อย 1 วัน'; dailyDoseErrorEl.classList.add('visible'); }
                hasError = true;
            }
        } else if (isNaN(currentDose) || currentDose <= 0) { UI.showFieldError(currentDoseEl, 'กรุณากรอกขนาดยาปัจจุบัน'); hasError = true; }
        if (isNaN(currentINR) || currentINR <= 0) { UI.showFieldError(currentINREl, 'กรุณากรอก INR'); hasError = true; }
        if (hasError) { document.getElementById('opdOutput').style.display = 'none'; return; }

        // Reset UI states
        ['emergencyAlert', 'stableAlert', 'trendAlert', 'bleedAlert', 'valveAlert'].forEach(function (id) { showAlert(id, ''); });
        document.getElementById('holdStep').style.display = 'none';
        document.getElementById('maintenanceStep').style.display = 'block';
        document.getElementById('maintenanceHeader').innerText = "▶ New Maintenance Regimen";
        document.getElementById('regimenDisplay').style.display = 'grid';
        document.getElementById('optionsTitle').style.display = 'block';

        // Major bleeding overrides everything, whatever the INR.
        if (bleeding === 'major') {
            showAlert('emergencyAlert', "<h3>🚨 URGENT: MAJOR BLEEDING</h3><ul>"
                + "<li><strong>HOLD Warfarin ทันที</strong></li>"
                + "<li><strong>Vit K 5-10 mg IV</strong> (ฉีดช้าๆ)</li>"
                + "<li><strong>4-factor PCC</strong> ตามน้ำหนัก/INR (หากไม่มี ใช้ FFP)</li>"
                + "<li>ส่งต่อ/รักษาแบบ Emergency และหาตำแหน่งเลือดออก</li></ul>");
            document.getElementById('maintenanceStep').style.display = 'none';
            document.getElementById('followupBox').innerHTML = "📅 <strong>ติดตาม:</strong> ตรวจ INR ซ้ำหลังให้ PCC/Vit K และประเมินซ้ำแบบวิกฤต<br><br><em>หมายเหตุ: การกลับมาเริ่มยาใหม่ให้แพทย์ประเมินหลังเลือดหยุดแล้วเท่านั้น</em>";
            document.getElementById('opdOutput').style.display = 'block';
            return;
        }

        var data = warfarinAdjustment(currentDose, currentINR, targetRange, prevInr, currentDaily);

        var trendParts = [];
        if (data.trendMessage) trendParts.push(data.trendMessage);
        var fluctuationMsg = rapidFluctuationMessage(currentINR, prevInr);
        if (fluctuationMsg) trendParts.push(fluctuationMsg);
        showAlert('trendAlert', trendParts.join('<br><br>'));
        showAlert('valveAlert', valveLowInrMessage(indication, currentINR, lowTarget));
        if (bleeding === 'minor') {
            showAlert('bleedAlert', "🩸 <strong>Minor bleeding:</strong> พิจารณางดยา 1 มื้อ, หาสาเหตุ/ตำแหน่งเลือดออก, "
                + "ทบทวนยาที่เพิ่ม Bleeding (NSAIDs/Antiplatelet) และตรวจ CBC ตามความเหมาะสม");
        }

        if (currentINR > 10.0) {
            showAlert('emergencyAlert', "<h3>🚨 URGENT: CRITICAL INR LEVEL (&gt; 10)</h3><ul><li><strong>HOLD Warfarin ทันที</strong></li><li><strong>ประเมิน Bleeding:</strong> หากมี Major bleed พิจารณา 4-factor PCC + Vit K 5-10 mg IV ทันที</li><li><strong>หากไม่มี Bleed:</strong> ให้ Vit K 2.5 - 5 mg PO</li><li>พิจารณาส่งประเมินที่โรงพยาบาล</li></ul>");
            document.getElementById('maintenanceStep').style.display = 'none';
            document.getElementById('followupBox').innerHTML = "📅 <strong>นัดเจาะ INR ครั้งต่อไป:</strong> ภายใน 24 ชั่วโมง หรือประเมินซ้ำแบบวิกฤต<br><br><em>หมายเหตุ: กำหนดขนาดยา Maintenance ใหม่หลังจาก INR กลับมาคงที่แล้วเท่านั้น</em>";
            document.getElementById('opdOutput').style.display = 'block';
            return;
        }

        // Stable patient + small out-of-range INR (CHEST 2012): recommend keeping the current
        // regimen; the computed adjustment is still offered for the clinician's discretion.
        // Not applied when the patient is bleeding.
        var keepCurrent = wasStable && bleeding === 'none' && isMinorDeviation(currentINR, lowTarget, highTarget);
        if (keepCurrent) {
            showAlert('stableAlert', "<strong>ℹ️ Patient Stability Suggestion:</strong><br>คนไข้เคยมีค่า INR Stable มาก่อน และแกว่งเล็กน้อย (±" + MINOR_DEVIATION_MARGIN + " จากช่วงเป้าหมาย) <em>แนะนำคงขนาดยาเดิม (" + currentDose + " mg/wk)</em> และตรวจสอบปัจจัยรบกวน");
        }

        var isHoldingDose = false;
        if (currentINR >= HOLD_INR) {
            isHoldingDose = true;
            var instructions = "";
            if (currentINR >= 4.5) {
                instructions = "<strong>งดยา (Hold dose) 1-2 วันแรก</strong><br><span style=\"color:#7f8c8d; font-size:14px;\">(พิจารณาให้ Vit K 1-2.5 mg PO ร่วมด้วย เฉพาะรายที่ High bleed risk)</span>";
                document.getElementById('maintenanceHeader').innerText = "▶ Step 2: เริ่มยาตารางใหม่นี้ (เมื่อ INR < " + highTarget + ")";
            } else {
                instructions = "<strong>งดยา (Hold dose) 1 มื้อแรก</strong>";
                document.getElementById('maintenanceHeader').innerText = "▶ Step 2: ตารางยาหลังจากงด 1 มื้อ";
            }
            document.getElementById('holdStep').style.display = 'block';
            document.getElementById('holdInstructions').innerHTML = instructions;
        }

        var pVal = Math.round(pct(data.exactTargetS, currentDose));
        var percentBadge;
        if (pVal > 0) percentBadge = '<span class="badge increase">⬆️ ต้องเพิ่มยา +' + pVal + '%</span>';
        else if (pVal < 0) percentBadge = '<span class="badge decrease">⬇️ ต้องลดยา ' + pVal + '%</span>';
        else percentBadge = '<span class="badge neutral">➖ ขนาดยาคงเดิม</span>';

        // Build the option list: keep-current (stable minor case) and adjust-current-regimen
        // (day-by-day mode) come first, then the best fresh weekly patterns.
        var cards = [];
        if (keepCurrent) cards.push(function (n) { return createKeepCurrentCard(currentDose); });
        if (data.adjustedCurrent) cards.push(function (n, primary) { return createAdjustedCurrentCard(data.adjustedCurrent, currentDaily, n, primary); });
        data.topPlans.forEach(function (plan) { cards.push(function (n, primary) { return createOptionCard(plan, n, primary); }); });
        cards = cards.slice(0, 3);

        if (keepCurrent) {
            document.getElementById('weeklyDoseDisplay').innerHTML = '<span>แนะนำให้คงยาเดิม: ' + currentDose + ' mg/สัปดาห์</span> <span class="badge neutral">➖ ขนาดยาคงเดิม</span>';
            document.getElementById('calcNoteDisplay').innerText = "Minor fluctuation ในคนไข้ที่เคย Stable — แนะนำคงยาเดิม หากแพทย์พิจารณาปรับยา ใช้ Option ถัดไป (เป้าหมายที่คำนวณได้ "
                + data.exactTargetS.toFixed(1) + " mg/สัปดาห์, " + (pVal > 0 ? "+" : "") + pVal + "%)";
        } else {
            document.getElementById('weeklyDoseDisplay').innerHTML = '<span>เป้าหมายใหม่ (Target): ' + data.exactTargetS.toFixed(1) + ' mg/สัปดาห์</span> ' + percentBadge;
            document.getElementById('calcNoteDisplay').innerText = data.adjustedCurrent
                ? "Option 1 ปรับเฉพาะบางวันจากตารางเดิม (ผู้ป่วยจำง่ายกว่า) และมีตารางรูปแบบใหม่เป็นทางเลือก"
                : "ระบบจัดทางเลือกการแบ่งยาที่ใกล้เคียงเป้าหมายให้ดังนี้";
        }
        document.getElementById('regimenDisplay').innerHTML = cards.map(function (make, i) { return make(i + 1, i === 0); }).join('');

        var followupText;
        if (bleeding === 'minor') followupText = "ภายใน 1 สัปดาห์ <span style='font-size:14px; font-weight:normal;'>(มีเลือดออกเล็กน้อย)</span>";
        else if (isHoldingDose) followupText = "3 - 5 วัน <span style='font-size:14px; font-weight:normal;'>(ติดตามหลังงดยา)</span>";
        else if (keepCurrent) followupText = "1 - 2 สัปดาห์ <span style='font-size:14px; font-weight:normal;'>(คงยาเดิม ตรวจซ้ำเพื่อยืนยันว่า INR กลับเข้าเป้าหมาย)</span>";
        else if (pVal === 0) followupText = "ตามนัดเดิม <span style='font-size:14px; font-weight:normal;'>(INR อยู่ในช่วงเป้าหมาย)</span>";
        else followupText = "1 - 2 สัปดาห์ <span style='font-size:14px; font-weight:normal;'>(ติดตามหลังปรับขนาดยา)</span>";

        document.getElementById('followupBox').innerHTML = "📅 <strong>นัดเจาะ INR ครั้งต่อไป:</strong> " + followupText;
        document.getElementById('opdOutput').style.display = 'block';
    }

    var api = {
        warfarinAdjustment: warfarinAdjustment, trendAdjustment: trendAdjustment, adjustCurrentRegimen: adjustCurrentRegimen,
        createOptionCard: createOptionCard, calculateOPD: calculateOPD,
        rapidFluctuationMessage: rapidFluctuationMessage, isMinorDeviation: isMinorDeviation, valveLowInrMessage: valveLowInrMessage,
        renderDailyDoseTable: renderDailyDoseTable, computeDailyDoseTotal: computeDailyDoseTotal, getDailyDoses: getDailyDoses, DAYS: DAYS,
        MINOR_DEVIATION_MARGIN: MINOR_DEVIATION_MARGIN
    };

    if (typeof window !== "undefined") {
        window.WM = window.WM || {};
        window.WM.opd = api;
        window.calculateOPD = calculateOPD; // referenced by inline onclick in index.html
    }
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : global);
