// Pure logic: tablet-combination optimizer (minimizes pill-splitting burden).
// Dual browser-global (WM namespace) / CommonJS export so this file is testable under plain Node with no bundler.
(function (global) {
    "use strict";

    var tabletComponents = [
        { d: 5, detail: "เม็ด 5 mg", cost: 1 },
        { d: 3, detail: "เม็ด 3 mg", cost: 1 },
        { d: 2, detail: "เม็ด 2 mg", cost: 1 },
        { d: 2.5, detail: "หักครึ่งเม็ด 5 mg", cost: 1.5 },
        { d: 1.5, detail: "หักครึ่งเม็ด 3 mg", cost: 1.5 },
        { d: 1, detail: "หักครึ่งเม็ด 2 mg", cost: 1.5 }
    ];

    function getBaseTablet(d) {
        if (d === 5 || d === 2.5) return 5;
        if (d === 3 || d === 1.5) return 3;
        if (d === 2 || d === 1) return 2;
        return d;
    }

    function getBestCombo(target) {
        target = Math.round(target * 2) / 2;
        if (target === 0) return { cost: 0, combo: {} };
        if (target < 1 || target > 150) return null; // Recursion safeguard

        var memo = {};
        function dp(n) {
            n = Math.round(n * 2) / 2;
            if (n === 0) return { cost: 0, combo: {} };
            if (n < 0) return null;

            var key = n.toString();
            if (memo[key] !== undefined) return memo[key];

            var best = null;
            for (var i = 0; i < tabletComponents.length; i++) {
                var c = tabletComponents[i];
                var res = dp(n - c.d);
                if (res !== null) {
                    var totalCost = res.cost + c.cost;
                    if (best === null || totalCost < best.cost) {
                        var newCombo = Object.assign({}, res.combo);
                        newCombo[c.d] = (newCombo[c.d] || 0) + 1;
                        best = { cost: totalCost, combo: newCombo };
                    }
                }
            }
            memo[key] = best;
            return best;
        }

        var result = dp(target);
        if (!result) return null;

        var comboArr = [];
        for (var d in result.combo) {
            var comp = tabletComponents.find(function (c) { return c.d == parseFloat(d); });
            comboArr.push({ d: comp.d, detail: comp.detail, qty: result.combo[d] });
        }
        return { cost: result.cost, combo: comboArr };
    }

    function formatComboText(comboArr) {
        var html = "";
        comboArr.forEach(function (c) {
            if (c.qty > 1) { html += "<li>" + c.d + " mg x " + c.qty + " <span style=\"color:#7f8c8d; font-size:13px;\">(ใช้ " + c.qty + " " + c.detail + ")</span></li>"; }
            else { html += "<li>" + c.d + " mg <span style=\"color:#7f8c8d; font-size:13px;\">(ใช้ 1 " + c.detail + ")</span></li>"; }
        });
        return html;
    }

    // Precomputes getBestCombo for every valid half-mg dose once, so callers doing an
    // exhaustive search (e.g. the OPD regimen search) don't recompute the same DP thousands of times.
    function buildComboCache(minDose, maxDose) {
        var cache = {};
        for (var n = minDose; n <= maxDose; n += 0.5) {
            var key = Math.round(n * 2) / 2;
            cache[key] = getBestCombo(key);
        }
        return cache;
    }

    var api = {
        tabletComponents: tabletComponents,
        getBaseTablet: getBaseTablet,
        getBestCombo: getBestCombo,
        formatComboText: formatComboText,
        buildComboCache: buildComboCache
    };

    global.WM = global.WM || {};
    global.WM.tabletOptimizer = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : global);
