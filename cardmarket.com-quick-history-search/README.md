# Cardmarket.com Quick Order History Search

![Preview](https://raw.githubusercontent.com/SevenIndirecto/tampermonkey-scripts/refs/heads/master/cardmarket.com-quick-history-search/preview.png)

## What is it?
Since cardmarket is limiting order history search to 2 month spans, that makes it basically useless. 

This script will keep a local copy of your order history (all games) in your browser, allowing you to:

- instantly search through all your order history, with the printing, condition, language, price and quantity of every item
- see your buys and sells of a card right on its product page, in a **My History** tab

## Upgrading from 0.x
Version 1.0.0 stores a lot more about every order, so the old local history is cleared on update. Open the Order history search page and click **Build history** once.

## Initial Setup

1. For general Tampermonkey setup see: https://github.com/SevenIndirecto/tampermonkey-scripts
2. Open https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-quick-history-search/cm-quick-history-serach.user.js and Tampermonkey should prompt you to install. Otherwise add it manually.
3. Visit https://www.cardmarket.com/en/Magic/Orders/Search?userType=buyer and click **Build history**. This fetches every order once, which takes a while since requests to cardmarket are throttled to avoid getting blocked — roughly 1–2 hours for an account with 1500 orders. Newest orders are fetched first, so recent history is usable after a few minutes. If you close the page, the build continues the next time you open it.

## Usage

### Quick History Search
When you visit https://www.cardmarket.com/en/Magic/Orders/Search?userType=buyer (or seller) or any other game's Order history search you'll have a Quick History Search box at the top. Search by any part of a product name, in buys, sells or both.

### My History tab
Every product page gets a **My History** tab next to Info / Sell / Wants. `My History (+3/-1)` means you bought 3 and sold 1 copies of any version of that card (cancelled orders don't count). The tab lists every copy with its date, printing, condition, language, price, the other user and the order. Rows of the exact printing you are looking at are highlighted.

### Syncing
Your history is synced automatically at most once every 4 hours, when you open an Order history search page or a product page while logged in. Open orders (unpaid, paid, sent) are included and their status is kept up to date. Use **Sync now** to sync right away, e.g. after placing an order.
