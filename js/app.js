// App wiring: renders dynamic sections and hooks up event listeners once the DOM is ready.
(function () {
    "use strict";

    var INDICATION_MAP = {
        af: { range: '2-3', note: 'AF (non-valvular): เป้าหมายมาตรฐาน INR 2.0 - 3.0' },
        vte: { range: '2-3', note: 'VTE (DVT/PE): เป้าหมายมาตรฐาน INR 2.0 - 3.0' },
        valve_aortic: { range: '2-3', note: 'Mechanical Aortic Valve (bileaflet, ไม่มีปัจจัยเสี่ยงเพิ่ม): INR 2.0 - 3.0 — หากมี AF, EF < 35% หรือเคยมี thromboembolism ให้พิจารณา 2.5 - 3.5' },
        valve_mitral: { range: '2.5-3.5', note: 'Mechanical Mitral Valve: เป้าหมายมาตรฐาน INR 2.5 - 3.5' },
        aps: { range: '2-3', note: 'APS: เป้าหมายทั่วไป INR 2.0 - 3.0 — พิจารณา 2.5 - 3.5 ในราย Triple-positive/recurrent thrombosis (ปรึกษา Hematology)' }
    };

    function renderHasBledChecklist() {
        var BR = window.WM.bleedingRisk;
        var container = document.getElementById('hasBledChecklist');
        if (!container) return;
        var html = '';
        BR.HASBLED_ITEMS.forEach(function (item) {
            html += '<div class="checkbox-group">'
                + '<input type="checkbox" id="' + item.id + '">'
                + '<label for="' + item.id + '">' + item.label + '</label>'
                + '</div>';
        });
        container.innerHTML = html;
        container.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
            cb.addEventListener('change', updateHasBledScore);
        });
        updateHasBledScore();
    }

    function updateHasBledScore() {
        var BR = window.WM.bleedingRisk;
        var checked = [];
        document.querySelectorAll('#hasBledChecklist input[type="checkbox"]:checked').forEach(function (cb) {
            checked.push(cb.id);
        });
        var score = BR.computeScore(checked);
        var isHigh = BR.isHighRisk(score);
        var display = document.getElementById('hasBledScoreDisplay');
        if (display) {
            display.textContent = 'HAS-BLED score: ' + score + (isHigh ? ' (High bleeding risk — ใช้ Dose เริ่มต้นแบบระมัดระวัง)' : ' (ไม่เข้าเกณฑ์ High risk)');
            display.classList.remove('high', 'low');
            display.classList.add(isHigh ? 'high' : 'low');
        }
    }

    function wireIndicationSelect() {
        var select = document.getElementById('indicationSelect');
        if (!select) return;
        select.addEventListener('change', function () {
            var mapping = INDICATION_MAP[select.value];
            var note = document.getElementById('indicationNote');
            if (!mapping) {
                if (note) note.textContent = '';
                return;
            }
            var opdRange = document.getElementById('targetRange');
            var ipdRange = document.getElementById('ipdTargetRange');
            if (opdRange) opdRange.value = mapping.range;
            if (ipdRange) ipdRange.value = mapping.range;
            if (note) note.textContent = mapping.note;
        });
    }

    function wireInteractionChecklist() {
        window.WM.interactions.render('interactionChecklist');
        document.getElementById('interactionChecklist').addEventListener('change', function () {
            window.WM.interactions.updateAdvisory('interactionChecklist', 'interactionAdvisory');
        });
    }

    function wireDoseInputMode() {
        var OPD = window.WM.opd;
        OPD.renderDailyDoseTable('dailyDoseTable');
        document.getElementById('dailyDoseTable').addEventListener('input', OPD.computeDailyDoseTotal);

        var totalGroup = document.getElementById('totalDoseGroup');
        var dailyGroup = document.getElementById('dailyDoseGroup');
        document.querySelectorAll('input[name="doseInputMode"]').forEach(function (radio) {
            radio.addEventListener('change', function () {
                var isByDay = this.value === 'byday';
                totalGroup.style.display = isByDay ? 'none' : 'block';
                dailyGroup.style.display = isByDay ? 'block' : 'none';
            });
        });
    }

    function wireIpdDayToggle() {
        document.getElementById('ipdDay').addEventListener('change', function () {
            var day = parseInt(this.value, 10);
            document.getElementById('ipdInrGroup').style.display = (day >= 3) ? 'flex' : 'none';
        });
    }

    function wireTabKeyboardNav() {
        var buttons = document.querySelectorAll('.tab-button');
        buttons.forEach(function (btn, idx) {
            btn.addEventListener('keydown', function (e) {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                var nextIdx = e.key === 'ArrowRight' ? (idx + 1) % buttons.length : (idx - 1 + buttons.length) % buttons.length;
                buttons[nextIdx].focus();
                buttons[nextIdx].click();
            });
        });
    }

    function wirePrintButton() {
        var btn = document.getElementById('printBtn');
        if (btn) btn.addEventListener('click', function () { window.print(); });
    }

    document.addEventListener('DOMContentLoaded', function () {
        renderHasBledChecklist();
        wireIndicationSelect();
        wireInteractionChecklist();
        wireDoseInputMode();
        wireIpdDayToggle();
        wireTabKeyboardNav();
        wirePrintButton();
        document.getElementById('ipdInrGroup').style.display = 'none';
        // No preset dose/INR values anymore, so don't auto-calculate on load - wait for input.
    });
})();
