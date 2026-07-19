# Cardmarket.com wantlist helper

## What is it?

Answers "does this seller have anything from my wantlists?" everywhere the
question comes up on CardMarket/Magic, without clicking through the Wants
filter once per list:

* One-click table of **all** your wantlist matches on a seller's offers page.
* On-demand hit counts next to every seller on a card's offers list.
* Automatic hit counts per seller in the shopping cart.

## Initial Setup

1. For general Tampermonkey setup see: https://github.com/SevenIndirecto/tampermonkey-scripts
2. Open https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-wantlist-helper/cm-wantlist-helper.user.js and Tampermonkey should prompt you to install. Otherwise add it manually.

You need to be logged in to Cardmarket (the script reads your own wantlists),
and at least one wantlist must exist under https://www.cardmarket.com/en/Magic/Wants.

## Usage

* **Seller offers page** (`/en/Magic/Users/<seller>/Offers/Singles`, e.g. via
  "More articles from this seller"): click the *Check all wantlists* button
  above the offers table. The matches for every wantlist appear in one
  collapsible panel — per list: hit count plus the matching offer rows in
  Cardmarket's own row layout. Lists with many hits are capped at 5 result
  pages, with a link to the full filtered view.
* **Product page** (`/en/Magic/Products/Singles/...`): click the small `♡?`
  button next to a seller's name to get that seller's wantlist hits as
  `total (a+b+c)` — one number per wantlist, each linking to the filtered view
  of that seller's offers, wantlist names shown on hover. Counts are fetched
  on demand only, so browsing big offer tables causes no background requests.
* **Shopping cart** (`/en/Magic/ShoppingCart`): the same `total (a+b+c)`
  breakdown appears automatically in each seller's block — you already chose
  these sellers, so it's almost always worth knowing. Use the *Clear wantlist
  cache* button at the top of the cart after editing your wantlists
  mid-session, otherwise counts may be served stale from cache.

Note: only the English (`/en/`) Magic site works — the script parses hit
counts from English page text.

## How it works

* The Wants filter is just a GET parameter: `?idWantslist=<id>` on the
  seller's Offers/Singles page. The script fetches those pages with your
  session and reads the "N Hits" total from the pagination bar.
* Your wantlists (id → name) are discovered from `/en/Magic/Wants` or the
  offers-page filter and cached for 24 h.
* Per-seller hit counts are cached for 6 h, so revisiting the cart or a
  product page doesn't refetch. All requests go through one sequential queue,
  spaced 1.5 s apart, to stay friendly with Cloudflare.
* Cardmarket's localStorage is sometimes completely full (an analytics blob
  can take the whole quota); the script then falls back to sessionStorage —
  caching still works, but only per tab.

## Caveats

* A card present in more than one wantlist is counted once per list.
* Counts are a snapshot; a seller can sell through between the cached count
  and your visit.
