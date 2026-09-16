# CM Quick History Search 1.0: item-level history for every game + "My History" tab

Date: 2026-09-16
Scope: `cardmarket.com-quick-history-search/` (major version: data rebuild required)

## Problem

On a card's page I want to see whether I've bought or sold that card before (any
printing), how many copies, at what price, and whether some of it is still in
transit. The local history the script builds today can't answer that: it stores only
`product name → orders {status, user, date}` for finished orders. There's no quantity,
price, printing, condition, language or product id, and no game (the stored names
already mix Magic, Weiss Schwarz and accessories). Finished-only means anything
bought or sold recently is invisible until it arrives.

## Data sources (discovered, verified live 2026-09-16)

- **Order search is shared across games.** `/en/Magic/Orders/Search/Results?userType=
  buyer|seller&minDate=&maxDate=&shipmentStatus=&site=` also returns other games'
  orders (e.g. a Weiss Schwarz order), and `/en/Magic/Orders/<id>` opens it.
- **`shipmentStatus` values:** 1 In Shopping Cart, 2 Unpaid, 3 Paid, 4 Sent, 5 Arrived,
  6 Under investigation, 7 Not arrived, 8 Cancelled, 101 Open, 200 Past. Every status
  needs a date range: Open without dates gives the alert "Invalid start date" and no
  `#StatusTable`. A 58-day Past buyer window returned 15 shipments on one page
  (`.pagination`: "15 Shipments Page 1 of 1"); the row date looks like "15.08.2026 11:00".
- **Order page item rows** (`.product-table > tbody > tr`) carry `data-article-id`,
  `-product-id`, `-amount`, `-name`, `-expansion`, `-expansion-name`, `-number`,
  `-rarity`, `-condition`, `-language`, `-price`, `-comment`. Example from order
  1055673149: `Lightning Bolt (V.4)`, product 559407, amount 1, Mystical Archive #105,
  condition 2 (row text "NM"), language 7, price 14.
- **Item rows link to their product**, which gives the game and category:
  `/en/WeissSchwarz/Products/Singles/OSHI-NO-KO/Glimpse-of-an-Idol-Ruby-V1-Trial-Deck`,
  `/en/Magic/Products/Sleeves/100-KMC-Perfect-Sized-Sleeves-Version-1` (no set segment).
- **Product pages** (checked on a Magic single, a Pokémon single and a sleeves product):
  `ul[role=tablist].nav-tabs` > `li.nav-item.tab-{info,chart,sell,wants}` >
  `a.nav-link[data-bs-toggle=tab][href="#tabContent-…"]`, panes
  `.tab-content > .tab-pane#tabContent-…` (`tab-pane d-none h-100 px-3 pt-3` + `active`).
  Chart is hidden on wide screens; non-singles have no Wants tab.
  `input[name=idProduct]` holds the product id (M11 Lightning Bolt 241866).
