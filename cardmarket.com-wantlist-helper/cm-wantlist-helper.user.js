// ==UserScript==
// @name         Cardmarket.com Wantlist Helper
// @version      0.3.0
// @description  See how many cards from your wantlists a seller offers: combined matches table on seller pages, on-demand counts on product pages, automatic counts in the shopping cart.
// @author       seven
// @namespace    https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-wantlist-helper/
// @updateURL    https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-wantlist-helper/cm-wantlist-helper.user.js
// @downloadURL  https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-wantlist-helper/cm-wantlist-helper.user.js
// @match        https://www.cardmarket.com/en/Magic/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cardmarket.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Cloudflare fronts cardmarket.com - keep requests sequential and spaced out.
    const FETCH_DELAY_MS = 1500;
    const HITS_TTL_MS = 6 * 60 * 60 * 1000;
    const WANTLISTS_TTL_MS = 24 * 60 * 60 * 1000;
    const MAX_PAGES_PER_LIST = 5;
    const HITS_KEY = 'cmwh_hits';
    const WANTLISTS_KEY = 'cmwh_wantlists';
    const MARKER_CLASS = '_cmwh';
    const ID_PREFIX = 'cmwh-';

    // Cardmarket's localStorage can be completely full (a VWO analytics blob can
    // take the entire quota), in which case fall back to per-tab sessionStorage.
    let storageArea = null;
    function getStorageArea() {
        if (storageArea) { return storageArea; }
        for (const area of [localStorage, sessionStorage]) {
            try {
                area.setItem('cmwh_probe', 'x'.repeat(4096));
                area.removeItem('cmwh_probe');
                storageArea = area;
                return area;
            } catch (e) { /* try next area */ }
        }
        return null;
    }

    function storageGet(key) {
        try { return JSON.parse(getStorageArea().getItem(key)); } catch (e) { return null; }
    }

    function storageSet(key, value) {
        try { getStorageArea().setItem(key, JSON.stringify(value)); } catch (e) { /* run uncached */ }
    }

    function storageRemove(key) {
        // Clear both areas: tiny writes can land in an almost-full localStorage
        // even while the probe fails, splitting the cache across areas.
        for (const area of [localStorage, sessionStorage]) {
            try { area.removeItem(key); } catch (e) { /* nothing to clear */ }
        }
    }

    // Single sequential fetch queue shared by all features on a page.
    let queueTail = Promise.resolve();
    function queueFetchDoc(url) {
        const job = queueTail.then(async () => {
            const response = await fetch(url, { credentials: 'same-origin' });
            if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
            return new DOMParser().parseFromString(await response.text(), 'text/html');
        });
        queueTail = job.catch(() => {}).then(() => new Promise(resolve => setTimeout(resolve, FETCH_DELAY_MS)));
        return job;
    }

    function sellerFromHref(href) {
        const match = href.match(/\/Users\/([^/?#]+)/);
        return match ? match[1] : null;
    }

    function offersUrl(seller, listId, page) {
        const base = `https://www.cardmarket.com/en/Magic/Users/${seller}/Offers/Singles?idWantslist=${listId}`;
        return page > 1 ? `${base}&site=${page}` : base;
    }

    // --- wantlists (id -> name), cached 24h ---

    function readWantlistsFromSelect(doc) {
        const select = doc.querySelector('select[name="idWantslist"]');
        if (!select) { return null; }
        const lists = [...select.options].filter(o => o.value).map(o => ({ id: o.value, name: o.text.trim() }));
        return lists.length ? lists : null;
    }

    function readWantlistsFromWantsPage(doc) {
        const lists = [];
        const seen = new Set();
        for (const link of doc.querySelectorAll('a[href*="/Wants/"]')) {
            const match = (link.getAttribute('href') || '').match(/\/Wants\/(\d+)$/);
            if (!match || seen.has(match[1])) { continue; }
            seen.add(match[1]);
            const name = link.closest('.card')?.querySelector('h1,h2,h3,h4,h5,.card-title')?.textContent?.trim();
            lists.push({ id: match[1], name: name || `Wantlist ${match[1]}` });
        }
        return lists.length ? lists : null;
    }

    function getCachedWantlists() {
        const cached = storageGet(WANTLISTS_KEY);
        const fresh = cached && cached.lists && cached.lists.length && Date.now() - cached.ts < WANTLISTS_TTL_MS;
        return fresh ? cached.lists : null;
    }

    let wantlistsPromise = null;
    function getWantlists() {
        if (!wantlistsPromise) {
            wantlistsPromise = (async () => {
                let lists = getCachedWantlists() || readWantlistsFromSelect(document);
                if (!lists) {
                    lists = readWantlistsFromWantsPage(await queueFetchDoc('https://www.cardmarket.com/en/Magic/Wants'));
                }
                if (!lists) {
                    console.warn('[CM Wantlist Helper] No wantlists found - not logged in?');
                    return [];
                }
                storageSet(WANTLISTS_KEY, { lists, ts: Date.now() });
                return lists;
            })();
            wantlistsPromise.catch(() => { wantlistsPromise = null; });
        }
        return wantlistsPromise;
    }

    // --- per-seller hit counts, cached 6h ---

    function parseHitCount(doc) {
        const pagination = doc.querySelector('.pagination');
        if (pagination) {
            const match = pagination.textContent.match(/([\d.,]+)\s*Hits?/i);
            if (match) { return parseInt(match[1].replace(/[.,]/g, ''), 10); }
        }
        // A zero-hit filter result has no pagination bar (and no wantslist select
        // either); the empty offers table is what distinguishes it from e.g. a
        // Cloudflare challenge.
        if (doc.querySelector('#UserOffersTable')) { return 0; }
        throw new Error('unrecognized page');
    }

    function parsePageCount(doc) {
        const match = doc.querySelector('.pagination')?.textContent.match(/Page\s+\d+\s+of\s+(\d+)/i);
        return match ? parseInt(match[1], 10) : 1;
    }

    function getCachedCounts(seller) {
        const entry = (storageGet(HITS_KEY) || {})[seller];
        return entry && Date.now() - entry.ts < HITS_TTL_MS ? entry : null;
    }

    function cacheCounts(seller, entry) {
        const all = storageGet(HITS_KEY) || {};
        for (const [key, value] of Object.entries(all)) {
            if (Date.now() - value.ts >= HITS_TTL_MS) { delete all[key]; }
        }
        all[seller] = entry;
        storageSet(HITS_KEY, all);
    }

    const countsInFlight = new Map();
    function getSellerCounts(seller, lists) {
        const cached = getCachedCounts(seller);
        if (cached) { return Promise.resolve(cached); }
        if (countsInFlight.has(seller)) { return countsInFlight.get(seller); }
        const promise = (async () => {
            const perList = {};
            let total = 0;
            for (const list of lists) {
                const hits = parseHitCount(await queueFetchDoc(offersUrl(seller, list.id, 1)));
                perList[list.id] = hits;
                total += hits;
            }
            const entry = { total, perList, ts: Date.now() };
            cacheCounts(seller, entry);
            return entry;
        })();
        countsInFlight.set(seller, promise);
        promise.catch(() => {}).then(() => countsInFlight.delete(seller));
        return promise;
    }

    // --- shared rendering ---

    function renderBreakdown(seller, entry, lists) {
        const span = document.createElement('span');
        span.className = `${MARKER_CLASS} cmwh-counts`;
        span.title = 'Cards this seller offers from your wantlists';
        const total = document.createElement('strong');
        total.textContent = entry.total;
        span.appendChild(total);
        if (entry.total > 0 && lists.length > 1) {
            span.appendChild(document.createTextNode(' ('));
            lists.forEach((list, i) => {
                if (i > 0) { span.appendChild(document.createTextNode('+')); }
                const hits = entry.perList[list.id] || 0;
                let part;
                if (hits > 0) {
                    part = document.createElement('a');
                    part.href = offersUrl(seller, list.id, 1);
                    part.target = '_blank';
                } else {
                    part = document.createElement('span');
                }
                part.textContent = hits;
                part.title = list.name;
                span.appendChild(part);
            });
            span.appendChild(document.createTextNode(')'));
        }
        return span;
    }

    function renderError(err) {
        const span = document.createElement('span');
        span.className = `${MARKER_CLASS} cmwh-counts`;
        span.textContent = '?';
        span.title = `Wantlist check failed: ${err.message}`;
        return span;
    }

    function injectStyle() {
        const style = document.createElement('style');
        style.className = MARKER_CLASS;
        style.textContent = `
            .cmwh-counts { margin-left: 0.35em; font-size: 0.85em; white-space: nowrap; }
            .cmwh-counts a { text-decoration: none; }
            .cmwh-check-btn { margin-left: 0.35em; font-size: 0.85em; line-height: 1.1; padding: 0 0.3em; }
            .cmwh-panel { margin-bottom: 1rem; }
            .cmwh-panel summary { cursor: pointer; padding: 0.35rem 0; }
        `;
        document.head.appendChild(style);
    }

    // --- cloning Cardmarket's own offer rows ---

    // AjaxRequest.handleCallback() resolves data-ajax-callback as a dotted path off
    // window, so our stand-in for Offers.addArticlesCB has to be global.
    const CART_CALLBACK_NAME = 'cmwhAddArticlesCB';

    // Cardmarket binds tooltips and the add-to-cart AJAX submit handler per element
    // when the page loads, and only re-runs that for nodes its own AJAX responses
    // insert (see Init.observeDomChanges). Rows we clone in are inert until we run
    // the same initializer over them: Init.init() = tooltips + popovers +
    // Form.init() (which calls AJAX.initAjaxSubmit()). Both are idempotent and
    // scoped to the element passed in.
    function initCardmarketWidgets(root) {
        try {
            if (typeof window.Init?.init === 'function') {
                window.Init.init(root);
            } else {
                window.Tooltips?.init?.(root);
                window.AJAX?.initAjaxSubmit?.(root);
            }
        } catch (err) {
            console.warn('[CM Wantlist Helper] Could not initialize cloned rows:', err);
        }
    }

    // Offers.initAmountInputEventListeners() is the one binder Init.init() does not
    // cover: at page load it walks the whole document and makes each cart button
    // copy its row's amount <select> into the form's hidden amount[<id>] field on
    // click (an empty field means one copy). Cloned buttons never got it, so adding
    // 2 from a panel row added 1. Re-running Cardmarket's version would not help -
    // it is unscoped and looks the select up by its global id, which our renamed
    // clones no longer carry - so do the same job scoped to the cloned row.
    function bindAmountToCartButton(row) {
        for (const button of row.querySelectorAll('button[data-id-amount]')) {
            button.addEventListener('click', () => {
                const id = button.dataset.idAmount;
                const target = button.closest('form')?.querySelector(`input[name="amount[${id}]"]`);
                if (!target) { return; }
                const select = row.querySelector(`select[name="amount[${id}]"]`);
                target.value = select ? select.value : '1';
            });
        }
    }

    let clonedRowCount = 0;

    function prepareArticleRow(row) {
        // Ids have to stay unique on the page - the same offer can appear in more
        // than one wantlist section and again in the table below - but dropping
        // them breaks intra-row references (label/for, the add-to-cart form's
        // loader target), so give every clone its own prefix and rewrite the
        // references pointing at renamed ids only: things like
        // data-bs-target="#modal" must keep pointing outside the clone.
        const prefix = `${ID_PREFIX}${++clonedRowCount}-`;
        const originalId = row.id;
        const renamed = new Set();
        for (const el of [row, ...row.querySelectorAll('[id]')]) {
            if (el.id) {
                renamed.add(el.id);
                el.id = prefix + el.id;
            }
        }
        for (const el of [row, ...row.querySelectorAll('*')]) {
            for (const attr of ['for', 'data-ajax-loader', 'aria-labelledby', 'aria-controls', 'aria-describedby']) {
                const value = el.getAttribute(attr);
                if (value && renamed.has(value)) { el.setAttribute(attr, prefix + value); }
            }
        }
        // Which offer this clone shows, so the add-to-cart callback can find every
        // copy of a row without relying on the (now prefixed, possibly repeated) id.
        if (originalId) { row.dataset.cmwhRowId = originalId; }
        // The row checkbox and the amount select are form="BuyAllForm" - the page's
        // "put checked in cart" form, which lives outside the panel: left attached,
        // "select all offers" silently submits our cloned rows too. The select is
        // still needed as the per-row amount picker, the checkbox is not.
        row.querySelectorAll('input[type="checkbox"][form]').forEach(el => el.remove());
        row.querySelectorAll('[form]').forEach(el => el.removeAttribute('form'));
        // Cardmarket's callback refreshes rows by their original id (so it never
        // sees the clones) and appends its pagination follow-up rows into whatever
        // table the caller sits in (so they would land in our panel). Ours doesn't.
        row.querySelectorAll('form[data-ajax-callback="Offers.addArticlesCB"]')
            .forEach(form => { form.dataset.ajaxCallback = CART_CALLBACK_NAME; });
        bindAmountToCartButton(row);
        return row;
    }

    function importArticleRow(row) {
        return prepareArticleRow(document.importNode(row, true));
    }

    function replaceArticleRow(target, markup) {
        if (!target) { return; }
        const isClone = !!target.dataset.cmwhRowId;
        if (!markup) { target.remove(); return; }
        const holder = document.createElement('div');
        holder.innerHTML = markup;
        const fresh = holder.firstElementChild;
        if (!fresh) { target.remove(); return; }
        target.replaceWith(isClone ? prepareArticleRow(fresh) : fresh);
        if (isClone) { initCardmarketWidgets(fresh); }
    }

    // Stand-in for Offers.addArticlesCB on panel rows. Cardmarket's version updates
    // the cart menu, then rewrites/removes rows by id and refills the page from the
    // cursor; only the first two make sense for a clone, and its row lookup misses
    // the panel entirely, which is why panel rows kept showing a stale quantity.
    window[CART_CALLBACK_NAME] = function (response, caller) {
        let updatedRows = null;
        try {
            window.AJAXResponse?.updateShoppingCartCB?.(response);
            updatedRows = response.getJSON('updatedRows');
        } catch (err) {
            console.warn('[CM Wantlist Helper] Add to cart callback failed:', err);
        }
        for (const [id, html] of Object.entries(updatedRows || {})) {
            const markup = String(html).trim();
            replaceArticleRow(document.getElementById(id), markup);
            for (const clone of document.querySelectorAll(`[data-cmwh-row-id="${id}"]`)) {
                replaceArticleRow(clone, markup);
            }
        }
        try { window.Offers?.enableDisablePutCheckedInCart?.(); } catch (err) { /* page-table only */ }
    };

    // --- seller offers page: combined matches panel ---

    function initSellerOffersPage() {
        const seller = sellerFromHref(location.pathname);
        const table = document.querySelector('#UserOffersTable');
        if (!seller || !table) { return; }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `${MARKER_CLASS} btn btn-outline-primary btn-sm mb-2`;
        button.textContent = 'Check all wantlists';
        table.parentElement.insertBefore(button, table);
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                const lists = await getWantlists();
                if (!lists.length) {
                    button.textContent = 'No wantlists found';
                    return;
                }
                await buildMatchesPanel(seller, lists, button);
                button.remove();
            } catch (err) {
                button.textContent = `Wantlist check failed: ${err.message}`;
            }
        });
    }

    async function buildMatchesPanel(seller, lists, button) {
        const panel = document.createElement('section');
        panel.className = `${MARKER_CLASS} cmwh-panel`;
        const heading = document.createElement('h2');
        heading.className = 'h5';
        heading.textContent = 'Wantlist matches';
        panel.appendChild(heading);
        button.parentElement.insertBefore(panel, button);
        const perList = {};
        let total = 0;
        for (let i = 0; i < lists.length; i++) {
            const list = lists[i];
            const progress = `"${list.name}" (${i + 1}/${lists.length})`;
            button.textContent = `Checking ${progress}...`;
            const firstPage = await queueFetchDoc(offersUrl(seller, list.id, 1));
            const hits = parseHitCount(firstPage);
            perList[list.id] = hits;
            total += hits;
            const rows = [...firstPage.querySelectorAll('.table-body .article-row')];
            const pageCount = parsePageCount(firstPage);
            const lastPage = Math.min(pageCount, MAX_PAGES_PER_LIST);
            for (let page = 2; page <= lastPage; page++) {
                button.textContent = `Checking ${progress}, page ${page}/${lastPage}...`;
                const doc = await queueFetchDoc(offersUrl(seller, list.id, page));
                rows.push(...doc.querySelectorAll('.table-body .article-row'));
            }
            const section = renderListSection(seller, list, hits, rows, pageCount);
            panel.appendChild(section);
            initCardmarketWidgets(section);
        }
        cacheCounts(seller, { total, perList, ts: Date.now() });
    }

    function renderListSection(seller, list, hits, rows, pageCount) {
        const details = document.createElement('details');
        details.open = hits > 0;
        const summary = document.createElement('summary');
        const name = document.createElement('strong');
        name.textContent = list.name;
        summary.appendChild(name);
        summary.appendChild(document.createTextNode(` — ${hits} hit${hits === 1 ? '' : 's'}`));
        details.appendChild(summary);
        if (rows.length) {
            const table = document.createElement('div');
            table.className = 'table article-table table-striped';
            const body = document.createElement('div');
            body.className = 'table-body';
            for (const row of rows) {
                body.appendChild(importArticleRow(row));
            }
            table.appendChild(body);
            details.appendChild(table);
        }
        if (pageCount > MAX_PAGES_PER_LIST) {
            const note = document.createElement('p');
            const more = document.createElement('a');
            more.href = offersUrl(seller, list.id, 1);
            more.textContent = `Only the first ${MAX_PAGES_PER_LIST} pages are shown - see all ${hits} hits on Cardmarket →`;
            note.appendChild(more);
            details.appendChild(note);
        }
        return details;
    }

    // --- product page: on-demand count per seller ---

    function initProductPage() {
        const tableBody = document.querySelector('.table-body');
        if (!tableBody) { return; }
        processProductRows(tableBody);
        new MutationObserver(() => processProductRows(tableBody)).observe(tableBody, { childList: true, subtree: true });
    }

    function processProductRows(tableBody) {
        const cachedLists = getCachedWantlists();
        for (const row of tableBody.querySelectorAll('.article-row:not(.cmwh-processed)')) {
            const sellerLink = row.querySelector('.seller-name a[href*="/Users/"]');
            if (!sellerLink) { continue; }
            row.classList.add('cmwh-processed');
            const seller = sellerFromHref(sellerLink.getAttribute('href'));
            if (!seller) { continue; }
            const cached = getCachedCounts(seller);
            if (cached && cachedLists) {
                sellerLink.insertAdjacentElement('afterend', renderBreakdown(seller, cached, cachedLists));
            } else {
                sellerLink.insertAdjacentElement('afterend', makeCheckButton(seller));
            }
        }
    }

    function makeCheckButton(seller) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `${MARKER_CLASS} btn btn-outline-primary btn-sm cmwh-check-btn`;
        button.dataset.cmwhSeller = seller;
        button.textContent = '♡?';
        button.title = 'Check how many cards from your wantlists this seller offers';
        button.addEventListener('click', () => checkSeller(seller));
        return button;
    }

    async function checkSeller(seller) {
        const buttons = [...document.querySelectorAll('button[data-cmwh-seller]')]
            .filter(b => b.dataset.cmwhSeller === seller);
        buttons.forEach(b => { b.disabled = true; b.textContent = '...'; });
        let node;
        try {
            const lists = await getWantlists();
            if (!lists.length) { throw new Error('no wantlists found'); }
            node = renderBreakdown(seller, await getSellerCounts(seller, lists), lists);
        } catch (err) {
            node = renderError(err);
        }
        buttons.forEach(b => b.replaceWith(node.cloneNode(true)));
    }

    // --- shopping cart: automatic counts per shipment block ---

    async function initCartPage() {
        const blocks = [...document.querySelectorAll('.shipment-block')];
        if (!blocks.length) { return; }
        injectClearCacheButton(blocks[0]);
        const lists = await getWantlists();
        if (!lists.length) { return; }
        for (const block of blocks) {
            const sellerLink = block.querySelector('.seller-name a[href*="/Users/"]');
            const actionBar = block.querySelector('.action-bar');
            if (!sellerLink || !actionBar) { continue; }
            const seller = sellerFromHref(sellerLink.getAttribute('href'));
            if (!seller) { continue; }
            const placeholder = document.createElement('span');
            placeholder.className = `${MARKER_CLASS} cmwh-counts`;
            placeholder.textContent = 'Wants: ...';
            actionBar.appendChild(placeholder);
            getSellerCounts(seller, lists)
                .then(entry => {
                    const node = renderBreakdown(seller, entry, lists);
                    node.prepend(document.createTextNode('Wants: '));
                    placeholder.replaceWith(node);
                })
                .catch(err => placeholder.replaceWith(renderError(err)));
        }
    }

    function injectClearCacheButton(firstBlock) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `${MARKER_CLASS} btn btn-outline-secondary btn-sm mb-3`;
        button.textContent = 'Clear wantlist cache';
        button.title = 'Forget cached wantlist hit counts (use after editing your wantlists)';
        button.addEventListener('click', () => {
            storageRemove(HITS_KEY);
            storageRemove(WANTLISTS_KEY);
            location.reload();
        });
        firstBlock.parentElement.insertBefore(button, firstBlock);
    }

    // --- dispatch ---

    const path = location.pathname;
    if (/^\/en\/Magic\/Users\/[^/]+\/Offers\/Singles\/?$/.test(path)) {
        injectStyle();
        initSellerOffersPage();
    } else if (/^\/en\/Magic\/Products\/Singles\//.test(path)) {
        injectStyle();
        initProductPage();
    } else if (/^\/en\/Magic\/ShoppingCart\/?$/.test(path)) {
        injectStyle();
        initCartPage();
    }
})();
