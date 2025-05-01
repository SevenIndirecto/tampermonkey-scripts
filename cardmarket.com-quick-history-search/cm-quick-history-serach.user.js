// ==UserScript==
// @name         Cardmarket.com Quick Order History Search
// @version      0.1.5
// @description  Creates a local browser database of all your cardmarket.com orders, allowing you to search through them quickly.
// @author       seven
// @namespace    https://raw.githubusercontent.com/SevenIndirecto/tampermonkey-scripts/refs/heads/master/cardmarket.com-quick-history-search
// @updateURL    https://raw.githubusercontent.com/SevenIndirecto/tampermonkey-scripts/refs/heads/master/cardmarket.com-quick-history-search/cm-quick-history-search.user.js
// @downloadURL  https://raw.githubusercontent.com/SevenIndirecto/tampermonkey-scripts/refs/heads/master/cardmarket.com-quick-history-search/cm-quick-history-search.user.js
// @match        https://www.cardmarket.com/*/*/Orders/Search?userType=buyer
// @match        https://www.cardmarket.com/*/*/Orders/Search?userType=seller
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cardmarket.com
// @require      https://cdn.jsdelivr.net/npm/idb@8/build/umd.js
// @grant        none
// ==/UserScript==


(function () {
    // Config
    const CONFIG_DELAY_BETWEEN_FETCHES = 3000; // in milliseconds
    const DEBUG = true;

    // IndexedDB stores
    const STORE_NAME_BUYS = 'buys';
    const STORE_NAME_SELLS = 'sells';

    const SYNCED_TO_DATE_KEY = '_synced-to-date';

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

    /**
     * @param {string} dateString - format "25.04.2025"
     * @returns {Date}
     */
    function cmcDateStringToDate(dateString) {
        return new Date(dateString.split('.').reverse().join('-'));
    }

    function formatDate(date) {
        if (date instanceof Date) {
            return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
        }
        return date;
    }

    let clearStatusTimeoutId = null;
    function clearStatusAfterNSeconds(n) {
        if (clearStatusTimeoutId) {
            clearTimeout(clearStatusTimeoutId);
        }
        clearStatusTimeoutId = setTimeout(() => {
            document.getElementById('_cm-helper-status').innerText = '';
        }, n * 1000);
    }

    function updateStatus(status) {
        clearTimeout(clearStatusTimeoutId);
        if (DEBUG) {
            console.log(status);
        }
        document.getElementById('_cm-helper-status').innerText = status;
        if (!document.hidden) {
            clearStatusAfterNSeconds(30);
        }
    }

    async function updateSyncStatusDisplay() {
        const db = await getDb();
        const buysSyncedTo = (await db.get(STORE_NAME_BUYS, SYNCED_TO_DATE_KEY))?.date ?? 'not synced yet';
        const sellsSyncedTo = (await db.get(STORE_NAME_SELLS, SYNCED_TO_DATE_KEY))?.date ?? 'not synced yet';

        if (!(buysSyncedTo instanceof Date) && !(sellsSyncedTo instanceof Date)) {
            document.getElementById('_cm-helper-sync-status').innerHTML = `
                <strong>Before using quick history search, <br>build a local copy of your history first.</strong>`;
            document.getElementById('_cm-helper-rebuild-history').innerText = 'Build history';
        } else {
            document.getElementById('_cm-helper-sync-status').innerHTML = `
            <strong 
                class="_cm-helper-sync-status-tooltip"
                title="History is automatically synced every time you visit this page, starting 44 days before the latest sync date, and up to today. Executed at most once per 4 hours."
            >
                Sync status
            </strong>
            <br>Buys: ${formatDate(buysSyncedTo)} 
            <br>Sells: ${formatDate(sellsSyncedTo)}`;
        }
    }

    // Quick order history
    async function rebuildHistory(storeName) {
        const db = await getDb();
        updateStatus(`Clearing ${storeName} history...`);
        await db.clear(storeName);

        // Get user registration date
        const url = 'https://www.cardmarket.com/en/Magic/Account';
        const response = await fetch(url);
        const data = await response.text();

        updateStatus('Fetching registration date...');
        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(data, 'text/html');
        const registrationDateStr = htmlDoc.querySelector('.account-info .row:nth-child(3) div:nth-child(2)').innerText;
        if (!registrationDateStr) {
            updateStatus('[ERROR] No registration date found. Aborting.');
            return;
        }
        const registrationDate = cmcDateStringToDate(registrationDateStr);

        // Fetch orders from registration date to today
        const todayTime = new Date().getTime();
        // Fetch history in increments of 2 months... using 29 days per month due to February and CMS actually limiting to months
        const increment = 2 * 29 * 24 * 60 * 60 * 1000;
        for (let fromTime = registrationDate.getTime(); fromTime <= todayTime; fromTime += increment) {
            const fromDate = new Date(fromTime);
            const toDate = new Date(fromTime + increment);
            await fetchAndStoreOrders(fromDate, toDate, storeName);
            await db.put(storeName, { key: SYNCED_TO_DATE_KEY, date: toDate > new Date() ? new Date() : toDate });
            await wait(CONFIG_DELAY_BETWEEN_FETCHES);
        }
        updateStatus('History rebuilt');
        updateSyncStatusDisplay();
    }

    /**
     * @param {Date} fromDate 
     * @param {Date} toDate 
     * @param {string} storeName 
     */
    async function fetchAndStoreOrders(fromDate, toDate, storeName, displayStatusUpdates = true, delayBetweenFetches = CONFIG_DELAY_BETWEEN_FETCHES) {
        if (displayStatusUpdates) {
            updateStatus(`Fetching orders from ${formatDate(fromDate)} to ${formatDate(toDate)}...`);
        }
        const userType = storeName === STORE_NAME_BUYS ? 'buyer' : 'seller';
        const baseUrl = 'https://www.cardmarket.com/en/Magic/Orders/Search/Results';

        const fromDateStr = fromDate.toISOString().split('T')[0];
        const toDateStr = toDate.toISOString().split('T')[0];

        const SHIPMENT_STATUS_PAST = '200';
        const url = `${baseUrl}?userType=${userType}&minDate=${fromDateStr}&maxDate=${toDateStr}&shipmentStatus=${SHIPMENT_STATUS_PAST}`;

        const response = await fetch(url);
        const data = await response.text();

        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(data, 'text/html');
        const ordersTable = htmlDoc.querySelector('#StatusTable');
        const rows = ordersTable.querySelectorAll('.table-body > div');

        for (const [index, row] of rows.entries()) {
            if (displayStatusUpdates) {
                updateStatus(`Processing order ${index + 1} of ${rows.length} from ${formatDate(fromDate)} to ${formatDate(toDate)}...`);
            }
            const orderUrl = row.dataset.url;
            const status = row.querySelector('.col-status div')?.innerText ?? 'Unknown';
            const user = row.querySelector('.seller-name span:nth-child(2) span')?.innerText ?? 'Unknown';
            const dateStr = row.querySelector('.col-datetime span')?.innerText ?? null;
            const date = dateStr ? cmcDateStringToDate(dateStr) : new Date();

            const products = await fetchOrderProducts(orderUrl, delayBetweenFetches);
            await storeOrderToDb({ products, orderUrl, status, user, date }, storeName, delayBetweenFetches);
            await wait(delayBetweenFetches);
        }
    }

    /**
     * @param {string} orderUrl - relative url, e.g. "/en/Magic/Orders/1234567890"
     * @returns {Promise<string[]>}
     */
    async function fetchOrderProducts(orderUrl) {
        const url = `https://www.cardmarket.com${orderUrl}`;
        const response = await fetch(url);
        const data = await response.text();

        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(data, 'text/html');
        const productRows = htmlDoc.querySelectorAll('.product-table > tbody > tr');

        const products = new Set();
        for (const productRow of productRows) {
            products.add(productRow.dataset.name);
        }
        return Array.from(products);
    }

    let dbSingleton = null;
    async function getDb() {
        if (dbSingleton) {
            return dbSingleton;
        }

        const dbName = 'cardmarket-orders';
        const dbVersion = 3;

        dbSingleton = await idb.openDB(dbName, dbVersion, {
            upgrade(db, oldVersion, newVersion, transaction, event) {
                const objectStoreProperties = {
                    // The key will be a lower-case string of the article name
                    keyPath: 'key',
                };
                db.createObjectStore(STORE_NAME_BUYS, objectStoreProperties);
                db.createObjectStore(STORE_NAME_SELLS, objectStoreProperties);
            },
            blocked(currentVersion, blockedVersion, event) {
                log('blocked', currentVersion, blockedVersion, event);
            },
            blocking(currentVersion, blockedVersion, event) {
                log('blocking', currentVersion, blockedVersion, event);
            },
            terminated() {
                log('terminated');
            },
        });

        return dbSingleton;
    }

    function setRebuildHistoryButtonDisabledState(disabled) {
        const button = document.getElementById('_cm-helper-rebuild-history');
        if (disabled) {
            button.classList.add('_cm-helper-disabled');
        } else {
            button.classList.remove('_cm-helper-disabled');
        }
    }

    async function autoSync(currentStoreName) {
        setRebuildHistoryButtonDisabledState(true);

        let storeSyncOrder = [STORE_NAME_BUYS, STORE_NAME_SELLS];
        if (currentStoreName === STORE_NAME_SELLS) {
            storeSyncOrder.reverse();
        }

        const previousBuiltHistoryButtonText = document.getElementById('_cm-helper-rebuild-history')?.innerText;

        let intervalsFetched = 0;
        const db = await getDb();
        for (const storeName of storeSyncOrder) {
            const syncedToDate = (await db.get(storeName, SYNCED_TO_DATE_KEY))?.date;
            // If no sync yet or if synced to date was less than 4 hours ago, skip
            if (!syncedToDate || (new Date().getTime() - syncedToDate.getTime()) < 4 * 60 * 60 * 1000) {
                continue;
            }
            document.getElementById('_cm-helper-rebuild-history').innerText = 'Auto-syncing...';

            log(`Auto-syncing ${storeName} from ${formatDate(syncedToDate)} to today...`);
            // Start syncing 44 days before sync date, up to today in increments of 58 days. 
            // Assuming the user logs in at least once every 14 days, they'll sync one "2 month update period" per store.
            const startTime = syncedToDate.getTime() - 44 * 24 * 60 * 60 * 1000;
            const endTime = Date.now();
            const increment = 58 * 24 * 60 * 60 * 1000;
            for (let fromTime = startTime; fromTime < endTime; fromTime += increment) {
                // Fetch in intervals of 1000ms for the first 2 intervals, then back to normal delay
                const delayBetweenFetches = intervalsFetched < 2 ? 1000 : CONFIG_DELAY_BETWEEN_FETCHES;
                const toDate = new Date(fromTime + increment);
                await fetchAndStoreOrders(new Date(fromTime), toDate, storeName, false, delayBetweenFetches);
                await db.put(storeName, { key: SYNCED_TO_DATE_KEY, date: toDate > new Date() ? new Date() : toDate });
                intervalsFetched++;
            }
            log(`Auto-synced ${storeName} from ${formatDate(syncedToDate)} to today`);
        }

        if (previousBuiltHistoryButtonText) {
            document.getElementById('_cm-helper-rebuild-history').innerText = previousBuiltHistoryButtonText;
        }
        setRebuildHistoryButtonDisabledState(false);
        await updateSyncStatusDisplay();
    }

    async function initQuickHistory() {
        // Setup UI
        const container = document.getElementById('OrderSearchForm');
        container.insertAdjacentHTML('beforebegin', `
            <style>
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
                    gap: 1rem;
                    justify-content: space-between;
                }

                ._cm-helper-sync-controls {
                    display: flex;
                    flex-direction: column;
                    gap: 0.25rem;
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

                ._cm-helper-disabled {
                    opacity: 0.5;
                    pointer-events: none;
                }

                ._cm-helper-sync-status-tooltip {
                    cursor: help;
                    border-bottom: 1px dotted #ccc;
                }

                #_cm-helper-status {
                    font-family: ui-monospace, monospace;
                    font-size: 0.875rem;
                }
            </style>
            <div class="_cm-helper-container">
                <h2>Quick History Search (TM Script)</h2>
                <div class="_cm-helper-controls">
                    <form id="_cm-helper-search-form" class="_cm-helper-search-form">
                        <span class="small">
                            Search by inputing the start or full name of what you're looking for. 
                            <br>Searching for "Light" will find "Lightning Bolt" but searching for "Bolt" won't.
                            <br>Only searches through finished (past) orders.
                        </span>
                        <div class="_cm-helper-search-controls">
                            <input type="text" id="_cm-helper-product-name" class="form-control" placeholder="Product name">
                            <button type="submit" class="btn btn-primary">Search</button>
                        </div>
                        <div class="_cm-helper-history-type-controls">
                            <input type="radio" id="_cm-helper-buys" name="_cm-helper-history-type" value="buys">
                            <label for="_cm-helper-buys">Buys</label>
                            <input type="radio" id="_cm-helper-sells" name="_cm-helper-history-type" value="sells">
                            <label for="_cm-helper-sells">Sells</label>
                        </div>
                    </form>
                    <div class="_cm-helper-sync-controls">
                        <div class="small" id="_cm-helper-sync-status"></div>
                        <button class="btn btn-sm btn-secondary" id="_cm-helper-rebuild-history">Rebuild history</button>
                    </div>
                </div>

                <div id="_cm-helper-status"></div>
                <div id="_cm-helper-results"/>
            </div>
        `);

        const db = await getDb();
        const buysSyncedTo = (await db.get(STORE_NAME_BUYS, SYNCED_TO_DATE_KEY))?.date ?? 'not synced yet';
        const sellsSyncedTo = (await db.get(STORE_NAME_SELLS, SYNCED_TO_DATE_KEY))?.date ?? 'not synced yet';

        const urlSearchParams = new URLSearchParams(window.location.search);
        const userType = urlSearchParams.get('userType');
        const type = userType === 'seller' ? 'sells' : 'buys';
        document.getElementById(`_cm-helper-${type}`).checked = true;

        await updateSyncStatusDisplay();
        if (buysSyncedTo instanceof Date || sellsSyncedTo instanceof Date) {
            const currentStoreName = userType === 'seller' ? STORE_NAME_SELLS : STORE_NAME_BUYS;
            autoSync(currentStoreName);
        }

        document.getElementById('_cm-helper-rebuild-history').addEventListener('click', async () => {
            const response = prompt(
                'Which history do you want to rebuild? This will clear all existing history and fetch all orders from your registration date to today.\n\n' +
                'This will take a while depending on the number of orders and your account age.\n\n' +
                'Both buys and sells will be fetched by default. Otherwise input either "sells" or "buys" to fetch only those types of orders.',
                'buys and sells'
            );
            if (!response) {
                return;
            }
            const cleanResponse = response.toLowerCase().trim();
            setRebuildHistoryButtonDisabledState(true);
            if (cleanResponse.includes('sells')) {
                await rebuildHistory(STORE_NAME_SELLS);
            }
            if (cleanResponse.includes('buys')) {
                await rebuildHistory(STORE_NAME_BUYS);
            }
            setRebuildHistoryButtonDisabledState(false);
        });

        // Produces /en/Magic
        const baseRelativeUrl = window.location.pathname.split('/').slice(0, -2).join('/');
        document.getElementById('_cm-helper-search-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const needle = document.getElementById('_cm-helper-product-name').value;
            const storeName = document.getElementById('_cm-helper-buys').checked ? STORE_NAME_BUYS : STORE_NAME_SELLS;
            const orders = await findOrdersWithProduct(needle, storeName);
            document.getElementById('_cm-helper-results').innerHTML = '<ul>' + orders.map(order => `
                <li class="order">
                    <a href="${baseRelativeUrl}/Orders/${order.orderUrl.split('/')[4]}" target="_blank">${order.orderUrl.split('/')[4]}</a>
                    (<span class="status"><strong>${order.status}</strong></span> / 
                    <span class="date">${formatDate(order.date)}</span>)
                    <span class="user"><a href="${baseRelativeUrl}/Users/${order.user}" target="_blank">${order.user}</a></span>
                </li>
            `).join('') + '</ul>';
        });
    }

    async function storeOrderToDb({ products, orderUrl, status, user, date }, storeName) {
        const db = await getDb();
        for (const productName of products) {
            const product = await getOrCreateProduct(storeName, productName);
            product.orders[orderUrl] = {
                status,
                user,
                date,
            };
            await db.put(storeName, product);
        }
    }

    async function getOrCreateProduct(storeName, productName) {
        const db = await getDb();
        const productKey = productName.toLowerCase();
        const product = await db.get(storeName, productKey);

        if (product) {
            return { ...product };
        }

        const newProduct = {
            key: productKey,
            orders: {},
        }
        const tx = db.transaction(storeName, 'readwrite');
        await tx.store.add(newProduct);
        await tx.done;
        return newProduct;
    }

    async function findOrdersWithProduct(productName, storeName) {
        const productKey = productName.toLowerCase();
        const db = await getDb();
        const keyRange = IDBKeyRange.bound(productKey, productKey + '\uffff');

        const store = db.transaction(storeName, 'readonly').store;
        const matchedOrders = {};
        for await (const cursor of store.iterate(keyRange)) {
            if (!cursor.value.orders) {
                // Likely some meta key, skip
                continue;
            }
            const cursorOrders = structuredClone(cursor.value.orders);
            for (const [orderUrl, orderData] of Object.entries(cursorOrders)) {
                matchedOrders[orderUrl] = { ...orderData, orderUrl };
            }
        }

        const ordersArray = Object.values(matchedOrders);
        return ordersArray.sort((a, b) => {
            return b.date - a.date; // Descending order
        });
    }

    // Initialize
    // TODO: Test in Firefox, might need some delay
    initQuickHistory();
})();