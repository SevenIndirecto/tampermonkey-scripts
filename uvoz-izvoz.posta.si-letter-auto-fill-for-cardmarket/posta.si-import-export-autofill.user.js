// ==UserScript==
// @name         Posta.si Auto-Fill for Cardmarket.com registered shipments
// @version      0.1.0
// @description  Autofill Import / Export registered letter form on posta.si for help with cardmarket shipments
// @author       seven
// @namespace    https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/uvoz-izvoz.posta.si-letter-auto-fill-for-cardmarket/
// @updateURL    https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/uvoz-izvoz.posta.si-letter-auto-fill-for-cardmarket/posta.si-import-export-autofill.user.js
// @downloadURL  https://github.com/SevenIndirecto/tampermonkey-scripts/raw/refs/heads/master/uvoz-izvoz.posta.si-letter-auto-fill-for-cardmarket/posta.si-import-export-autofill.user.js
// @match        https://uvoz-izvoz.posta.si/en/export/shipment*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

// Personalize here
const senderName = "YOUR_NAME_AND_SURNAME_HERE";
const senderStreet = "YOUR_ADDRESS, e.g. Mariborska 101";
const senderPost = "YOUR_POST_NUMNER";
const senderCity = "YOUR_CITY";
const senderEmail = "YOUR_EMAIL";

// ------------------------------------------
// NOTE: No editing required after this point
function triggerInput(input) {
    input.dispatchEvent(new Event("input", {bubbles: true, cancelable: false, composed: true}));
}

async function fillForm() {
    document.querySelectorAll("input[name='shipment.category.categoryType']")[1].click();
    await new Promise(resolve => setTimeout(resolve, 100));
    document.querySelectorAll("input[name='additionalServiceList']")[1].click();

    let i = document.getElementById("sender.name");
    i.value = senderName;
    triggerInput(i);

    i = document.getElementById("sender.street");
    i.value = senderStreet;
    triggerInput(i);
    await new Promise(resolve => setTimeout(resolve, 100));
    i = document.querySelector("input[name='sender.post']");
    i.value = senderPost;
    triggerInput(i);
    await new Promise(resolve => setTimeout(resolve, 100));
    i = document.querySelector("input[name='sender.city']");
    i.value = senderCity;
    triggerInput(i);
    i = document.querySelector("input[name='sender.email']");
    i.value = senderEmail;
    triggerInput(i);


    // Fill recipient
    const recipientData = await navigator.clipboard.readText();
    if (!recipientData) {
        alert("Could not get clipboard data");
        return;
    }
    const lines = recipientData.split("\n");
    if (lines.length < 4) {
        alert("Unexpected clipboard format");
        return
    }
    i = document.getElementById("consignee.name");
    i.value = lines[0].trim();
    triggerInput(i);
    i = document.getElementById("consignee.street");
    i.value = lines[1].trim();
    triggerInput(i);
    await new Promise(resolve => setTimeout(resolve, 100));

    const postSplit = lines[2].split(" ");
    i = document.querySelector("input[name='consignee.post']");
    i.value = postSplit[0];
    triggerInput(i);
    await new Promise(resolve => setTimeout(resolve, 100));
    i = document.querySelector("input[name='consignee.city']");
    i.value = postSplit.splice(1).join(" ");
    triggerInput(i);

    i = document.querySelector("input[name='shipment.items[].goodsDescription']");
    i.value = "cards";
    triggerInput(i);

    // Contents
    const kInputs = document.querySelectorAll("input.k-input-inner");
    kInputs[2].value = "5";
    triggerInput(kInputs[2]);
    kInputs[3].value = "0.017";
    triggerInput(kInputs[3]);
    kInputs[4].value = "0.01";
    triggerInput(kInputs[4]);

    // Recipient country
    kInputs[1].value = lines[3].trim();
    triggerInput(kInputs[1]);
    await new Promise(resolve => setTimeout(resolve, 500));
    document.querySelector(".k-list-item.k-focus").click();
}


(function() {
    setTimeout(() => {
        const btn = document.createElement("button");
        btn.innerHTML = "Auto Fill Form";
        document.getElementById('navbarPrimaryCollapse').appendChild(btn);
        btn.addEventListener('click', fillForm);
    }, 200);
})();
