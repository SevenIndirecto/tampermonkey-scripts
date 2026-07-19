# CM Shipping Estimator: price updater + tier-based estimates

Date: 2026-07-19
Scope: `cardmarket.com-shipping-estimator/`

## Problem

`SHIPPING_PRICES` in `cm-shipping-estimator.user.js` is hand-collected (add test
cards to carts, seller by seller) and has drifted: Austria is now 1,75/5,85 vs
the hardcoded 2,60/6,75; Poland's and Czechia's cheap registered letters no
longer exist (cheapest tracked is now ~17 €/~19,66 €); Canada is no longer a
Cardmarket seller country; Japan and Singapore are new. A flat
`{ regular, tracked }` pair per country is also the wrong model: France charges
8,15 € (tracked letter, max 50 €) or 16,99 € (Colissimo, max 100 €) or 17,99 €
(max 200 €) depending on cart value.

## Data source (discovered, verified live)

`https://help.cardmarket.com/api/shippingCosts?locale=en&fromCountry=<id>&toCountry=<id>&preview=false`
returns JSON per method: `name`, `isTracked`, `isLetter`, `isVirtual`,
`maxValue`, `maxWeight` (g), `stampPrice`, `price`. `price` already includes
Cardmarket's packaging fee (verified: DE letter 1,25 stamp + 0,30 = 1,55).
Country name→id mapping is embedded in the help page's `__NUXT__` payload
(delivery-days dataset). Verified against real carts: PL cart 16,67 vs API
17,17; CZ cart 19,09 vs API 19,66 — deltas are FX conversion on non-euro
origins; eurozone matches to the cent.

Cloudflare blocks non-browser clients (curl → 403 challenge), so the updater
runs in a browser tab on `https://help.cardmarket.com/en/ShippingCosts`
(same-origin, has clearance cookie). ~33 requests (one per origin) at
`DELAY_MS = 1500` ≈ 50 s total — no 429 risk.

## Component 1: `update-shipping-prices.js` (new)

Self-contained script pasted into the DevTools console on the help page (or run
via browser automation). Not a userscript — plain console script.

- Config at top: `DESTINATION = 'Slovenia'`, `DELAY_MS = 1500`,
  `MIN_WEIGHT_G = 20` (a card must fit).
- Country map read live from `window.__NUXT__` (picks up new countries);
  hardcoded 2026-07 map as fallback.
- Per origin country (skipping the destination itself), fetch methods, filter
  out `isVirtual`, names starting with `SHIPPING COST ESTIMATION`, and
  `maxWeight < MIN_WEIGHT_G`, then:
  - `regular` = cheapest untracked method price (rounded to cents).
  - `tracked` = tiers `[{ maxValue, price }]`: cheapest tracked method per
    distinct `maxValue`, then pruned to pareto-optimal ascending (a tier is
    dropped if a higher-`maxValue` tier is same price or cheaper).
  - Countries with no untracked method (e.g. Japan): `regular` = price of the
    lowest tracked tier.
  - Countries returning errors or "not shipping": skipped and listed in a
    summary at the end; script never aborts mid-run.
- Output: complete `const SHIPPING_PRICES = { ... };` block bracketed by
  `// BEGIN GENERATED SHIPPING_PRICES` / `// END GENERATED SHIPPING_PRICES`
  markers with a `// Generated YYYY-MM-DD for shipping to <destination>`
  header. Printed to console and copied to clipboard (best effort). Also prints
  a human-review table: country, chosen method names, prices.

## Component 2: `cm-shipping-estimator.user.js` changes

- Replace `SHIPPING_PRICES` with freshly generated tier-model data inside the
  BEGIN/END markers. New shape:
  `{ regular: number, tracked: [{ maxValue: number, price: number }] }`.
- `getShippingPrice(price, country, requiresTracking)`:
  - `price < 25 && !requiresTracking` → `regular`;
  - otherwise → `price` of the first tier with `maxValue >= price`; if the
    cart value exceeds every tier, use the top tier (better than nothing) —
    display unchanged.
- `@match` narrowed to `https://www.cardmarket.com/en/Magic/Products/Singles/*`
  (seller country comes from the localized "Item location: X" tooltip; on
  non-English locales the script can never match country names, so make the
  limitation explicit).
- Replace `setTimeout(100)` + the `loadMoreButton` click listener with a
  MutationObserver on the offers table processing newly added `.article-row`s
  (also fixes rows that render slower than the fixed 3 s delay).
- Version bump to 0.2.0.

## Component 3: README

- Document the updater: where to run it, how to paste the generated block,
  how a non-Slovenian user regenerates for their own destination.
- Caveats: professional sellers with custom shipping still estimate wrong;
  non-eurozone origins drift a few percent with FX; Trustee Service fee not
  included.

## Out of scope (possible follow-ups)

- Runtime price fetching in the userscript (`GM_xmlhttpRequest` +
  `@connect help.cardmarket.com`, cached, configurable destination) — approach
  "B", only if non-Slovenian demand materializes.
- Multi-card weight tiers (API exposes 20/50/100 g letter tiers).
- Trustee Service fee estimation (~1% of article value).

## Testing

- Spot-check generated data against known-good values: Germany
  regular 1,55, single tracked tier 15,49; France tiers 8,15/16,99/17,99;
  Japan regular == lowest tracked tier.
- Run the updated estimator on
  `https://www.cardmarket.com/en/Magic/Products/Singles/Visions/Chronatog` via
  browser console injection before installing: rows annotated, totals equal
  price + expected tier, sellers-not-shipping still hidden, "Load More" rows
  processed by the observer.
