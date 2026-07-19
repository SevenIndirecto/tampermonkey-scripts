/**
 * Shipping price updater for cm-shipping-estimator.user.js
 *
 * How to use:
 *   1. Open https://help.cardmarket.com/en/ShippingCosts in your browser
 *      (must be a browser tab - the API sits behind Cloudflare, so curl/Node won't work).
 *   2. Open DevTools (F12) -> Console, paste this whole file, press Enter.
 *   3. Wait ~1 minute (one request per origin country, throttled by DELAY_MS).
 *   4. The generated SHIPPING_PRICES block is printed to the console and copied
 *      to the clipboard. Paste it over the BEGIN/END GENERATED SHIPPING_PRICES
 *      section in cm-shipping-estimator.user.js.
 *
 * Shipping to a country other than Slovenia? Change DESTINATION below.
 */
(async function updateShippingPrices() {
    'use strict';

    const DESTINATION = 'Slovenia';
    const DELAY_MS = 1500;
    const MIN_WEIGHT_G = 20; // a method must at least fit a card in a sleeve

    // Fallback country name -> Cardmarket id map (extracted 2026-07). Only used
    // if live extraction from the page's __NUXT__ payload fails.
    const FALLBACK_COUNTRY_IDS = {
        'Austria': 1, 'Belgium': 2, 'Bulgaria': 3, 'Croatia': 35, 'Cyprus': 5,
        'Czech Republic': 6, 'Denmark': 8, 'Estonia': 9, 'Finland': 11,
        'France': 12, 'Germany': 7, 'Greece': 14, 'Hungary': 15, 'Iceland': 37,
        'Ireland': 16, 'Italy': 17, 'Japan': 36, 'Latvia': 21,
        'Liechtenstein': 18, 'Lithuania': 19, 'Luxembourg': 20, 'Malta': 22,
        'Netherlands': 23, 'Norway': 24, 'Poland': 25, 'Portugal': 26,
        'Romania': 27, 'Singapore': 29, 'Slovakia': 31, 'Slovenia': 30,
        'Spain': 10, 'Sweden': 28, 'Switzerland': 4, 'United Kingdom': 13,
    };

    function extractCountryIds() {
        try {
            const payload = JSON.stringify(window.__NUXT__);
            const map = {};
            for (const m of payload.matchAll(/"fromCountry":"([^"]+)"[^{}]*?"fromCountryId":(\d+)/g)) {
                map[m[1]] = Number(m[2]);
            }
            for (const m of payload.matchAll(/"toCountry":"([^"]+)"[^{}]*?"toCountryId":(\d+)/g)) {
                map[m[1]] = Number(m[2]);
            }
            // The delivery-days dataset occasionally lags behind the country
            // dropdown, so merge rather than replace.
            return Object.keys(map).length >= 20 ? { ...FALLBACK_COUNTRY_IDS, ...map } : FALLBACK_COUNTRY_IDS;
        } catch (e) {
            console.warn('Falling back to hardcoded country ids:', e);
            return FALLBACK_COUNTRY_IDS;
        }
    }

    // "1,55 €" -> 1.55, "2.500,00 €" -> 2500
    const parseEuro = (s) => parseFloat(s.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.'));
    const delay = (ms) => new Promise((res) => setTimeout(res, ms));

    function isUsableMethod(m) {
        return !m.isVirtual
            && !m.name.startsWith('SHIPPING COST ESTIMATION')
            && m.maxWeight >= MIN_WEIGHT_G;
    }

    // regular: cheapest untracked. tracked: cheapest method per maxValue tier,
    // pruned so that each successive tier covers more value for more money
    // (a tier is useless if a higher-capacity tier is the same price or cheaper).
    function selectPrices(methods) {
        const usable = methods.filter(isUsableMethod);
        const untracked = usable.filter((m) => !m.isTracked).map((m) => parseEuro(m.price));
        const regular = untracked.length ? Math.min(...untracked) : null;

        const cheapestPerTier = new Map();
        for (const m of usable.filter((m) => m.isTracked)) {
            const maxValue = parseEuro(m.maxValue);
            const price = parseEuro(m.price);
            if (!cheapestPerTier.has(maxValue) || price < cheapestPerTier.get(maxValue)) {
                cheapestPerTier.set(maxValue, price);
            }
        }
        const tiers = [...cheapestPerTier.entries()]
            .map(([maxValue, price]) => ({ maxValue, price }))
            .sort((a, b) => a.maxValue - b.maxValue);
        const tracked = [];
        for (let i = 0; i < tiers.length; i++) {
            const cheaperLater = tiers.slice(i + 1).some((t) => t.price <= tiers[i].price);
            if (!cheaperLater) {
                tracked.push(tiers[i]);
            }
        }
        // No untracked option at all (e.g. Japan): everything ships tracked.
        return { regular: regular ?? (tracked[0] ? tracked[0].price : null), tracked };
    }

    async function fetchMethods(fromId, toId) {
        const url = `/api/shippingCosts?locale=en&fromCountry=${fromId}&toCountry=${toId}&preview=false`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    }

    const countryIds = extractCountryIds();
    const destinationId = countryIds[DESTINATION];
    if (!destinationId) {
        console.error(`Unknown destination "${DESTINATION}". Known:`, Object.keys(countryIds).sort().join(', '));
        return;
    }

    const results = {};
    const skipped = [];
    const review = [];
    const origins = Object.keys(countryIds).sort();

    for (const country of origins) {
        try {
            const methods = await fetchMethods(countryIds[country], destinationId);
            const selected = selectPrices(Array.isArray(methods) ? methods : []);
            if (selected.regular === null && !selected.tracked.length) {
                skipped.push(`${country} (no usable methods)`);
            } else {
                results[country] = selected;
                review.push({
                    country,
                    regular: selected.regular,
                    tracked: selected.tracked.map((t) => `${t.price} <=${t.maxValue}`).join(', '),
                });
            }
        } catch (e) {
            skipped.push(`${country} (${e.message})`);
        }
        await delay(DELAY_MS);
    }

    const today = new Date().toISOString().slice(0, 10);
    const lines = [
        '    // BEGIN GENERATED SHIPPING_PRICES',
        `    // Generated ${today} for shipping to ${DESTINATION} by update-shipping-prices.js`,
        '    // regular: cheapest untracked letter (carts < 25 EUR).',
        '    // tracked: cheapest tracked method per max-cart-value tier.',
        '    const SHIPPING_PRICES = {',
    ];
    for (const country of Object.keys(results)) {
        const { regular, tracked } = results[country];
        const tiers = tracked.map((t) => `{ maxValue: ${t.maxValue}, price: ${t.price} }`).join(', ');
        lines.push(`        '${country}': { regular: ${regular}, tracked: [${tiers}] },`);
    }
    lines.push('    };');
    lines.push('    // END GENERATED SHIPPING_PRICES');
    const block = lines.join('\n');

    console.table(review);
    if (skipped.length) {
        console.warn('Skipped:', skipped.join('; '));
    }
    console.log(block);
    try {
        await navigator.clipboard.writeText(block);
        console.log('%c-> Copied to clipboard.', 'font-weight: bold');
    } catch (e) {
        console.warn('Clipboard copy failed (copy the block above manually):', e.message);
    }
    return { results, skipped, block };
})();
