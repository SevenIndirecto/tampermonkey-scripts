# Cardmarket.com shipping estimator

![Preview](https://raw.githubusercontent.com/SevenIndirecto/tampermonkey-scripts/refs/heads/master/cardmarket.com-shipping-estimator/preview.png)

## What is it?

* This script automatically adds shipping estimates to the Singles page on CardMarket/Magic.
* A secondary function is that the script hides offers from users that won't ship to you.

## Initial Setup

1. For general Tampermonkey setup see: https://github.com/SevenIndirecto/tampermonkey-scripts
2. Open https://raw.githubusercontent.com/SevenIndirecto/tampermonkey-scripts/refs/heads/master/cardmarket.com-shipping-estimator/cm-shipping-estimator.user.js and Tampermonkey should prompt you to install. Otherwise add it manually.

## Usage

When viewing `/*/Magic/Products/Singles/*` pages like https://www.cardmarket.com/en/Magic/Products/Singles/Visions/Chronatog you'll see shipping estimates.

Shipping estimates work for Slovenia and are configured in the script file under SHIPPING_PRICES.
If you want to modify this for your country, you'll need to input shipping estimates manually and avoid auto-updating this script.

Note that some professional sellers have custom shipping costs. I might make a list of some larger ones to be used with this script at some point, but for now they're estimates will be wrong, generally too high.
