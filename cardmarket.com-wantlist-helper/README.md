# Cardmarket Wantlist Helper

Answers "does this seller have anything from my wantlists?" everywhere the
question comes up, without clicking through the Wants filter once per list.

## What it does

- **Seller offers page** (`/en/Magic/Users/<seller>/Offers/Singles`):
  a *Check all wantlists* button above the offers table. One click fetches the
  wants-filtered results for every wantlist and shows them in one collapsible
  panel — per list: hit count plus the matching offer rows in Cardmarket's own
  row layout. Lists with many hits are capped at 5 result pages, with a link to
  the full filtered view.
- **Product page** (`/en/Magic/Products/Singles/...`): a small `♡?` button
  next to each seller name. Click it to get that seller's total wantlist hits
  as `total (a+b+c)` — one number per wantlist, each linking to the filtered
  view of that seller's offers. On-demand only, so browsing big offer tables
  causes no background requests.
- **Shopping cart** (`/en/Magic/ShoppingCart`): the same `total (a+b+c)`
  breakdown appears automatically in each seller's block (you already chose
  these sellers, so it's always relevant), plus a *Clear wantlist cache*
  button for after you've edited your wantlists mid-session.

## How it works

- The Wants filter is just a GET parameter: `?idWantslist=<id>` on the
  seller's Offers/Singles page. The script fetches those pages with your
  session and reads the "N Hits" total from the pagination bar.
- Your wantlists (id → name) are discovered from `/en/Magic/Wants` or the
  offers-page filter and cached for 24 h.
- Per-seller hit counts are cached for 6 h, so revisiting the cart or a
  product page doesn't refetch. All requests go through one sequential queue,
  spaced 1.5 s apart, to stay friendly with Cloudflare.
- Cardmarket's localStorage is sometimes completely full (an analytics blob
  can take the whole quota); the script then falls back to sessionStorage —
  caching still works, but only per tab.

## Caveats

- English locale + Magic only (`/en/Magic/`): hit counts are parsed from
  English page text.
- A card present in more than one wantlist is counted once per list.
- Counts are a snapshot; a seller can sell through between the cached count
  and your visit.
