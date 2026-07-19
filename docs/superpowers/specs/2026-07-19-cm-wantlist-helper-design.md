# CM Wantlist Helper: wantlist hits per seller, everywhere they matter

Date: 2026-07-19
Scope: `cardmarket.com-wantlist-helper/` (new)

## Problem

Checking whether a seller stocks anything from my wantlists means opening their
Singles offers, opening the Filter, switching to the "Wants" tab, selecting one
wantlist, applying, and repeating per wantlist (3 lists today, ≤5 ever). Most
small sellers have 0 hits in most lists, so the ritual is mostly wasted clicks.
There is no way at all to see wantlist overlap from a product page's seller
column or per seller in the shopping cart, where it would decide which of two
similar offers to take (combined shipping).

## Data source (discovered, verified live)

- `GET /en/Magic/Users/<seller>/Offers/Singles?idWantslist=<id>` returns the
  wants-filtered offers page directly — no CSRF token, plain same-origin
  `fetch()` with session cookies works. (The Filter UI's POST to
  `User_Account_Filter_FilterUserInventory` is just the interactive route to
  the same GET.)
- Total hit count (across all result pages) is in the `.pagination` bar text:
  `"N Hits"` + `"Page X of Y"`. Offer rows are `.article-row`, 20 per page,
  `?site=<n>` paginates.
- Wantlist ids+names: on any seller offers page, free from the Filter form's
  `select[name=idWantslist]`; elsewhere, parseable from `/en/Magic/Wants`
  (`a[href$="/Wants/<id>"]` blocks).
- Cart page: one `.shipment-block` per seller, seller name link in
  `.seller-name`, and an existing `.action-bar` link "Seller's Articles on My
  Wants" that hardcodes a single wantlist — confirming the URL scheme and
  giving a natural injection point.
- Cloudflare rules from CLAUDE.md apply: browser-session only, throttle
  ~1 req/1.5 s.

## Architecture

One userscript, `cardmarket.com-wantlist-helper/cm-wantlist-helper.user.js`,
plain JS, `@grant none`, `@match https://www.cardmarket.com/en/Magic/*`
(English-only: "N Hits" parsing), version 0.1.0. URL-dispatched page handlers
over a shared core:

### Shared core

- **Fetch queue**: single sequential queue, 1.5 s spacing, used by every
  feature on a page. All fetches on-demand or queued — never parallel.
- **Wantlist map** (`cmwh_wantlists` in localStorage, 24 h TTL):
  `{ lists: [{id, name}], ts }`. Sourced from the offers-page filter select
  when available (free), else one fetch of `/en/Magic/Wants`.
- **Hit-count cache** (`cmwh_hits` in localStorage, 6 h TTL): one object
  keyed by seller name: `{ [seller]: { total, perList: {id: n}, ts } }`.
  Written by every feature that fetches counts, read by all. Entries are
  per-seller stale-checked; expired entries pruned on load.
- **Count fetcher**: given a seller, fetch each wantlist's filtered page via
  the queue, parse `"N Hits"` (no pagination bar / no match on an otherwise
  valid offers page → 0), sum, cache, return `{total, perList}`. Any network
  or parse failure → render `?` (tooltip: error), cache nothing.
- **Breakdown renderer**: `total (a+b+c)` — each per-list number is a link to
  that filtered page, `title` = wantlist name; total bolded; 0-hit lists
  included in the breakdown but not linked. Total 0 renders as just `0`.

### Page handler: seller offers (`/Users/<name>/Offers/Singles`)

"Check all wantlists" button injected next to the Filter controls. On click:

- For each wantlist: fetch filtered page 1, read total hits, then follow
  `?site=2..` up to **5 pages/list**, all via the shared queue. Progress shown
  on the button ("Fetching 2/3…").
- Render a collapsible panel above the native offers table: one section per
  wantlist — name, hit count, and the matched `.article-row` elements imported
  from the fetched documents (same page CSS, so rows render natively; `id`
  attributes stripped to avoid collisions). Lists with 0 hits collapse to a
  one-line "0 hits". Capped lists get a "N more on Cardmarket →" link to the
  filtered page.
- Side effect: seller's count cache entry refreshed from the same responses.

### Page handler: product page (`/Products/Singles/*`)

- Per `.article-row`, a small button (♥?) injected after the seller-name link
  (`a[href^="/en/Magic/Users/"]`). Click → count fetcher for that seller →
  button replaced by the breakdown. All rows of the same seller resolve
  together from one fetch set.
- If a fresh cache entry exists at render time, the breakdown is shown
  immediately instead of the button — no fetch.
- Rows are added asynchronously (Load More / re-sorts): MutationObserver on
  the table body, per repo conventions. Idempotent per row (marker class).

### Page handler: shopping cart (`/ShoppingCart`)

- Auto-fetch: every `.shipment-block` seller without a fresh cache entry is
  queued on load (shared queue ⇒ globally staggered 1.5 s). Cached sellers
  render instantly.
- Breakdown injected into the block's `.action-bar` beside the existing
  "Seller's Articles on My Wants" link. While queued: "wants: …".
- One "Clear wantlist cache" button on this page (near the top of the cart),
  wiping `cmwh_hits` + `cmwh_wantlists` and re-running the page logic — for
  when a wantlist was edited mid-session.

## Error handling

- Not logged in / no wantlists found: log a console warning once, inject
  nothing.
- Non-OK response, Cloudflare challenge, or unparseable page: `?` badge with
  error tooltip; nothing cached; queue continues with remaining jobs.
- localStorage full/unavailable: features still work, just uncached
  (try/catch around storage access).

## Out of scope (possible follow-ups)

- Other games than Magic; non-English locales.
- Deduplicating a card that appears in multiple wantlists (sum may
  double-count; acceptable).
- Auto-fetch on product pages (explicitly on-demand to avoid rate limiting).
- Fetching beyond 5 pages/list in the combined panel.

## Testing

- `node --check` on the userscript.
- Live console-paste (script body without header) per repo conventions:
  - Seller offers: PULSAR-store — panel shows Pauper list with the same 3
    hits/rows the native filter shows; a 0-hit list collapses to "0 hits".
  - Verify a genuine 0-hit fetch parses as 0, not `?` (unverified during
    recon — DOM of a 0-hit result page not yet inspected).
  - Product page: Chronatog (VIS) — buttons appear on all rows incl.
    Load-More rows; clicking one resolves every row of that seller; reload
    within 6 h shows counts without the button (cache hit).
  - Cart: counts appear staggered without interaction; network tab shows
    ≥1.5 s spacing; "Clear wantlist cache" empties both keys and re-fetches.
  - Coexistence: shipping estimator active on the same product page — no
    marker-class or observer clashes.
