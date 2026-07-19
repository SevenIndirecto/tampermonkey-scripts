# Cardmarket.com shipping estimator

![Preview](https://raw.githubusercontent.com/SevenIndirecto/tampermonkey-scripts/refs/heads/master/cardmarket.com-shipping-estimator/preview.png)

## What is it?

* This script automatically adds shipping estimates to the Singles page on CardMarket/Magic.
* A secondary function is that the script hides offers from users that won't ship to you.

## Initial Setup

1. For general Tampermonkey setup see: https://github.com/SevenIndirecto/tampermonkey-scripts
2. Open https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-shipping-estimator/cm-shipping-estimator.user.js and Tampermonkey should prompt you to install. Otherwise add it manually.

## Usage

When viewing `/en/Magic/Products/Singles/*` pages like https://www.cardmarket.com/en/Magic/Products/Singles/Visions/Chronatog you'll see shipping estimates.
Note: only the English (`/en/`) site works — the script reads the seller country from English page text.

How the estimate is picked, mirroring Cardmarket's own rules:

* Cart below 25 € and the seller may ship untracked → cheapest untracked letter (`regular`).
* Otherwise → the cheapest tracked method whose max. insured value covers the card price (`tracked` tiers).

## Updating shipping prices

Prices are hardcoded (destination: Slovenia) but generated — don't edit them by hand:

1. Open https://help.cardmarket.com/en/ShippingCosts in your browser (it has to be a
   browser with a Cardmarket session/Cloudflare cookie — plain `curl`/Node gets a 403).
2. Open DevTools → Console and paste the whole contents of `update-shipping-prices.js`.
3. Wait about a minute (~34 API calls, one per origin country, throttled to avoid rate limits).
4. Paste the generated block (also copied to your clipboard) over the
   `BEGIN GENERATED SHIPPING_PRICES` … `END GENERATED SHIPPING_PRICES` section in
   `cm-shipping-estimator.user.js`.

**Shipping to a country other than Slovenia?** Change `DESTINATION` at the top of
`update-shipping-prices.js`, run it, and paste the block into your local copy of the
userscript (disable Tampermonkey auto-update for it, or your block will be overwritten
by the Slovenian one).

## Known inaccuracies

* Professional sellers may have custom shipping costs — their estimates are generally too high.
* Sellers from non-eurozone countries (Poland, Czech Republic, ...): the help-page prices are
  exchange-rate snapshots, real cart prices can differ by a few percent.
* Cardmarket's Trustee Service fee (~1% of article value) is not included.
* Multi-card carts are not modeled — estimates assume a single card in a letter.
