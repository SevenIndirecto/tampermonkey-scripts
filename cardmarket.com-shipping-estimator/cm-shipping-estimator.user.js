// ==UserScript==
// @name         Cardmarket.com Shipping Estimator
// @version      0.1.2
// @description  Add estimated shipping prices to Cardmarket Singles page and hide offers by sellers not shipping to you.
// @author       seven
// @namespace    https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-shipping-estimator/
// @updateURL    https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-shipping-estimator/cm-shipping-estimator.user.js
// @downloadURL  https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-shipping-estimator/cm-shipping-estimator.user.js
// @match        https://www.cardmarket.com/*/Magic/Products/Singles/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cardmarket.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Change this to true if you don't want to auto hide users who don't shop to you.
    const DISABLE_AUTO_HIDE_FOR_USERS_NOT_SHIPPING_TO_ME = false;

    // Shipping prices are for Slovenia.
    // NOTE: You can use https://www.cardmarket.com/en/Magic/Users country search to find users
    const SHIPPING_PRICES = {
        'Austria': { regular: 2.6, tracked: 6.75 },
        'Belgium': { regular: 3.20, tracked: 10.30 },
        'Bulgaria': { regular: 2.4, tracked: 6.23 },
        'Canada': { regular: 3.9, tracked: 14.1 }, // Needs 2025 updates
        'Croatia': { regular: 2.5, tracked: 5.90 },
        'Czech Republic': { regular: 2.23, tracked: 5.36 },
        'Cyprus': { regular: 0.94, tracked: 3.38 },
        'Denmark': { regular: 7.20, tracked: 23.28 },
        'Estonia': { regular: 2.9, tracked: 11.40 },
        'Finland': { regular: 3.05, tracked: 20.65 },
        'France': { regular: 2.4, tracked: 7.8 },
        'Germany': { regular: 1.55, tracked: 15.49 },
        'Greece': { regular: 3.3, tracked: 7.5 },
        'Hungary': { regular: 3.64, tracked: 10.08 },
        'Iceland': { regular: 2.57, tracked: 10.67 },
        'Ireland': { regular: 2.95, tracked: 11.70 },
        'Italy': { regular: 4.05, tracked: 12 },
        // 'Japan': { regular: null, tracked: null }, - no active sellers currently
        'Latvia': { regular: 2.84, tracked: 6.10 },
        'Liechtenstein': { regular: 1.91, tracked: 9.7 },
        'Lithuania': { regular: 2.4, tracked: 6.25 },
        'Luxembourg': { regular: 2.0, tracked: 7.7 },
        'Malta': { regular: 2.51, tracked: 10.79 },
        'Netherlands': { regular: 2.2, tracked: 12.45 },
        'Norway': { regular: 3.11, tracked: 24.63 },
        'Poland': { regular: 2.64, tracked: 5.64 },
        'Portugal': { regular: 2.85, tracked: 7.27 },
        'Romania': { regular: 3.34, tracked: 5.77 },
        'Slovenia': { regular: 1.88, tracked: 3.84 },
        'Slovakia': { regular: 2.7, tracked: 8.2 },
        'Spain': { regular: 2.45, tracked: 7.6 },
        'Sweden': { regular: 4.33, tracked: 13.67 },
        'Switzerland': { regular: 4.78, tracked: 11.73 },
        'United Kingdom': { regular: 4.2, tracked: 12.22 },
    };
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
        if (!SHIPPING_PRICES[country]) {
            return null;
        }
        return SHIPPING_PRICES[country][price >= 25 || requiresTracking ? 'tracked' : 'regular'];
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

    // On load
    setTimeout(processUnmodifiedRows, 100);

    // Load more button
    document.getElementById('loadMoreButton')?.addEventListener('click', () => {
       setTimeout(processUnmodifiedRows, 3000);
    });
})();
