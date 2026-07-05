// HAS-BLED bleeding-risk score. Replaces the old single subjective "Frail / High bleeding risk"
// checkbox with a structured, itemized score; score >= 3 is conventionally "high risk".
// Reference: Pisters R, et al. Chest. 2010 (HAS-BLED). Informational aid only - does not
// change the core IPD dosing algorithm's math, just which branch (frail vs standard) it uses.
(function (global) {
    "use strict";

    var HASBLED_ITEMS = [
        { id: 'hb_htn', label: 'Hypertension ที่ควบคุมไม่ได้ (SBP > 160 mmHg)', points: 1 },
        { id: 'hb_renal', label: 'Renal impairment (dialysis, transplant, Cr > 2.26 mg/dL)', points: 1 },
        { id: 'hb_liver', label: 'Liver impairment (cirrhosis, bilirubin > 2x ULN, AST/ALT/ALP > 3x ULN)', points: 1 },
        { id: 'hb_stroke', label: 'ประวัติ Stroke', points: 1 },
        { id: 'hb_bleed', label: 'ประวัติ Bleeding หรือ Bleeding predisposition', points: 1 },
        { id: 'hb_labile', label: 'INR แกว่งไม่คงที่ (Labile INR)', points: 1 },
        { id: 'hb_elderly', label: 'อายุ > 65 ปี', points: 1 },
        { id: 'hb_drugs', label: 'ใช้ยาต้านเกล็ดเลือด/NSAIDs ร่วม หรือดื่มแอลกอฮอล์จัด', points: 1 }
    ];

    function computeScore(checkedIds) {
        var score = 0;
        HASBLED_ITEMS.forEach(function (item) {
            if (checkedIds.indexOf(item.id) !== -1) score += item.points;
        });
        return score;
    }

    function isHighRisk(score) {
        return score >= 3;
    }

    var api = { HASBLED_ITEMS: HASBLED_ITEMS, computeScore: computeScore, isHighRisk: isHighRisk };

    global.WM = global.WM || {};
    global.WM.bleedingRisk = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : global);
