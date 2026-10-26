
// Interceptor global do fetch para passar credenciais de GitHub (token e repo) salvas no cliente
(function() {
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        let url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        if (url && (url.startsWith('/api/') || url.includes('/api/'))) {
            init = init || {};
            let headers = init.headers;
            const token = localStorage.getItem('github_token');
            const repo = localStorage.getItem('github_repo');

            if (token || repo) {
                if (!headers) headers = {};
                if (typeof Headers !== 'undefined' && headers instanceof Headers) {
                    if (token && !headers.has('x-github-token')) headers.set('x-github-token', token);
                    if (repo && !headers.has('x-github-repo')) headers.set('x-github-repo', repo);
                } else if (Array.isArray(headers)) {
                    if (token) headers.push(['x-github-token', token]);
                    if (repo) headers.push(['x-github-repo', repo]);
                } else {
                    if (token && !headers['x-github-token']) headers['x-github-token'] = token;
                    if (repo && !headers['x-github-repo']) headers['x-github-repo'] = repo;
                }
                init.headers = headers;
            }
        }
        return originalFetch.call(this, input, init);
    };
})();

/**
 * Shared i18n engine for GitHub Organizer.
 * Each page defines window.PAGE_I18N = { pt: {...}, en: {...} } BEFORE loading this script,
 * then calls I18N.init() on DOMContentLoaded.
 *
 * Usage in markup:
 *   <span data-i18n="nav.kanban">Kanban</span>
 *   <input data-i18n-ph="search.placeholder" placeholder="...">
 *   <button data-i18n-title="btn.save" title="...">
 *
 * Usage in JS:
 *   I18N.t('toast.saved')
 *   I18N.t('issues.counter', { count: 5 })  // supports {count} style interpolation
 *
 * Language changes are broadcast via a 'i18nchange' CustomEvent on document,
 * so page scripts can re-render dynamic content (tables, modals, etc).
 */
(function () {
    const STORAGE_KEY = 'go_lang';
    const FALLBACK_LANG = 'pt';

    function detectDefaultLang() {
        const nav = (navigator.language || navigator.userLanguage || 'pt').toLowerCase();
        return nav.startsWith('pt') ? 'pt' : 'en';
    }

    function getDict() {
        return (window.PAGE_I18N && window.PAGE_I18N[I18N.lang]) || {};
    }

    function getFallbackDict() {
        return (window.PAGE_I18N && window.PAGE_I18N[FALLBACK_LANG]) || {};
    }

    const I18N = {
        lang: localStorage.getItem(STORAGE_KEY) || detectDefaultLang(),

        t(key, vars) {
            let str = getDict()[key];
            if (str === undefined) str = getFallbackDict()[key];
            if (str === undefined) return key;
            if (vars) {
                Object.keys(vars).forEach(k => {
                    str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
                });
            }
            return str;
        },

        setLang(lang) {
            this.lang = lang;
            try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
            this.applyDOM();
            document.documentElement.setAttribute('lang', lang === 'pt' ? 'pt-BR' : 'en');
            document.dispatchEvent(new CustomEvent('i18nchange', { detail: { lang } }));
            this.updateSwitcherUI();
        },

        applyDOM() {
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                el.textContent = this.t(key);
            });
            document.querySelectorAll('[data-i18n-ph]').forEach(el => {
                el.setAttribute('placeholder', this.t(el.getAttribute('data-i18n-ph')));
            });
            document.querySelectorAll('[data-i18n-title]').forEach(el => {
                el.setAttribute('title', this.t(el.getAttribute('data-i18n-title')));
            });
            document.querySelectorAll('[data-i18n-html]').forEach(el => {
                el.innerHTML = this.t(el.getAttribute('data-i18n-html'));
            });
        },

        updateSwitcherUI() {
            document.querySelectorAll('.i18n-switch-btn').forEach(btn => {
                const isActive = btn.getAttribute('data-lang') === this.lang;
                btn.classList.toggle('font-bold', isActive);
                btn.classList.toggle('opacity-100', isActive);
                btn.classList.toggle('opacity-50', !isActive);
            });
        },

        /**
         * The backend always formats month/week labels in Portuguese abbreviations
         * (Jan, Fev, Mar, Abr, Mai, Jun, Jul, Ago, Set, Out, Nov, Dez) since it has no
         * knowledge of the viewer's language. This remaps those abbreviations to English
         * when the current language is 'en', leaving any other text (day numbers, "Sem", etc) untouched.
         */
        translateMonthLabel(label) {
            if (this.lang !== 'en' || !label) return label;
            const map = { 'Fev': 'Feb', 'Abr': 'Apr', 'Mai': 'May', 'Ago': 'Aug', 'Set': 'Sep', 'Out': 'Oct', 'Dez': 'Dec' };
            return String(label).replace(/\b(Fev|Abr|Mai|Ago|Set|Out|Dez)\b/g, m => map[m]);
        },

        /** Injects a small PT/EN toggle into the given container element (or #i18n-switcher if omitted). */
        renderSwitcher(container) {
            const el = container || document.getElementById('i18n-switcher');
            if (!el) return;
            el.innerHTML = `
                <button type="button" class="i18n-switch-btn opacity-50 hover:opacity-100 transition-opacity" data-lang="pt" title="Português">PT</button>
                <span class="opacity-40">/</span>
                <button type="button" class="i18n-switch-btn opacity-50 hover:opacity-100 transition-opacity" data-lang="en" title="English">EN</button>
            `;
            el.querySelectorAll('.i18n-switch-btn').forEach(btn => {
                btn.addEventListener('click', () => I18N.setLang(btn.getAttribute('data-lang')));
            });
            this.updateSwitcherUI();
        },

        init() {
            this.applyDOM();
            document.documentElement.setAttribute('lang', this.lang === 'pt' ? 'pt-BR' : 'en');
            this.renderSwitcher();
            this.updateSwitcherUI();
        }
    };

    window.I18N = I18N;
})();
