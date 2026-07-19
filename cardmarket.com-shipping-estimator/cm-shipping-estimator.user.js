// ==UserScript==
// @name         Cardmarket.com Shipping Estimator
// @version      0.2.0
// @description  Add estimated shipping prices to Cardmarket Singles page and hide offers by sellers not shipping to you.
// @author       seven
// @namespace    https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-shipping-estimator/
// @updateURL    https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-shipping-estimator/cm-shipping-estimator.user.js
// @downloadURL  https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-shipping-estimator/cm-shipping-estimator.user.js
// @match        https://www.cardmarket.com/en/Magic/Products/Singles/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cardmarket.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Change this to true if you don't want to auto hide users who don't ship to you.
    const DISABLE_AUTO_HIDE_FOR_USERS_NOT_SHIPPING_TO_ME = false;

    // Cardmarket requires registered (tracked) shipping for carts worth 25 EUR or more.
    const REGISTERED_SHIPPING_THRESHOLD = 25;

    // Prices refresh: run update-shipping-prices.js (see README) and paste its
    // output over the BEGIN/END GENERATED block below.
    // BEGIN GENERATED SHIPPING_PRICES
    // Generated 2026-07-19 for shipping to Slovenia by update-shipping-prices.js
    // regular: cheapest untracked letter (carts < 25 EUR).
    // tracked: cheapest tracked method per max-cart-value tier.
    const SHIPPING_PRICES = {
        'Austria': { regular: 1.75, tracked: [{ maxValue: 100, price: 5.85 }, { maxValue: 510, price: 18.79 }] },
        'Belgium': { regular: 3.37, tracked: [{ maxValue: 500, price: 58.7 }] },
        'Bulgaria': { regular: 2.48, tracked: [{ maxValue: 200, price: 16.31 }, { maxValue: 500, price: 26.48 }] },
        'Croatia': { regular: 2.5, tracked: [{ maxValue: 100, price: 5.9 }, { maxValue: 200, price: 11.5 }] },
        'Cyprus': { regular: 0.96, tracked: [{ maxValue: 1050, price: 18.52 }] },
        'Czech Republic': { regular: 2.36, tracked: [{ maxValue: 50, price: 19.66 }, { maxValue: 500, price: 21.87 }, { maxValue: 1100, price: 24.77 }, { maxValue: 4500, price: 40.08 }] },
        'Denmark': { regular: 6.65, tracked: [{ maxValue: 600, price: 29.28 }, { maxValue: 1000, price: 69.37 }] },
        'Estonia': { regular: 4.2, tracked: [{ maxValue: 250, price: 16.45 }] },
        'Finland': { regular: 3.65, tracked: [{ maxValue: 500, price: 26.9 }] },
        'France': { regular: 2.55, tracked: [{ maxValue: 50, price: 8.15 }, { maxValue: 100, price: 16.99 }, { maxValue: 200, price: 17.99 }, { maxValue: 500, price: 20.99 }, { maxValue: 1000, price: 25.99 }] },
        'Germany': { regular: 1.55, tracked: [{ maxValue: 500, price: 15.49 }, { maxValue: 1000, price: 32.49 }, { maxValue: 2000, price: 46.49 }, { maxValue: 2500, price: 88.2 }, { maxValue: 5000, price: 122 }] },
        'Greece': { regular: 3.3, tracked: [{ maxValue: 500, price: 23 }, { maxValue: 1000, price: 35.5 }, { maxValue: 2000, price: 45.5 }, { maxValue: 4000, price: 65.5 }, { maxValue: 10000, price: 100 }] },
        'Hungary': { regular: 4.4, tracked: [{ maxValue: 250, price: 12.95 }, { maxValue: 300, price: 27.99 }] },
        'Iceland': { regular: 2.68, tracked: [] },
        'Ireland': { regular: 4, tracked: [{ maxValue: 300, price: 17.5 }] },
        'Italy': { regular: 4.88, tracked: [{ maxValue: 150, price: 12.35 }, { maxValue: 200, price: 17.47 }, { maxValue: 500, price: 47.17 }, { maxValue: 1000, price: 61.09 }, { maxValue: 2000, price: 91.25 }] },
        'Japan': { regular: 36.31, tracked: [{ maxValue: 2500, price: 36.31 }, { maxValue: 5000, price: 72.3 }, { maxValue: 10000, price: 144.28 }, { maxValue: 20000, price: 288.24 }, { maxValue: 50000, price: 720.14 }, { maxValue: 100000, price: 1439.96 }, { maxValue: 200000, price: 2879.61 }, { maxValue: 500000, price: 7198.56 }, { maxValue: 1000000, price: 14396.81 }] },
        'Latvia': { regular: 3.3, tracked: [{ maxValue: 100, price: 6.92 }, { maxValue: 200, price: 11.68 }, { maxValue: 500, price: 17.68 }, { maxValue: 1000, price: 27.68 }, { maxValue: 2000, price: 47.68 }, { maxValue: 5000, price: 107.68 }] },
        'Liechtenstein': { regular: 1.99, tracked: [{ maxValue: 250, price: 22.23 }] },
        'Lithuania': { regular: 2.4, tracked: [{ maxValue: 100, price: 6.25 }, { maxValue: 1000, price: 16.8 }] },
        'Luxembourg': { regular: 2, tracked: [{ maxValue: 105, price: 17 }, { maxValue: 1000, price: 27 }, { maxValue: 2500, price: 42 }, { maxValue: 5000, price: 67 }] },
        'Malta': { regular: 2.51, tracked: [{ maxValue: 500, price: 37.5 }] },
        'Netherlands': { regular: 2.41, tracked: [{ maxValue: 150, price: 12.45 }, { maxValue: 500, price: 33.5 }, { maxValue: 5500, price: 43.5 }] },
        'Norway': { regular: 5.92, tracked: [{ maxValue: 500, price: 26.24 }] },
        'Poland': { regular: 2.69, tracked: [{ maxValue: 100, price: 17.17 }, { maxValue: 200, price: 24.53 }, { maxValue: 500, price: 24.77 }, { maxValue: 1000, price: 25.48 }, { maxValue: 4000, price: 43.63 }, { maxValue: 5000, price: 112.1 }] },
        'Portugal': { regular: 2.85, tracked: [{ maxValue: 100, price: 7.2 }, { maxValue: 500, price: 47.08 }, { maxValue: 1000, price: 53.75 }, { maxValue: 2500, price: 64.05 }, { maxValue: 4000, price: 80.75 }] },
        'Romania': { regular: 3.86, tracked: [{ maxValue: 1000, price: 16.04 }] },
        'Singapore': { regular: 1.09, tracked: [{ maxValue: 100, price: 2.82 }, { maxValue: 325, price: 6.31 }, { maxValue: 1000, price: 9.79 }, { maxValue: 1300, price: 45.9 }] },
        'Slovakia': { regular: 3.5, tracked: [{ maxValue: 50, price: 6.7 }, { maxValue: 1000, price: 21.5 }] },
        'Slovenia': { regular: 1.88, tracked: [{ maxValue: 250, price: 3.84 }, { maxValue: 500, price: 6.88 }, { maxValue: 1000, price: 18.9 }] },
        'Spain': { regular: 2.6, tracked: [{ maxValue: 150, price: 20.15 }, { maxValue: 225, price: 34.75 }, { maxValue: 500, price: 39.75 }, { maxValue: 1000, price: 44.75 }, { maxValue: 2000, price: 54.75 }, { maxValue: 3000, price: 64.75 }] },
        'Sweden': { regular: 4.42, tracked: [{ maxValue: 50, price: 15.08 }, { maxValue: 100, price: 17.13 }, { maxValue: 200, price: 35.1 }, { maxValue: 400, price: 44.8 }] },
        'Switzerland': { regular: 5.55, tracked: [{ maxValue: 250, price: 13.13 }, { maxValue: 1000, price: 45.65 }] },
        'United Kingdom': { regular: 4.68, tracked: [{ maxValue: 100, price: 12.46 }, { maxValue: 250, price: 16.74 }, { maxValue: 500, price: 48.06 }, { maxValue: 1000, price: 75.93 }, { maxValue: 2500, price: 118.33 }] },
    };
    // END GENERATED SHIPPING_PRICES

    const MODIFIER_CLASS = '_modified';

    function getSellerCountry(offer) {
        const tooltipText = offer.querySelector('span.seller-name span[data-bs-original-title]').dataset.bsOriginalTitle;
        return tooltipText.split(': ')[1];
    }

    function getPrice(offer) {
        const priceString = offer.querySelector('.col-offer span:not([data-bs-original-title])').innerText.split(' ')[0];
        const trackedOnly = offer.querySelector('.col-offer span[data-bs-original-title]');
        const sellCountString = offer.querySelector('.sell-count')?.innerText;
        const trackedDueToLowSellCount = parseInt(sellCountString) < 5 && !sellCountString.includes('K')
        const price = parseFloat(priceString.replaceAll('.', '').replace(',', '.'));
        return { price, isInsuredOnly: Boolean(trackedOnly) || trackedDueToLowSellCount };
    }

    function getShippingPrice(price, country, requiresTracking) {
        const entry = SHIPPING_PRICES[country];
        if (!entry) {
            return null;
        }
        if (price < REGISTERED_SHIPPING_THRESHOLD && !requiresTracking) {
            return entry.regular;
        }
        const tier = entry.tracked.find((t) => price <= t.maxValue);
        if (tier) {
            return tier.price;
        }
        // Cart value exceeds every known tier; the top tier is the closest guess.
        return entry.tracked.length ? entry.tracked[entry.tracked.length - 1].price : null;
    }

    function displayShippingAndTotalPrice(offerRow, price, shipping) {
        const total = (shipping + price).toFixed(2);
        const textNodeHTML = `<div style='width: 100%' class='color-primary text-muted font-italic small text-end text-nowrap'>ship: ${shipping}€ / <b>total: ${total}€</b></div>`;
        offerRow.querySelector('.col-offer').insertAdjacentHTML('beforeend', textNodeHTML);
        offerRow.querySelector('.col-offer').style = 'flex-wrap: wrap;';
    }

    function processUnmodifiedRows() {
        const articleRows = document.querySelectorAll('.article-row:not(._modified)');

        for (const offer of articleRows) {
            try {
                const { price, isInsuredOnly } = getPrice(offer);
                const country = getSellerCountry(offer);
                const requiresTracking = Boolean(offer.querySelector('.untracked')) || isInsuredOnly;

                const shipping = getShippingPrice(price, country, requiresTracking);
                if (!shipping) {
                    console.log('no shipping', price, country);
                    continue;
                }

                displayShippingAndTotalPrice(offer, price, shipping);
                offer.classList.add(MODIFIER_CLASS);

                // Hide sellers not selling to me.
                if (!DISABLE_AUTO_HIDE_FOR_USERS_NOT_SHIPPING_TO_ME && offer.querySelector('.col-offer .btn-grey')) {
                   offer.style.display = 'none';
                }
            } catch (e) {
                console.log(e);
                continue;
            }
        }
    }

    // Initial rows: retry a few times since Bootstrap sets the tooltip
    // attributes we read (data-bs-original-title) shortly after page load.
    processUnmodifiedRows();
    for (const delay of [100, 500, 1500]) {
        setTimeout(processUnmodifiedRows, delay);
    }

    // Rows added later (e.g. via the "Load More" button), whenever they arrive.
    const offersTable = document.querySelector('.table-body');
    if (offersTable) {
        new MutationObserver(processUnmodifiedRows).observe(offersTable, { childList: true });
    }
})();
