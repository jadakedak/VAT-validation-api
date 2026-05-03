import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import * as db from "./db.js"
import vatRates from "./data/vatrates.json" with { type: "json" };

export async function get_iban_rates(){
    const countrymatches = {};
    const ratecheck = await db.iban_rate_check();

    for (const entry of vatRates) {
        const country_code = entry["code"];
        for (const row of ratecheck) {
            if (row.code === country_code) {
                countrymatches[country_code] = row.vat_name;
            }
        }
    }
    return countrymatches;
}

export function updateVatRates(dict) {
    const path = resolve("data/vatrates.json");
    const rates = JSON.parse(readFileSync(path, "utf-8"));

    for (const entry of rates) {
        const raw = dict[entry.code];
        if (raw === undefined) continue;
        const match = raw.match(/[\d.]+/);
        if (match) entry.standard_rate = parseFloat(match[0]);
    }

    writeFileSync(path, JSON.stringify(rates, null, 2));
    console.log("vatrates.json updated");
}

export async function run() {
    const rates = await get_iban_rates();
    updateVatRates(rates);
}

// only auto-run when executed directly (node update_vatrates.js)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    run();
}