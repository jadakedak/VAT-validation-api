import pg from "pg";
import { config } from "./config/config.js";
import axios from "axios";
import * as cheerio from "cheerio";

export const pool = new pg.Pool({
    ...config.db,
    max:      10,
    idleTimeoutMillis: 30000,
});

export async function insert_validation(vatnumber, countrycode, registered, company_name, company_address, checked_at, expires_at){
    await pool.query(
        `INSERT INTO validations (vat_number, country_code, registered, company_name, company_address, checked_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (vat_number, country_code)
        DO UPDATE SET registered = $3, company_name = $4, company_address = $5, checked_at = $6, expires_at = $7`,
        [vatnumber, countrycode, registered, company_name, company_address, checked_at, expires_at]
    );
}
export async function get_lookup_validation(vatNumber, countryCode) {
    const result = await pool.query(
        `SELECT * FROM validations WHERE vat_number = $1 AND country_code = $2`,
        [vatNumber, countryCode]
    );
    return result.rows[0];
}
export async function insert_api_log(endpoint, method, status_code, error_code=null, error_message=null, requestId, duration) {
    await pool.query(
        `INSERT INTO api_logs (endpoint, method, status_code, response_time, error_code, error_message, request_id, created_at, duration)
        VALUES ($1, $2, $3, EXTRACT(EPOCH FROM NOW())::integer, $4, $5, $6, NOW(), $7)`,
        [endpoint, method, status_code, error_code, error_message, requestId, duration]
    );
}


// scrapes https://www.iban.com/vat-checker for updated vat rates
export async function iban_rate_check(){
    const res = await axios.get("https://www.iban.com/vat-checker"); // has 28 out of 34 of countries in countryMap
    const $ = cheerio.load(res.data);

    const countries = [];
    $("tbody tr").each((_, row) => {
        const cols = $(row).find("td");
        if (cols.length >= 3) {
            countries.push({
                country:  $(cols[0]).text().trim(),
                code:     $(cols[1]).text().trim(),
                vat_name: $(cols[2]).text().trim(),
            });
        }
    });
    return countries
}

export async function get_api_logs() {
    const result = await pool.query(
        `SELECT * FROM api_logs ORDER BY timestamp DESC`
    );
    return result.rows;
}
export async function clear_cache() {
    await pool.query(`DELETE FROM vat_lookups`);
}
export async function clear_logs() {
    await pool.query(`DELETE FROM api_logs`);
}

export async function insert_usage_record(api_key, endpoint, cached, duration_ms){
    await pool.query(
        `INSERT INTO usage_records (api_key, endpoint, cached, duration_ms)
        VALUES ($1, $2, $3, $4)`,
        [api_key, endpoint, cached, duration_ms]
    );
}
export async function get_usage_record(api_key){
    const result = await pool.query(
        `SELECT * FROM usage_records WHERE api_key = $1 ORDER BY timestamp DESC`,
        [api_key]
    );
    return result.rows;
}
export async function get_usage_records(){
    const result = await pool.query(
        `SELECT * FROM usage_records ORDER BY timestamp DESC`
    );
    return result.rows;
}
