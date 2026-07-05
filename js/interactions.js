// Categorized drug/diet interaction checklist. Purely informational: checking items shows an
// advisory banner (closer monitoring / earlier recheck) but never changes the calculated dose -
// the validated OPD/IPD dosing math in opd.js/ipd.js is untouched by this module.
(function (global) {
    "use strict";

    var CATEGORIES = [
        {
            key: 'up',
            title: '⬆️ เพิ่ม INR (ระวัง Bleeding)',
            className: 'up',
            items: [
                'Amiodarone', 'TMP-SMX (Bactrim)', 'Metronidazole', 'Fluconazole',
                'Ciprofloxacin', 'Azithromycin/Clarithromycin', 'Omeprazole (mild)'
            ]
        },
        {
            key: 'down',
            title: '⬇️ ลด INR (ระวัง Clot)',
            className: 'down',
            items: ['Rifampin', 'Carbamazepine', 'Phenytoin', 'Rifabutin']
        },
        {
            key: 'other',
            title: '🩸 เพิ่มความเสี่ยง Bleeding (ไม่ผ่าน INR)',
            className: 'other',
            items: ['Aspirin/NSAIDs', 'Clopidogrel/Antiplatelet อื่นๆ']
        },
        {
            key: 'diet',
            title: '🥗 อาหาร/อาหารเสริม',
            className: 'other',
            items: [
                'วิตามินเคสูง (ผักใบเขียวปริมาณมาก/เปลี่ยนแปลงกะทันหัน)', 'Cranberry juice',
                'Fish oil / Ginkgo / Ginseng', 'แอลกอฮอล์'
            ]
        }
    ];

    function slug(prefix, text) {
        return prefix + '_' + text.toLowerCase().replace(/[^a-z0-9ก-๙]+/gi, '');
    }

    function render(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var html = '';
        CATEGORIES.forEach(function (cat) {
            html += '<div class="interaction-category">';
            html += '<div class="interaction-category-title ' + cat.className + '">' + cat.title + '</div>';
            html += '<div class="interaction-chip-row">';
            cat.items.forEach(function (item) {
                var id = slug(cat.key, item);
                html += '<label class="interaction-chip" for="' + id + '">'
                    + '<input type="checkbox" id="' + id + '" data-category="' + cat.key + '" data-label="' + item + '">'
                    + '<span>' + item + '</span></label>';
            });
            html += '</div></div>';
        });
        container.innerHTML = html;
    }

    // Buckets by the item's own category key (up/down/other/diet) so the advisory banner mirrors
    // the same grouping shown in the checklist itself, instead of collapsing distinct categories
    // (e.g. diet factors vs. non-INR bleeding risk) under one generic label.
    function collectChecked(containerId) {
        var container = document.getElementById(containerId);
        var result = {};
        CATEGORIES.forEach(function (cat) { result[cat.key] = []; });
        if (!container) return result;
        container.querySelectorAll('input[type="checkbox"]:checked').forEach(function (cb) {
            var cat = cb.getAttribute('data-category');
            if (result[cat]) result[cat].push(cb.getAttribute('data-label'));
            cb.closest('.interaction-chip').classList.add('checked');
        });
        container.querySelectorAll('input[type="checkbox"]:not(:checked)').forEach(function (cb) {
            cb.closest('.interaction-chip').classList.remove('checked');
        });
        return result;
    }

    function updateAdvisory(containerId, advisoryId) {
        var checked = collectChecked(containerId);
        var advisoryEl = document.getElementById(advisoryId);
        if (!advisoryEl) return;
        var anyChecked = CATEGORIES.some(function (cat) { return checked[cat.key].length > 0; });
        if (!anyChecked) {
            advisoryEl.classList.remove('visible');
            advisoryEl.innerHTML = '';
            return;
        }
        var html = '<strong>⚠️ พบปัจจัยที่อาจกระทบระดับ INR:</strong><ul>';
        CATEGORIES.forEach(function (cat) {
            if (checked[cat.key].length) html += '<li><strong>' + cat.title + ':</strong> ' + checked[cat.key].join(', ') + '</li>';
        });
        html += '</ul><em>พิจารณาตรวจ INR เร็วขึ้น/ถี่ขึ้นกว่าปกติ ตามดุลยพินิจแพทย์ (ระบบไม่ได้ปรับขนาดยาให้อัตโนมัติจากรายการนี้)</em>';
        advisoryEl.innerHTML = html;
        advisoryEl.classList.add('visible');
    }

    var api = { CATEGORIES: CATEGORIES, render: render, collectChecked: collectChecked, updateAdvisory: updateAdvisory };

    global.WM = global.WM || {};
    global.WM.interactions = api;
})(window);
