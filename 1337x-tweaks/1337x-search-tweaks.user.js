// ==UserScript==
// @name         Enhance 1337x.to search results
// @version      0.1.0
// @description  Adds magnet links straight to search results page
// @author       seven
// @namespace    https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/1337x-tweaks
// @updateURL    https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/1337x-tweaks/1337x-search-tweaks.user.js
// @downloadURL  https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/1337x-tweaks/1337x-search-tweaks.user.js
// @match        https://1337x.to/search/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=1337x.to
// @grant        none
// ==/UserScript==

(function () {
    function addMangetLinksToSearchResults() {
        const container = document.querySelector('main.container');
        container.insertAdjacentHTML(
            'beforebegin',
            `<style>
                .tm-magnet {
                    position: absolute;
                    left: 38px;
                    font-size: 0.875rem;
                    top: 8px;
                }
                .coll-1.name {
                    padding-left: 58px !important;
                }
            </style>`
        );
        const links = document.querySelectorAll('.table-list tbody tr > td.name > a:not(.icon)');
        for (const link of links) {
            link.insertAdjacentHTML(
                'beforebegin', 
                `<a class="tm-magnet" href="#" data-url="${link.href}">🧲</a>`
            );
        }
        const magnetLinks = document.querySelectorAll('.tm-magnet');
        for (const magnetLink of magnetLinks) {
            magnetLink.addEventListener('click', async function(e) {
                e.preventDefault();
                const searchResultUrl = e.target.dataset['url'];
                const magnetLink = await getMagnetLinkForSearchResult(searchResultUrl);
                window.open(magnetLink, '_blank');
            });
        }
    }

    async function getMagnetLinkForSearchResult(url) {
        const response = await fetch(url);
        const data = await response.text();
        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(data, 'text/html');
        return htmlDoc.querySelector('#openPopup').href;
    }

    function init() {
        addMangetLinksToSearchResults();
    }

    init();
})();