- **Versions (Cardmarket's "same card"):** singles pages link "Show Versions (N)" to
  `/<lang>/<Game>/Cards/<slug>/Versions`. Magic groups by name (`Lightning-Bolt`, 68
  versions); Pokémon groups by name + attacks (Base Set Pikachu →
  `Pikachu-Gnaw-Thunder-Jolt`, 26). So grouping by name would be wrong outside Magic.
  The Versions page listed all 68 Bolts with no pagination (`a.card` in `.card-column`),
  and both 241866 and 559407 appear in its markup. Non-singles have no versions link.
  `/Cards/<slug>` itself has no tab bar.
- **Logged in:** header `#account-dropdown` shows "Seven( 1.360,85 € )".
- **Cloudflare:** after a burst of ~15 test requests, one navigation got the "Just a
  moment..." check. It cleared by itself within seconds, but fetches during such a
  window must be treated as failures.

## Architecture

One script, same path, `@name` and `@namespace` (auto-update keeps working);
`@version 1.0.0`, new `@description`. `@match` adds `https://www.cardmarket.com/*/*/Products/*`
to the existing `…/*/*/Orders/Search*`. Nothing parses English text, so all
languages and games work. `@require idb@8` stays.

### Storage: IndexedDB `cardmarket-orders`, version 4

The upgrade from ≤ 3 deletes the `buys`/`sells` stores (clean break). The script
also removes localStorage `_cm-helper-synced-orders` (try/catch; no more localStorage use).

- `orders`, key `id`: `{ id, direction: 'buy'|'sell', status, date, user }`.
  Status and date live only here because they change.
- `items`, key `"<orderId>:<articleId>"`, indexes `productId`, `orderId`:
  `{ key, orderId, direction, productId, game, productPath, name, expansionName,
  number, condition, language, price, amount, extras, data }`. `productPath` is the
  product link without `/<lang>/`. `data` holds the row's raw `data-*` attributes, so a
  future column doesn't need another rebuild.
- `meta`, key `key`:
  - `owner`: the username that built the history.
  - `build`: `{ startedAt, cursor, registrationDate, done }`.
  - `sync`: `{ syncedTo, lastAttemptAt, lastSuccessAt, lastError }`.

### Ingest (shared by build and sync)

`ingestWindow(direction, shipmentStatus, from, to)` walks all result pages:

- **Known order:** update status/date/user if they changed. No fetch.
- **Unknown order:** fetch the order page, parse the item rows, and write the order
  plus its items in one transaction. If the page has no item rows, store nothing, so
  it's retried later.

All requests go through one sequential fetch queue with configurable spacing.

### Build (Orders page only)

- **First start is always a click:** "Build history" when empty, or "Rebuild history"
  (confirm dialog, wipes all stores, both directions).
- **Setup:** `owner` = logged-in username; registration date from `/en/Magic/Account`
  (existing selector); `build = { startedAt: now, cursor: now }`;
  `sync.syncedTo = startedAt`.
- **Newest first:** windows of 58 days, `[cursor − 58 d, cursor]`, each ingested for
  buyer and seller with Past (200) and Open (101). After both directions finish a
  window, `cursor` moves to the window start and is saved.
- **Finish:** done when `cursor ≤ registrationDate`.
- **Resume:** an unfinished build continues automatically whenever an Orders search
  page is open.
- **Pacing and failures:** 3 s between requests. On failure, wait 60 s and retry up
  to 3 times, then stop with a message.

### Sync (Orders search pages + product pages)

- **Triggers:** page load, or "Sync now" (skips the interval check).
- **Preconditions:** logged in, username = `owner`, build started.
- **Interval:** at most once per 4 h across all tabs. `lastAttemptAt` is written when
  a sync *starts*, so clicking through pages doesn't restart it.
- **Lock:** `navigator.locks.request('cm-quick-history', { ifAvailable: true })`. The
  build holds the same lock, so only one sync or build runs at a time. A tab that
  can't get the lock skips and shows "Build running in another tab" where relevant.
- **Range:** from `min(syncedTo, oldest stored open order's date) − 1 day` to now, in
  58-day windows, Past + Open, both directions. Starting at the oldest open order means
  its status change shows up in the result rows, with no per-order refetch.
- **Success:** `syncedTo` = sync start time. Views on the page re-render.
- **Pacing and failures:** 1.5 s between requests. On failure (non-OK response,
  Cloudflare page, logged out, unexpected markup), stop, save `lastError`, and wait for
  the next 4 h window. Already-stored orders are skipped, so an interrupted sync
  effectively resumes.

### Product pages: "My History" tab

Runs only when both the tab bar and `input[name=idProduct]` exist.

1. **Tab.** Append `li.nav-item.tab-my-history` (Bootstrap tab link) and a pane
   `#tabContent-my-history` with the native pane classes. It's last and never
   auto-selected.
2. **Product set.** If the page has a `…/Cards/<slug>/Versions` link, fetch it (one
   request per page view, no cache) and collect the version product ids plus the page's
   own id. Without a link (non-singles), use the page's id only. This lives in one
   function, so it can later move to "fetch on tab click".
3. **Render.** Look up items by `productId`, join orders, then render the label and
   pane per the table below.
4. **Sync.** Start a sync if one is due; re-render when it finishes.

| Situation | Label | Pane |
|---|---|---|
| Traded some version | `My History (+3/-1)` | details |
| Only bought (or only sold) | `My History (+3/-0)` | details |
| Never traded any version | `My History` | "No buys or sells of any version" + last sync |
| Versions request pending | `My History (…)` | loading line |
| Versions request failed | counts for this printing only | note saying so |
| Build unfinished | counts from built data | "History built back to Mar 2021" |
| History never built | `My History` | "Build your history on the Orders page" + link |
| Logged out | counts from stored data | stored data, no sync |
| Other account logged in | counts from stored data | "History belongs to <owner>", no sync |

**Counts** are copies (sum of `amount`) from every order that isn't Cancelled, buys
first. Not arrived counts.

### Orders search page

Same container as today, rebuilt:
- **Status line:** "Synced 2 h ago", "Built back to … (building)", or the last error.
- **Buttons:** Build/Rebuild history, and Sync now.
- **Search:** part of the name (case-insensitive) plus Buys / Sells / Both (default
  Both). Results use the shared table with an extra Game column (slug split on
  capitals: `WeissSchwarz` → "Weiss Schwarz"), newest 200 rows, with "Showing 200 of N"
  when capped.

### Shared history table

- **Summary (product page only):** "Bought 3 · Sold 1 (this printing: bought 1)",
  counting copies and excluding cancelled. No price averages, since mixed printings
  make them meaningless.
- **Columns:** Date · Type · Qty · Printing (set, name/version, #number, linked to the
  product) · Cond · Lang · Extras (only if parseable) · Price (per copy) · User (links
  `/Users/<name>`) · Order (links `/Orders/<id>`) · Status (only when not Arrived).
  Links use the current page's `/<lang>/<Game>/` prefix; product links use the stored
  `productPath`.
- **Order:** newest first.
- **Row styles:** buys light green, sells light red. The printing you're viewing gets
  a colored left bar and bold text. Cancelled rows are greyed out on top of the tint.
- **Narrow screens:** the table scrolls horizontally inside the pane.
- **Styling:** CSS injected once with the existing `_cm-helper-` prefix.

## Error handling

- **Not logged in / other account:** no build or sync; show stored data with a note.
- **Versions fetch failure:** use this printing only, with a note.
- **Build and sync failures:** handled as described above; the error shows in the
  Orders page status line and the tab footer.
- **IndexedDB unavailable:** inject nothing on product pages; show the error on the
  Orders page.

## To verify during implementation

- **Price:** whether `data-price` is per copy or per line. A Weiss row had amount 4,
  price 0.5.
- **Extras:** foil, signed, reverse holo etc. in the `.extras` icons, and their tooltips.
- **Condition and language labels:** condition 2 = NM matches the row text; language 7
  = Japanese is inferred.
- **Row date:** whether the search row date is the order date or the last status
  change. If it's the latter, take the purchase date from the order page.
- **Search behavior:** whether an empty window still returns `#StatusTable`, and the
  results page size. Also whether omitting `shipmentStatus` returns all statuses, which
  would halve the search requests.
- **Versions page extraction:** per-card product id extraction on the Versions page.
  A 5–7 digit scan found 63 distinct numbers for 68 versions, probably because old
  products have shorter ids. Also check pagination on cards with hundreds of versions
  (basic lands).
- **Tab activation:** that Bootstrap activates the injected tab, given Cardmarket's
  `d-none`/`active` pane CSS.
- **Username:** parsing it out of the `#account-dropdown` text.

## Out of scope (possible follow-ups)

- Shopping cart contents ("already in cart").
- A history panel on `/Cards/<slug>` pages (no tab bar there).
- Caching version lists, or fetching them only on tab click.
- Separate databases per account.
- Price averages, profit or other statistics.

## Testing

- `node --check` on the userscript.
- **During development, use a separate DB name** (e.g. `cardmarket-orders-dev`).
  Upgrading the real `cardmarket-orders` to v4 would break the installed 0.2.0, which
  opens it at v3. Switch the name back just before release.
- For live console-paste checks: on product pages the installed 0.2.0 isn't active,
  but `idb` must be loaded by hand; on the Orders page, strip the old panel first.
  - **Build:** limit to the newest ~2 windows with a debug constant; check "built back
    to" advances; reload mid-window and confirm it continues from `cursor`. Order
    1055673149 must store `Lightning Bolt (V.4)`, qty 1, 14 €, NM, product 559407.
  - **M11 Lightning Bolt page:** label counts match a manual count over the stored
    items; the Mystical Archive V.4 buy shows; M11 rows (if any) get the marker.
  - **Pokémon single:** only its own versions group matches (not every Pikachu).
  - **Sleeves page:** exact product match, and no versions request in the network tab.
  - **Sync:** two product page loads within 4 h start only one sync; Sync now forces
    one; two tabs at once never sync concurrently; results arrive ≥ 1.5 s apart.
  - **Account guard:** with `meta.owner` edited to another name, no sync runs and the
    note shows.
  - **Orders search:** "Bolt" with Both returns buy and sell rows with the Game column;
    the 200-row cap note appears for a broad query (e.g. "a").
- **Release:** version 1.0.0; README gets the tab, the rebuild note for existing users
  and a refreshed build-time estimate; commit prefix `[CM-Quick-Search]`.
