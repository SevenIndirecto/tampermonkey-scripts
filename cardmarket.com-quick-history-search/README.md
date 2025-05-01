# Cardmarket.com Quick Order History Search

![Preview](https://raw.githubusercontent.com/SevenIndirecto/tampermonkey-scripts/refs/heads/master/cardmarket.com-quick-history-search/preview.png)

## What is it?
Since cardmarket is limiting order history search to 2 month spans, that makes it basically useless. 

This script will keep a local copy of your order history in your browser, allowing you instantly search through all your order history.

## Initial Setup

1. For general Tampermonkey setup see: https://github.com/SevenIndirecto/tampermonkey-scripts
2. Open https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/cardmarket.com-quick-history-search/cm-quick-history-serach.user.js and Tampermonkey should prompt you to install. Otherwise add it manually.
3. For your first time using this script, you'll need to wait a while, while the script builds a local browser copy of your order history. This will take a while since requests to CardMarket are throttled / rate limited to avoid getting blocked by cardmarket. It took about an hour on a 14 year old account with 1500+ orders.

## Usage
When you visit https://www.cardmarket.com/en/Magic/Orders/Search?userType=buyer (or seller) or any other game's Order history search you'll have a Quick History Search box at the top.
