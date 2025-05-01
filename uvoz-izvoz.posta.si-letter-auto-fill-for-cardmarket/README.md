# Posta.si IMPORT/EXPORT form auto filler for cardmarket

![Preview](https://raw.githubusercontent.com/SevenIndirecto/tampermonkey-scripts/refs/heads/master/uvoz-izvoz.posta.si-letter-auto-fill-for-cardmarket/preview.gif)

## What is it?

> Sanity warning, extremely niche. 

Are you using CardMarket.com and shipping registered packages via https://uvoz-izvoz.posta.si/en/export/shipment? This script can automate this annoying form.

This script will add an "Auto Fill Form" Button to https://uvoz-izvoz.posta.si/en/export/shipment allowing you to copy the Recipient address lines from CardMarket.com and by pressing single button fill out this whole form. 

*NOTE* This has been tested using the english version of the page, but likely works for the /si/ version as well.

## Initial Setup

1. For general Tampermonkey setup see: https://github.com/SevenIndirecto/tampermonkey-scripts
2. Open https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/uvoz-izvoz.posta.si-letter-auto-fill-for-cardmarket/posta.si-import-export-autofill.user.js and Tampermonkey should prompt you to install. Otherwise add it manually.
4. Input your own address under the `// Personalize here` section (between `"..."`) and save.
5. Note that after setting up your personalized settings you shouldn't update the script anymore, or you'll need to update them again. However the script is stable, so unlikely it will need updates until posta.si changes something.

## Usage

1. In your card market shipment, copy the Shipping address. Something like this should be in your clipboard

```
John Doe
Triebstraße 7
60388 Frankfurt Am Main
Germany
```

2. Go to https://uvoz-izvoz.posta.si/en/export/shipment/ and select "Letter" -> "Agree" -> "Continue"
3. On the next screen press the "Auto Fill Form" button in the top right. That's it.


## Troubleshooting and disclaimers

* Currently only works with Shipping Addresses which are formatted to have 4 lines exactly. If you run into somebody that has more lines, just change it to 4 lines in a text editor and copy those 4 lines.
