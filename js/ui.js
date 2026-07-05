// Shared UI helpers: tab switching, inline field validation, collapsible sections.
(function (global) {
    "use strict";

    function switchTab(tab) {
        var buttons = document.querySelectorAll('.tab-button');
        buttons.forEach(function (btn) {
            btn.classList.remove('active');
            btn.setAttribute('aria-selected', 'false');
            btn.setAttribute('tabindex', '-1');
        });
        document.querySelectorAll('.tab-content').forEach(function (content) {
            content.classList.remove('active');
        });

        var targetBtn = tab === 'opd' ? buttons[0] : buttons[1];
        var targetContent = document.getElementById(tab === 'opd' ? 'opdTab' : 'ipdTab');
        targetBtn.classList.add('active');
        targetBtn.setAttribute('aria-selected', 'true');
        targetBtn.setAttribute('tabindex', '0');
        targetContent.classList.add('active');
    }

    // Inline validation replaces blocking alert() popups so the page never halts on bad input.
    function showFieldError(inputEl, message) {
        inputEl.classList.add('invalid');
        inputEl.setAttribute('aria-invalid', 'true');
        var errorEl = document.getElementById(inputEl.id + 'Error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.classList.add('visible');
        }
    }

    function clearFieldError(inputEl) {
        inputEl.classList.remove('invalid');
        inputEl.removeAttribute('aria-invalid');
        var errorEl = document.getElementById(inputEl.id + 'Error');
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.classList.remove('visible');
        }
    }

    function toggleCollapsible(toggleBtn) {
        var targetId = toggleBtn.getAttribute('aria-controls');
        var body = document.getElementById(targetId);
        var isOpen = body.classList.toggle('open');
        toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    var api = {
        switchTab: switchTab,
        showFieldError: showFieldError,
        clearFieldError: clearFieldError,
        toggleCollapsible: toggleCollapsible
    };

    global.WM = global.WM || {};
    global.WM.ui = api;
    global.switchTab = switchTab; // referenced by inline onclick in index.html
    global.toggleCollapsible = toggleCollapsible;
})(window);
