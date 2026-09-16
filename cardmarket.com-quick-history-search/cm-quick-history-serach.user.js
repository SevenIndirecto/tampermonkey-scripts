// ==UserScript==
// @name         Cardmarket.com Quick Order History Search
// @version      1.0.0
// @description  Keeps a local browser database of all your cardmarket.com orders (every game): search your whole order history instantly, and see your buys and sells of a card in a "My History" tab on its product page.
// @author       seven
// @namespace    https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-quick-history-search/
// @updateURL    https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-quick-history-search/cm-quick-history-serach.user.js
// @downloadURL  https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-quick-history-search/cm-quick-history-serach.user.js
// @match        https://www.cardmarket.com/*/*/Orders/Search*
// @match        https://www.cardmarket.com/*/*/Products/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cardmarket.com
// @require      https://cdn.jsdelivr.net/npm/idb@8/build/umd.js
// @grant        none
// ==/UserScript==


(function () {
    // Config
    const DEBUG = false;
    const DB_NAME = 'cardmarket-orders';
    const DB_VERSION = 4;
    const BUILD_DELAY_BETWEEN_FETCHES = 3000; // in milliseconds
    const SYNC_DELAY_BETWEEN_FETCHES = 1500;
    const BUILD_RETRY_DELAY = 60 * 1000;
    const BUILD_MAX_RETRIES = 3;
    const SYNC_INTERVAL = 4 * 60 * 60 * 1000;
    const SEARCH_RESULTS_LIMIT = 200;

    const DAY = 24 * 60 * 60 * 1000;
    // Cardmarket limits order searches to 2 month spans
    const SEARCH_WINDOW = 58 * DAY;

    const DIRECTIONS = ['buy', 'sell'];
    const SHIPMENT_STATUS_PAST = '200';
    const SHIPMENT_STATUS_OPEN = '101';
    const STATUS_ARRIVED = 'Arrived';
    const STATUS_CANCELLED = 'Cancelled';
    const FINAL_STATUSES = new Set([STATUS_ARRIVED, 'Not arrived', STATUS_CANCELLED]);

    // Only one build or sync may run at a time, across all tabs
    const LOCK_NAME = 'cm-quick-history';
    // Used by versions <= 0.2.0 to track synced orders
    const LEGACY_SYNCED_ORDERS_LOCAL_STORAGE_KEY = '_cm-helper-synced-orders';

    const LANGUAGE_CODES = {
        'English': 'EN', 'French': 'FR', 'German': 'DE', 'Spanish': 'ES', 'Italian': 'IT', 'S-Chinese': 'ZH',
        'Japanese': 'JP', 'Portuguese': 'PT', 'Russian': 'RU', 'Korean': 'KO', 'T-Chinese': 'TW',
    };

    // Utils
    const logPrefix = '[MonkeyScript-MKM]';
    function log(...args) {
        if (DEBUG) {
            console.log(logPrefix, ...args);
        }
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    /**
     * @returns {{lang: string, game: string, prefix: string}} e.g. prefix "/en/Magic"
     */
    function getPageContext() {
        const [lang, game] = window.location.pathname.split('/').filter(Boolean);
        return { lang, game, prefix: `/${lang}/${game}` };
    }

    function toIsoDate(date) {
        return date.toISOString().split('T')[0];
    }

    /**
     * @param {string} text - containing a date like "27.08.2021", optionally followed by a time like "22:34"
     * @returns {Date|null}
     */
    function parseCmDate(text) {
        const match = text?.match(/(\d{2})\.(\d{2})\.(\d{4})\s*(?:(\d{2}):(\d{2}))?/);
        if (!match) {
            return null;
        }
        const [, day, month, year, hours = '0', minutes = '0'] = match;
        return new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes));
    }

    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // e.g. "07 Aug 2026"
    function formatDate(date) {
        if (!(date instanceof Date)) {
            return '';
        }
        return `${String(date.getDate()).padStart(2, '0')} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
    }

    function formatTimeAgo(date) {
        const minutes = Math.round((Date.now() - date.getTime()) / (60 * 1000));
        if (minutes < 1) {
            return 'just now';
        }
        if (minutes < 60) {
            return `${minutes} min ago`;
        }
        const hours = Math.round(minutes / 60);
        return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
    }

    function formatPrice(price) {
        if (!Number.isFinite(price)) {
            return '';
        }
        return `${price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    }

    // "WeissSchwarz" -> "Weiss Schwarz"
    function formatGameName(gameSlug) {
        return gameSlug.replace(/([a-z])([A-Z])/g, '$1 $2');
    }

    /**
     * @param {string} href - e.g. "/en/Magic/Products/Singles/Magic-2011/Lightning-Bolt?language=1"
     * @returns {string} e.g. "Magic/Products/Singles/Magic-2011/Lightning-Bolt"
     */
    function toProductPath(href) {
        if (!href) {
            return '';
        }
        return new URL(href, window.location.origin).pathname.split('/').filter(Boolean).slice(1).join('/');
    }

    /**
     * @param {Document} doc
     * @returns {string|null} username of the logged in user, null when logged out
     */
    function getLoggedInUsername(doc = document) {
        const account = doc.querySelector('#account-dropdown');
        if (!account) {
            return null;
        }
        const username = account.querySelector('.line-height115 span')?.textContent.trim()
            || account.textContent.split('(')[0].trim();
        return username || null;
    }

    let lastFetchTime = 0;
    /**
     * Fetches and parses a cardmarket page, keeping at least `delay` ms between requests.
     * Throws on anything that isn't the expected page (failed request, Cloudflare check, logged out).
     */
    async function fetchDoc(url, { delay = 0, requireLogin = true } = {}) {
        const waitTime = lastFetchTime + delay - Date.now();
        if (waitTime > 0) {
            await wait(waitTime);
        }
        lastFetchTime = Date.now();

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status} for ${url}`);
        }
        const htmlDoc = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (/just a moment/i.test(htmlDoc.title)) {
            throw new Error('Blocked by a Cloudflare check');
        }
        if (requireLogin && !getLoggedInUsername(htmlDoc)) {
            throw new Error('Not logged in');
        }
        return htmlDoc;
    }

    // Database
    let dbPromise = null;
    function getDb() {
        if (dbPromise) {
            return dbPromise;
        }

        dbPromise = idb.openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                // Versions <= 3 only stored product names per order, the history has to be rebuilt
                for (const legacyStoreName of ['buys', 'sells']) {
                    if (db.objectStoreNames.contains(legacyStoreName)) {
                        db.deleteObjectStore(legacyStoreName);
                    }
                }
                if (!db.objectStoreNames.contains('orders')) {
                    db.createObjectStore('orders', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('items')) {
                    const items = db.createObjectStore('items', { keyPath: 'key' });
                    items.createIndex('productId', 'productId');
                    items.createIndex('productPath', 'productPath');
                }
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta', { keyPath: 'key' });
                }
            },
            blocking() {
                // Don't hold up a newer version of this script (in another tab) upgrading the database
                dbPromise?.then(db => db.close());
                dbPromise = null;
            },
        });

        return dbPromise;
    }

    async function getMeta(key) {
        const db = await getDb();
        return (await db.get('meta', key))?.value;
    }

    async function setMeta(key, value) {
        const db = await getDb();
        await db.put('meta', { key, value });
    }

    async function updateMeta(key, changes) {
        await setMeta(key, { ...(await getMeta(key)), ...changes });
    }

    /**
     * Runs the callback while holding the cross-tab lock.
     * @returns {Promise<boolean>} false if another tab holds the lock, the callback didn't run then.
     */
    async function withLock(callback) {
        if (!navigator.locks) {
            await callback();
            return true;
        }
        return navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async lock => {
            if (!lock) {
                return false;
            }
            await callback();
            return true;
        });
    }

    // Parsing cardmarket pages
    function parseSearchResults(htmlDoc) {
        const ordersTable = htmlDoc.querySelector('#StatusTable');
        if (!ordersTable) {
            // Happens when cardmarket rejects the request (rate limited, invalid date range...)
            const alertText = htmlDoc.querySelector('.alert')?.textContent?.trim();
            throw new Error(alertText || 'No orders table found in response.');
        }

        const orders = [];
        for (const row of ordersTable.querySelectorAll('.table-body > [data-url]')) {
            const id = Number(row.dataset.url.match(/\/Orders\/(\d+)/)?.[1]);
            if (!id) {
                continue;
            }
            orders.push({
                id,
                status: row.querySelector('.col-status')?.textContent.trim() || 'Unknown',
                user: row.querySelector('.col-username')?.textContent.trim() || 'Unknown',
                // Date of the latest status change, not when the order was placed
                statusDate: parseCmDate(row.querySelector('.col-datetime')?.textContent),
            });
        }

        return {
            orders,
            hasNextPage: !!htmlDoc.querySelector('.pagination-control[data-direction=next]:not(.disabled)'),
        };
    }

    function parseOrderPage(htmlDoc, orderId, direction) {
        // The first timeline entry is when the order was placed
        const date = parseCmDate(htmlDoc.querySelector('#Timeline .timeline-box')?.textContent);

        const items = [];
        for (const row of htmlDoc.querySelectorAll('.product-table > tbody > tr[data-article-id]')) {
            const productPath = toProductPath(row.querySelector('a[href*="/Products/"]')?.getAttribute('href'));
            items.push({
                key: `${orderId}:${row.dataset.articleId}`,
                orderId,
                direction,
                productId: Number(row.dataset.productId),
                productPath,
                game: productPath.split('/')[0] || 'Unknown',
                name: row.dataset.name ?? '',
                expansionName: row.dataset.expansionName ?? '',
                number: row.dataset.number ?? '',
                amount: Number(row.dataset.amount) || 1,
                // Per copy
                price: Number(row.dataset.price),
                condition: row.querySelector('.article-condition .badge')?.textContent.trim() ?? '',
                language: row.querySelector('.col-icon [title]')?.getAttribute('title') ?? '',
                extras: [...new Set([...row.querySelectorAll('.extras [title]')].map(icon => icon.getAttribute('title')))],
                // Everything cardmarket exposes, so showing another field later doesn't require a rebuild
                data: { ...row.dataset },
            });
        }

        return { date, items };
    }

    function parseRegistrationDate(htmlDoc) {
        for (const row of htmlDoc.querySelectorAll('.account-info .row')) {
            if (/registration/i.test(row.querySelector('.dt')?.textContent ?? '')) {
                return parseCmDate(row.querySelector('.dd')?.textContent);
            }
        }
        return null;
    }

    // Order history
    /**
     * Stores all orders found in one order search date range. New orders are fetched together with
     * their items, orders we already know only get their status updated.
     */
    async function ingestOrders({ direction, shipmentStatus, fromDate, toDate, delay, onOrderStored }) {
        const db = await getDb();
        const userType = direction === 'buy' ? 'buyer' : 'seller';
        // Order search results include orders of all games, regardless of the game in the URL
        const baseUrl = 'https://www.cardmarket.com/en/Magic/Orders';

        for (let page = 1; ; page++) {
            const url = `${baseUrl}/Search/Results?userType=${userType}&minDate=${toIsoDate(fromDate)}&maxDate=${toIsoDate(toDate)}&shipmentStatus=${shipmentStatus}&site=${page}`;
            const { orders, hasNextPage } = parseSearchResults(await fetchDoc(url, { delay }));

            for (const order of orders) {
                const storedOrder = await db.get('orders', order.id);
                if (storedOrder) {
                    if (storedOrder.status !== order.status || storedOrder.user !== order.user) {
                        await db.put('orders', { ...storedOrder, status: order.status, user: order.user, statusDate: order.statusDate });
                    }
                    continue;
                }

                const orderDoc = await fetchDoc(`${baseUrl}/${order.id}`, { delay });
                const { date, items } = parseOrderPage(orderDoc, order.id, direction);
                if (!items.length) {
                    console.warn(logPrefix, `No items found in order ${order.id}, skipping it.`);
                    continue;
                }
                const tx = db.transaction(['orders', 'items'], 'readwrite');
                tx.objectStore('orders').put({ ...order, direction, date: date ?? order.statusDate });
                for (const item of items) {
                    tx.objectStore('items').put(item);
                }
                await tx.done;
                onOrderStored?.();
            }

            if (!hasNextPage) {
                return;
            }
        }
    }

    /**
     * Clears the local history and prepares a new build. Must run while holding the lock.
     */
    async function startBuild() {
        const username = getLoggedInUsername();
        if (!username) {
            throw new Error('Log in to build your history');
        }
        const registrationDate = parseRegistrationDate(await fetchDoc('https://www.cardmarket.com/en/Magic/Account'));
        if (!registrationDate) {
            throw new Error('No registration date found on the account page');
        }

        const db = await getDb();
        const tx = db.transaction(['orders', 'items', 'meta'], 'readwrite');
        await Promise.all([
            tx.objectStore('orders').clear(),
            tx.objectStore('items').clear(),
            tx.objectStore('meta').clear(),
            tx.done,
        ]);

        const now = new Date();
        await setMeta('owner', username);
        // The build walks back from now, syncs pick up everything after it started
        await setMeta('build', { startedAt: now, cursor: now, registrationDate, done: false });
        await setMeta('sync', { syncedTo: now, lastAttemptAt: now, lastSuccessAt: null, lastError: null });
    }

    /**
     * Fetches orders from the build cursor back to the registration date, newest first.
     * Progress is saved after each date range, so an interrupted build continues where it stopped.
     * Must run while holding the lock.
     */
    async function continueBuild({ onOrderStored, onRangeDone, onRetry }) {
        let build = await getMeta('build');
        const lastDate = new Date(build.registrationDate.getTime() - DAY);

        while (!build.done) {
            const toDate = build.cursor;
            const fromDate = new Date(Math.max(toDate.getTime() - SEARCH_WINDOW, lastDate.getTime()));
            for (const direction of DIRECTIONS) {
                for (const shipmentStatus of [SHIPMENT_STATUS_PAST, SHIPMENT_STATUS_OPEN]) {
                    await withRetries(
                        () => ingestOrders({ direction, shipmentStatus, fromDate, toDate, delay: BUILD_DELAY_BETWEEN_FETCHES, onOrderStored }),
                        onRetry,
                    );
                }
            }
            build = { ...build, cursor: fromDate, done: fromDate.getTime() <= lastDate.getTime() };
            await setMeta('build', build);
            onRangeDone?.(build);
        }
    }

    async function withRetries(callback, onRetry) {
        for (let attempt = 1; ; attempt++) {
            try {
                return await callback();
            } catch (error) {
                if (attempt > BUILD_MAX_RETRIES) {
                    throw error;
                }
                onRetry?.(error, attempt);
                await wait(BUILD_RETRY_DELAY);
            }
        }
    }

    /**
     * @returns {Promise<'not-built'|'logged-out'|'other-account'|null>} why syncing isn't possible, null if it is
     */
    async function getSyncBlocker() {
        if (!(await getMeta('build'))) {
            return 'not-built';
        }
        const username = getLoggedInUsername();
        if (!username) {
            return 'logged-out';
        }
        return (await getMeta('owner')) === username ? null : 'other-account';
    }

    async function isSyncDue() {
        const lastAttemptAt = (await getMeta('sync'))?.lastAttemptAt;
        return !lastAttemptAt || Date.now() - lastAttemptAt.getTime() >= SYNC_INTERVAL;
    }

    /**
     * Fetches orders placed or changed since the last sync, and refreshes the status of open orders.
     * @param {{force?: boolean, onStart?: Function}} options - force skips the sync interval check
     * @returns {Promise<'synced'|'failed'|'not-due'|'busy'|'unavailable'>}
     */
    async function syncHistory({ force = false, onStart } = {}) {
        if (await getSyncBlocker()) {
            return 'unavailable';
        }
        if (!force && !(await isSyncDue())) {
            return 'not-due';
        }

        let result = 'busy';
        await withLock(async () => {
            // Another tab might have synced while we were waiting
            if (!force && !(await isSyncDue())) {
                result = 'not-due';
                return;
            }
            const startedAt = new Date();
            // Recorded at the start, so quickly moving between pages doesn't restart syncs
            await updateMeta('sync', { lastAttemptAt: startedAt });
            onStart?.();

            try {
                // Cover the oldest open order too, so its status change shows up in the search results
                const db = await getDb();
                const openOrderDates = (await db.getAll('orders'))
                    .filter(order => !FINAL_STATUSES.has(order.status) && order.date)
                    .map(order => order.date.getTime());
                const { syncedTo } = await getMeta('sync');
                const fromTime = Math.min(syncedTo.getTime(), ...openOrderDates) - DAY;

                for (let windowStart = fromTime; windowStart < startedAt.getTime(); windowStart += SEARCH_WINDOW) {
                    for (const direction of DIRECTIONS) {
                        for (const shipmentStatus of [SHIPMENT_STATUS_PAST, SHIPMENT_STATUS_OPEN]) {
                            await ingestOrders({
                                direction,
                                shipmentStatus,
                                fromDate: new Date(windowStart),
                                toDate: new Date(windowStart + SEARCH_WINDOW),
                                delay: SYNC_DELAY_BETWEEN_FETCHES,
                            });
                        }
                    }
                }
                await updateMeta('sync', { syncedTo: startedAt, lastSuccessAt: new Date(), lastError: null });
                result = 'synced';
            } catch (error) {
                await updateMeta('sync', { lastError: error.message });
                result = 'failed';
            }
        });
        return result;
    }

    /**
     * @returns {Promise<Array<Object>>} items with their `order` attached, newest first
     */
    async function attachOrders(ordersStore, items) {
        const orderIds = [...new Set(items.map(item => item.orderId))];
        const orders = new Map(
            (await Promise.all(orderIds.map(id => ordersStore.get(id))))
                .filter(Boolean)
                .map(order => [order.id, order])
        );
        return items
            .filter(item => orders.has(item.orderId))
            .map(item => ({ ...item, order: orders.get(item.orderId) }))
            .sort((a, b) => (b.order.date - a.order.date) || (b.orderId - a.orderId));
    }

    async function findItemsOfProducts({ productIds, productPaths }) {
        const db = await getDb();
        const tx = db.transaction(['items', 'orders']);
        const itemsStore = tx.objectStore('items');
        const matches = await Promise.all([
            ...[...productIds].map(productId => itemsStore.index('productId').getAll(productId)),
            ...[...productPaths].map(productPath => itemsStore.index('productPath').getAll(productPath)),
        ]);
        const itemsByKey = new Map(matches.flat().map(item => [item.key, item]));
        return attachOrders(tx.objectStore('orders'), [...itemsByKey.values()]);
    }

    /**
     * @param {string} needle - lower case part of a product name
     * @param {'both'|'buy'|'sell'} direction
     */
    async function searchItems(needle, direction) {
        const db = await getDb();
        const tx = db.transaction(['items', 'orders']);
        const items = (await tx.objectStore('items').getAll()).filter(item =>
            item.name.toLowerCase().includes(needle) && (direction === 'both' || item.direction === direction)
        );
        return attachOrders(tx.objectStore('orders'), items);
    }

    // UI
    function injectStyles() {
        if (document.getElementById('_cm-helper-styles')) {
            return;
        }
        document.head.insertAdjacentHTML('beforeend', `
            <style id="_cm-helper-styles">
                ._cm-helper-container {
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                    margin-bottom: 1rem;
                    border: 1px solid #ccc;
                    border-radius: 8px;
                    padding: 1rem;
                }

                ._cm-helper-controls {
                    display: flex;
                    flex-direction: row;
                    flex-wrap: wrap;
                    gap: 1rem;
                    justify-content: space-between;
                }

                ._cm-helper-sync-controls {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    gap: 0.25rem;
                    max-width: 28rem;
                }

                ._cm-helper-buttons {
                    display: flex;
                    gap: 0.5rem;
                }

                ._cm-helper-search-form {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                }

                ._cm-helper-history-type-controls {
                    display: flex;
                    gap: 0.5rem;
                    align-items: center;
                }

                ._cm-helper-search-controls {
                    height: fit-content;
                    display: flex;
                    gap: 0.5rem;
                    align-items: center;
                }

                #_cm-helper-status {
                    font-family: ui-monospace, monospace;
                    font-size: 0.875rem;
                }

                ._cm-helper-table-wrap {
                    overflow-x: auto;
                    margin: 0.5rem 0;
                }

                ._cm-helper-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 0.875rem;
                }

                ._cm-helper-table th,
                ._cm-helper-table td {
                    padding: 0.25rem 0.5rem;
                    text-align: left;
                    white-space: nowrap;
                    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
                }

                ._cm-helper-table ._cm-helper-number {
                    text-align: right;
                }

                ._cm-helper-table td._cm-helper-printing {
                    white-space: normal;
                    min-width: 14rem;
                }

                ._cm-helper-table tr._cm-helper-buy td {
                    background-color: rgba(25, 135, 84, 0.12);
                }

                ._cm-helper-table tr._cm-helper-sell td {
                    background-color: rgba(220, 53, 69, 0.1);
                }

                ._cm-helper-table tr._cm-helper-this-printing td {
                    font-weight: 600;
                }

                ._cm-helper-table tr._cm-helper-this-printing td:first-child {
                    box-shadow: inset 4px 0 0 #0d6efd;
                }

                ._cm-helper-table tr._cm-helper-cancelled td {
                    opacity: 0.45;
                }

                ._cm-helper-muted {
                    color: #6c757d;
                    font-size: 0.8em;
                }

                ._cm-helper-summary {
                    font-weight: 600;
                }

                ._cm-helper-note {
                    background-color: rgba(255, 193, 7, 0.15);
                    border-radius: 4px;
                    padding: 0.25rem 0.5rem;
                    margin-bottom: 0.5rem;
                }

                ._cm-helper-footer {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0.5rem;
                    align-items: center;
                    color: #6c757d;
                    margin: 0.5rem 0;
                }
            </style>
        `);
    }

    function renderHistoryTable(rows, { highlightProductId = null, showGame = false } = {}) {
        const { lang, prefix } = getPageContext();
        const showExtras = rows.some(row => row.extras?.length);
        const showStatus = rows.some(row => row.order.status !== STATUS_ARRIVED);

        const columns = [
            { title: 'Date', render: row => formatDate(row.order.date) },
            { title: 'Type', render: row => row.direction === 'buy' ? 'Buy' : 'Sell' },
            { title: 'Qty', render: row => row.amount, className: '_cm-helper-number' },
            showGame && { title: 'Game', render: row => escapeHtml(formatGameName(row.game)) },
            {
                title: 'Printing',
                className: '_cm-helper-printing',
                render: row => {
                    const name = escapeHtml(row.name);
                    const details = [row.expansionName, row.number && `#${row.number}`].filter(Boolean).join(' · ');
                    return (row.productPath ? `<a href="/${lang}/${escapeHtml(row.productPath)}">${name}</a>` : name)
                        + (details ? ` <span class="_cm-helper-muted">${escapeHtml(details)}</span>` : '');
                },
            },
            { title: 'Cond', render: row => escapeHtml(row.condition) },
            {
                title: 'Lang',
                render: row => `<span title="${escapeHtml(row.language)}">${escapeHtml(LANGUAGE_CODES[row.language] ?? row.language)}</span>`,
            },
            showExtras && { title: 'Extras', render: row => escapeHtml((row.extras ?? []).join(', ')) },
            { title: 'Price', render: row => formatPrice(row.price), className: '_cm-helper-number' },
            {
                title: 'User',
                render: row => `<a href="${prefix}/Users/${encodeURIComponent(row.order.user)}">${escapeHtml(row.order.user)}</a>`,
            },
            { title: 'Order', render: row => `<a href="${prefix}/Orders/${row.order.id}">#${row.order.id}</a>` },
            showStatus && { title: 'Status', render: row => row.order.status === STATUS_ARRIVED ? '' : escapeHtml(row.order.status) },
        ].filter(Boolean);

        const bodyRows = rows.map(row => {
            const classNames = [
                `_cm-helper-${row.direction}`,
                row.productId === highlightProductId ? '_cm-helper-this-printing' : '',
                row.order.status === STATUS_CANCELLED ? '_cm-helper-cancelled' : '',
            ].filter(Boolean).join(' ');
            const cells = columns.map(column => `<td class="${column.className ?? ''}">${column.render(row)}</td>`);
            return `<tr class="${classNames}">${cells.join('')}</tr>`;
        });

        return `
            <div class="_cm-helper-table-wrap">
                <table class="_cm-helper-table">
                    <thead><tr>${columns.map(column => `<th class="${column.className ?? ''}">${column.title}</th>`).join('')}</tr></thead>
                    <tbody>${bodyRows.join('')}</tbody>
                </table>
            </div>`;
    }

    function countCopies(rows, direction) {
        return rows
            .filter(row => row.direction === direction && row.order.status !== STATUS_CANCELLED)
            .reduce((total, row) => total + row.amount, 0);
    }

    /**
     * @returns {string[]} status lines about the sync state, shared by the orders and product pages
     */
    async function describeSyncState({ syncing, busyElsewhere, includeBuildProgress = false }) {
        const [build, sync, owner] = await Promise.all([getMeta('build'), getMeta('sync'), getMeta('owner')]);
        const username = getLoggedInUsername();
        const lines = [];

        if (syncing) {
            lines.push('Syncing…');
        } else if (sync) {
            const syncedAt = sync.lastSuccessAt ?? sync.syncedTo;
            lines.push(`Synced ${formatTimeAgo(syncedAt)}`);
            if (sync.lastError && (!sync.lastSuccessAt || sync.lastAttemptAt > sync.lastSuccessAt)) {
                lines.push(`Last sync failed: ${sync.lastError}`);
            }
        }
        if (includeBuildProgress && build && !build.done) {
            lines.push(`History built back to ${formatDate(build.cursor)}`);
        }
        if (busyElsewhere) {
            lines.push('A build or sync is running in another tab');
        }
        if (!username) {
            lines.push('Log in to sync');
        } else if (owner && owner !== username) {
            lines.push(`This history belongs to ${owner}, syncing is disabled while logged in as ${username}`);
        }
        return lines;
    }

    // Product page: "My History" tab
    function findVersionsPath() {
        for (const link of document.querySelectorAll('a[href*="/Cards/"]')) {
            const path = new URL(link.href).pathname;
            if (/\/Cards\/[^/]+\/Versions$/.test(path)) {
                return path;
            }
        }
        return null;
    }

    /**
     * @param {string} versionsPath - e.g. "/en/Magic/Cards/Lightning-Bolt/Versions"
     * @returns {Promise<{productIds: Set<number>, productPaths: Set<string>}>}
     */
    async function fetchVersions(versionsPath) {
        const htmlDoc = await fetchDoc(versionsPath, { requireLogin: false });
        const productIds = new Set();
        const productPaths = new Set();
        for (const card of htmlDoc.querySelectorAll('a.card')) {
            const image = card.querySelector('img');
            // Product images are lazy loaded from ".../<productId>/<productId>.jpg"
            const imageUrl = image?.getAttribute('data-echo') || image?.getAttribute('src') || '';
            const productId = Number(imageUrl.match(/\/(\d+)\/\d+\.\w+(?:\?.*)?$/)?.[1]);
            if (productId) {
                productIds.add(productId);
            } else if (card.getAttribute('href')) {
                productPaths.add(toProductPath(card.getAttribute('href')));
            }
        }
        if (!productIds.size && !productPaths.size) {
            throw new Error('No versions found');
        }
        return { productIds, productPaths };
    }

    async function initProductPage() {
        const tabList = document.querySelector('ul[role=tablist].nav-tabs');
        const productId = Number(document.querySelector('input[name=idProduct]')?.value);
        const paneContainer = document.querySelector('.tab-content > .tab-pane')?.parentElement;
        if (!tabList || !productId || !paneContainer) {
            return;
        }
        try {
            await getDb();
        } catch (error) {
            log('IndexedDB unavailable', error);
            return;
        }

        injectStyles();
        tabList.insertAdjacentHTML('beforeend', `
            <li class="nav-item tab-my-history" role="presentation">
                <a href="#tabContent-my-history" data-bs-toggle="tab" role="tab" aria-controls="tabContent-my-history" aria-selected="false" class="nav-link">
                    <span class="fonticon-purchases"></span>
                    <span class="nav-link-title"><span id="_cm-helper-tab-label">My History</span></span>
                </a>
            </li>
        `);
        paneContainer.insertAdjacentHTML('beforeend', `
            <div id="tabContent-my-history" class="tab-pane d-none h-100 px-3 pt-3" role="tabpanel"></div>
        `);
        const label = document.getElementById('_cm-helper-tab-label');
        const pane = document.getElementById('tabContent-my-history');

        const versionsPath = findVersionsPath();
        const state = {
            productId,
            // null: product without versions, 'loading', 'failed' or {productIds, productPaths}
            versions: versionsPath ? 'loading' : null,
            syncing: false,
            busyElsewhere: false,
        };

        let renderCount = 0;
        const render = async () => {
            const renderId = ++renderCount;
            try {
                const { labelText, html } = await renderProductHistory(state);
                // A newer render started meanwhile
                if (renderId !== renderCount) {
                    return;
                }
                label.textContent = labelText;
                pane.innerHTML = html;
            } catch (error) {
                pane.textContent = `[ERROR] ${error.message}`;
            }
        };

        const runSync = async force => {
            const result = await syncHistory({
                force,
                onStart: () => {
                    state.syncing = true;
                    render();
                },
            });
            state.syncing = false;
            state.busyElsewhere = result === 'busy';
            await render();
        };

        pane.addEventListener('click', event => {
            if (event.target.closest('._cm-helper-sync-now')) {
                runSync(true);
            }
        });

        await render();
        if (versionsPath) {
            try {
                state.versions = await fetchVersions(versionsPath);
            } catch (error) {
                log('Fetching versions failed', error);
                state.versions = 'failed';
            }
            await render();
        }
        await runSync(false);
    }

    /**
     * @returns {Promise<{labelText: string, html: string}>}
     */
    async function renderProductHistory(state) {
        const { prefix } = getPageContext();
        const build = await getMeta('build');
        if (!build) {
            return {
                labelText: 'My History',
                html: `<p>No local order history yet. <a href="${prefix}/Orders/Search?userType=buyer">Build your history on the Orders page</a> to see your buys and sells of this card here.</p>`,
            };
        }
        if (state.versions === 'loading') {
            return { labelText: 'My History (…)', html: '<p>Loading…</p>' };
        }

        const matchesVersions = !!state.versions && state.versions !== 'failed';
        const rows = await findItemsOfProducts(matchesVersions
            ? { productIds: new Set([...state.versions.productIds, state.productId]), productPaths: state.versions.productPaths }
            : { productIds: new Set([state.productId]), productPaths: new Set() });

        const notes = [];
        if (state.versions === 'failed') {
            notes.push("Couldn't load the other versions of this card, showing this printing only.");
        }
        if (!build.done) {
            notes.push(`History built back to ${formatDate(build.cursor)}. The build continues while an Orders search page is open.`);
        }

        const bought = countCopies(rows, 'buy');
        const sold = countCopies(rows, 'sell');
        let content;
        if (!rows.length) {
            content = `<p>No buys or sells of ${matchesVersions ? 'any version of this card' : 'this product'}.</p>`;
        } else {
            let summary = `Bought ${bought} · Sold ${sold}`;
            const thisPrintingRows = rows.filter(row => row.productId === state.productId);
            const thisPrintingBought = countCopies(thisPrintingRows, 'buy');
            const thisPrintingSold = countCopies(thisPrintingRows, 'sell');
            if (matchesVersions && (thisPrintingBought !== bought || thisPrintingSold !== sold)) {
                const parts = [
                    thisPrintingBought && `bought ${thisPrintingBought}`,
                    thisPrintingSold && `sold ${thisPrintingSold}`,
                ].filter(Boolean);
                summary += ` (this printing: ${parts.join(', ') || 'none'})`;
            }
            content = `
                <div class="_cm-helper-summary">${summary}</div>
                ${renderHistoryTable(rows, { highlightProductId: matchesVersions ? state.productId : null })}`;
        }

        const syncLines = await describeSyncState(state);
        const canSync = !state.syncing && !(await getSyncBlocker());
        return {
            labelText: bought || sold ? `My History (+${bought}/-${sold})` : 'My History',
            html: `
                ${notes.map(note => `<div class="_cm-helper-note small">${escapeHtml(note)}</div>`).join('')}
                ${content}
                <div class="_cm-helper-footer small">
                    <span>${syncLines.map(escapeHtml).join(' · ')}</span>
                    ${canSync ? '<button type="button" class="btn btn-sm btn-secondary _cm-helper-sync-now">Sync now</button>' : ''}
                </div>`,
        };
    }

    // Orders search page
    let clearStatusTimeoutId = null;
    function updateStatus(status) {
        clearTimeout(clearStatusTimeoutId);
        log(status);
        document.getElementById('_cm-helper-status').innerText = status;
        clearStatusTimeoutId = setTimeout(() => {
            document.getElementById('_cm-helper-status').innerText = '';
        }, 30 * 1000);
    }

    async function initOrdersPage() {
        const container = document.getElementById('OrderSearchForm');
        if (!container) {
            // The broad @match also covers pages without the search form (e.g. /Orders/Search/Results)
            return;
        }

        injectStyles();
        container.insertAdjacentHTML('beforebegin', `
            <div class="_cm-helper-container">
                <h2>Quick History Search (TM Script)</h2>
                <div class="_cm-helper-controls">
                    <form id="_cm-helper-search-form" class="_cm-helper-search-form">
                        <span class="small">
                            Search by any part of the name — "Bolt" will find "Lightning Bolt".
                            <br>Searches your orders of all games.
                        </span>
                        <div class="_cm-helper-search-controls">
                            <input type="text" id="_cm-helper-product-name" class="form-control" placeholder="Product name">
                            <button type="submit" class="btn btn-primary">Search</button>
                        </div>
                        <div class="_cm-helper-history-type-controls">
                            <input type="radio" id="_cm-helper-both" name="_cm-helper-history-type" value="both" checked>
                            <label for="_cm-helper-both">Buys and sells</label>
                            <input type="radio" id="_cm-helper-buys" name="_cm-helper-history-type" value="buy">
                            <label for="_cm-helper-buys">Buys</label>
                            <input type="radio" id="_cm-helper-sells" name="_cm-helper-history-type" value="sell">
                            <label for="_cm-helper-sells">Sells</label>
                        </div>
                    </form>
                    <div class="_cm-helper-sync-controls">
                        <div class="small" id="_cm-helper-sync-status"></div>
                        <div class="_cm-helper-buttons">
                            <button type="button" class="btn btn-sm btn-secondary" id="_cm-helper-sync-now">Sync now</button>
                            <button type="button" class="btn btn-sm btn-secondary" id="_cm-helper-rebuild-history">Rebuild history</button>
                        </div>
                    </div>
                </div>

                <div id="_cm-helper-status"></div>
                <div id="_cm-helper-results"></div>
            </div>
        `);

        const syncStatus = document.getElementById('_cm-helper-sync-status');
        const syncButton = document.getElementById('_cm-helper-sync-now');
        const buildButton = document.getElementById('_cm-helper-rebuild-history');
        // task: null, 'build' or 'sync'
        const state = { task: null, busyElsewhere: false, ordersStored: 0 };

        const renderSyncStatus = async () => {
            const build = await getMeta('build');
            const blocker = await getSyncBlocker();
            if (!build) {
                syncStatus.innerHTML = `
                    <strong>Before using quick history search, build a local copy of your history first.</strong>
                    <br>This fetches all your orders once and takes a while (roughly 1–2 hours for 1,500 orders).
                    Keep this page open, if it gets interrupted it continues the next time you open it.`;
            } else {
                const lines = await describeSyncState({
                    syncing: state.task === 'sync',
                    busyElsewhere: state.busyElsewhere,
                    includeBuildProgress: true,
                });
                if (state.task === 'build') {
                    lines.unshift(`Building history, ${state.ordersStored} orders fetched so far…`);
                }
                syncStatus.innerHTML = lines.map(escapeHtml).join('<br>');
            }
            buildButton.innerText = build ? 'Rebuild history' : 'Build history';
            buildButton.disabled = !!state.task || !getLoggedInUsername();
            syncButton.hidden = !build;
            syncButton.disabled = !!state.task || !!blocker;
        };

        const runBuild = async fresh => {
            const acquired = await withLock(async () => {
                state.task = 'build';
                state.busyElsewhere = false;
                state.ordersStored = 0;
                await renderSyncStatus();
                try {
                    if (fresh) {
                        updateStatus('Clearing local history...');
                        await startBuild();
                    }
                    await continueBuild({
                        onOrderStored: () => {
                            state.ordersStored++;
                            renderSyncStatus();
                        },
                        onRangeDone: () => renderSyncStatus(),
                        onRetry: (error, attempt) => updateStatus(
                            `Request failed (${error.message}), retrying in ${BUILD_RETRY_DELAY / 1000} s (${attempt}/${BUILD_MAX_RETRIES})...`
                        ),
                    });
                    updateStatus('History built');
                } catch (error) {
                    updateStatus(`[ERROR] Build stopped: ${error.message}. It continues the next time you open this page.`);
                } finally {
                    state.task = null;
                }
            });
            state.busyElsewhere = !acquired;
            await renderSyncStatus();
        };

        const runSync = async force => {
            const result = await syncHistory({
                force,
                onStart: () => {
                    state.task = 'sync';
                    renderSyncStatus();
                },
            });
            state.task = null;
            state.busyElsewhere = result === 'busy';
            await renderSyncStatus();
        };

        buildButton.addEventListener('click', async () => {
            if (await getMeta('build')) {
                const confirmed = confirm(
                    'Rebuild your order history?\n\n' +
                    'This clears the local history and fetches all your orders again, which takes a while depending on the number of orders and your account age.'
                );
                if (!confirmed) {
                    return;
                }
            }
            await runBuild(true);
        });
        syncButton.addEventListener('click', () => runSync(true));

        document.getElementById('_cm-helper-search-form').addEventListener('submit', async e => {
            e.preventDefault();
            const needle = document.getElementById('_cm-helper-product-name').value.toLowerCase().trim();
            const direction = document.querySelector('input[name=_cm-helper-history-type]:checked').value;
            const results = document.getElementById('_cm-helper-results');
            if (!needle) {
                results.innerHTML = '';
                return;
            }
            const rows = await searchItems(needle, direction);
            if (!rows.length) {
                results.innerHTML = '<p>No matches.</p>';
                return;
            }
            const cappedNote = rows.length > SEARCH_RESULTS_LIMIT
                ? `<div class="small">Showing the newest ${SEARCH_RESULTS_LIMIT} of ${rows.length} matches</div>`
                : '';
            results.innerHTML = cappedNote + renderHistoryTable(rows.slice(0, SEARCH_RESULTS_LIMIT), { showGame: true });
        });

        await renderSyncStatus();
        const build = await getMeta('build');
        if (build && !build.done && !(await getSyncBlocker())) {
            await runBuild(false);
        } else {
            await runSync(false);
        }
    }

    // Initialize
    try {
        localStorage.removeItem(LEGACY_SYNCED_ORDERS_LOCAL_STORAGE_KEY);
    } catch {}

    if (window.location.pathname.includes('/Orders/Search')) {
        initOrdersPage();
    } else if (window.location.pathname.includes('/Products/')) {
        initProductPage();
    }
})();
