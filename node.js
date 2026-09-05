import { config } from "./config/config.js";
import express, { request } from "express";
import winston from "winston";
import axios from "axios";
import validateVatPkg from "validate-vat";
const checkVat = validateVatPkg;
import nodecache from "node-cache";
import pg from "pg";
import * as cron from "node-cron"
import { checkVAT, austria, belgium, bulgaria, croatia, cyprus, czechRepublic, denmark, estonia, finland, france, germany, greece, hungary, ireland, italy, latvia, lithuania, luxembourg, malta, netherlands, norway, poland, portugal, romania, slovakiaRepublic, slovenia, spain, sweden, switzerland, unitedKingdom, andorra, brazil, russia, serbia } from "jsvat";

import * as db from "./db.js";
import { get_cache, set_cache, delete_cache, clear_node_cache } from "./cache.js";
import { run as updateVatRatesJob } from "./update_vatrates.js";
import vatRates from "./data/vatrates.json" with { type: "json" };
import vatRatesDetailed from "./data/vatrates_detailed.json" with { type: "json" };
import knownVatNumbers from "./data/known_vat_numbers.json" with { type: "json" };

const countryMap = {
    AD: andorra,  AT: austria,   BE: belgium,   BG: bulgaria,  BR: brazil,
    HR: croatia,  CY: cyprus,    CZ: czechRepublic, DK: denmark, EE: estonia,
    FI: finland,  FR: france,    DE: germany,   EL: greece,    HU: hungary,
    IE: ireland,  IT: italy,     LV: latvia,    LT: lithuania, LU: luxembourg,
    MT: malta,    NL: netherlands, NO: norway,  PL: poland,    PT: portugal,
    RO: romania,  RU: russia,    RS: serbia,    SK: slovakiaRepublic,
    SI: slovenia, ES: spain,     SE: sweden,    CHE: switzerland, GB: unitedKingdom,
};

const logger = winston.createLogger({
    level: config.log.level || "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ level, message, timestamp, ...meta }) => {
                    const extras = Object.keys(meta).length ? JSON.stringify(meta) : "";
                    return `${timestamp} [${level}]: ${message} ${extras}`;
                })
            )
        }),
        new winston.transports.File({ filename: config.log.file, options: { flags: "a" } }),
    ]
});

const PORT = config.port;
const app = express();

app.use(express.json());

app.use((req, res, next) => {
    logger.info("incoming request", { method: req.method, url: req.url });
    next();
});

const validateVat = (countryCode, vatNumber, timeout = null) =>
    new Promise((resolve, reject) => {
        checkVat(countryCode, vatNumber, timeout, (err, result) => {
            if(err) reject(err);
            else resolve(result);
        });
    }
);

function unicode_translate(str){
    return str
        .replace(/å/g, "aa").replace(/Å/g, "Aa")
        .replace(/æ/g, "ae").replace(/Æ/g, "Ae")
        .replace(/ø/g, "oe").replace(/Ø/g, "Oe")
        .replace(/ł/g, "l").replace(/Ł/g, "L")
        .replace(/ß/g, "ss")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
}

function makeValidateResponse(source, data, requestId, duration){
    return {
        success: true,
        source: source,
        data,
        meta: {
            requestId: requestId || null,
            duration: duration
        }
    }
}

function expiresAt(checkedAt){
    return new Date(new Date(checkedAt).getTime() + 24 * 60 * 60 * 1000);
}

function makeVatData(vatnumber, countrycode, registered, checkedAt, result, include_company_info) {
    return {
        vat_number: vatnumber,
        country_code: countrycode,
        registered,
        company: include_company_info ? {
            name: result.company_name ?? null,
            address: result.company_address ?? null,
        } : undefined,
        checked_at: checkedAt,
        expires_at: expiresAt(checkedAt),
        source: "VIES",
    };
}

app.get("/health", (req, res) => {
    const reqid = req.headers["x-request-id"] || crypto.randomUUID()
    const start = new Date()
    try{
        const response = {
            success: true,
            data: {
                status: "ok",
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
                version: "1.0.0"
            },
            meta: {
                requestId: reqid,
                duration: Date.now() - start
            }
        }
        res.status(200).json(response);
        db.insert_api_log("/health", "POST", 200, null, null, reqid, Date.now() - start);
        logger.info("health check responded ok", { status: "ok", timestamp: new Date().toISOString() });
    } catch(err){
        logger.error("error occurred during health check", { err });
        db.insert_api_log("/v1/validate", "POST", err.code, err.code, err.message, reqid, Date.now() - start);
        res.status(500).json({
            success: false,
            error_code: err.code || "INTERNAL_SERVER_ERROR",
            message: err.message || "An unexpected error occurred",
            meta: {
                requestId: req.headers["x-request-id"] || null,
                duration: Date.now() - start
            },
        });
    }
});

// every 5 minutes, send a test VIES request to every VAT number 
// in known_vat_numbers.json and stores it in the database
cron.schedule(`*/5 * * * *`, async () => {
    logger.info("VIES check started!")
    const start = Date.now();
    const requestId = crypto.randomUUID();
    const TIMEOUT_MS = 8000;

    const checks = Object.entries(knownVatNumbers).map(async ([countrycode, { vatnumber, company }]) => {
        const t = Date.now();
        try {
            const result = await validateVat(countrycode, vatnumber, TIMEOUT_MS);
            return {
                country_code: countrycode,
                vatnumber,
                company,
                status: "ok",
                registered: result.valid,
                response_time_ms: Date.now() - t,
                error: null
            };
        } catch (err) {
            return {
                country_code: countrycode,
                vatnumber,
                company,
                status: "error",
                registered: null,
                response_time_ms: Date.now() - t,
                error: err.code || err.message
            };
        }
    });
    const results = await Promise.all(checks);
    const ok     = results.filter(r => r.status === "ok").length;
    const errors = results.filter(r => r.status === "error").length;

    if(results.length > 0){
        await db.pool.query(`DELETE FROM vies_status;`)
    }

    for(let i = 0; i < results.length; i++){
        let entry = results[i]

        await db.pool.query(
            `INSERT INTO vies_status (country_code, vatnumber, company, status, registered, response_time_ms, error)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [entry.country_code, entry.vatnumber, entry.company, entry.status, entry.registered, entry.response_time_ms, entry.error]
        );
    }
    logger.info("VIES check logged to database!")
});

// 1st of every month at 02:00 — scrape iban.com and update data/vatrates.json
cron.schedule("0 2 1 * *", async () => {
    logger.info("monthly vatrates update started");
    try {
        await updateVatRatesJob();
        logger.info("monthly vatrates update completed");
    } catch (err) {
        logger.error("monthly vatrates update failed", { err });
    }
});

app.post("/v1/validate/syntax", (req, res) => {
    const { vatnumber, countrycode } = req.body;
    const start = Date.now();

    const errors = [];
    const warnings = [];

    if(vatnumber === undefined || countrycode === undefined){
        logger.warn("validation request missing required fields", { body: req.body });
        errors.push({ code: "MISSING_FIELDS", message: "vatnumber and countrycode are required" });

        const requestId = req.headers["x-request-id"] || crypto.randomUUID()

        db.insert_api_log("/v1/validate/syntax", "POST", 400, "MISSING_FIELDS", "vatnumber and countrycode are required", requestId, Date.now() - start)
        return res.status(400).json({
            success: false,
            error_code: "VALIDATION_ERROR",
            message: "validation failed",
            errors: errors,
            warnings: warnings,
            meta: {
                requestId: requestId,
                duration: Date.now() - start
            },
        });
    }

    try{
        const country = countryMap[countrycode.toUpperCase()];
        const validator = checkVAT(vatnumber, country ? [country] : []);

        let country_name = validator.country ? validator.country.name : null;
        let ISO_code = validator.country ? validator.country.isoCode.short : null;
        let is_valid = validator.isValid;
        let format_valid = validator.isValidFormat;
        let supported_country = validator.isSupportedCountry;

        if(!supported_country){
            logger.warn("validation requested for unsupported country code", { countrycode });
            errors.push({ code: "UNSUPPORTED_COUNTRY", message: "VAT validation is not supported for the provided country code" });
            
            const requestId = req.headers["x-request-id"] || crypto.randomUUID()
            db.insert_api_log("/v1/validate/syntax", "POST", 400, "UNSUPPORTED_COUNTRY", "VAT validation is not supported for the provided country code", requestId)

            return res.status(400).json({
                success: false,
                error_code: "UNSUPPORTED_COUNTRY",
                message: "VAT validation is not supported for the provided country code",
                errors: errors,
                warnings: warnings,
                meta: {
                    requestId: requestId,
                    duration: Date.now() - start
                },
            });
        }

        const response = {
            success: true,
            data: {
                timestamp: new Date().toISOString(),
                vatnumber: vatnumber,
                countrycode: countrycode,
                country_name: country_name,
                is_supported_country: supported_country,
                ISO_code: ISO_code,
                is_valid: is_valid,
                format_valid: format_valid,
                expected_format: null
            },
            meta: {
                requestId: req.headers["x-request-id"] || crypto.randomUUID(),
                duration: Date.now() - start
            }
        }
        db.insert_api_log("/v1/validate/syntax", "POST", 200, null, null, req.headers["x-request-id"] || crypto.randomUUID(), Date.now() - start)
        res.status(200).json(response);
        logger.info("syntax validation successful", { vatnumber, countrycode, country_name, ISO_code, is_valid, format_valid });
    } catch(err){
        logger.error("error occurred during VAT syntax validation", { err });
        res.status(500).json({
            success: false,
            error_code: err.code || "INTERNAL_SERVER_ERROR",
            message: err.message || "An unexpected error occurred during VAT validation",
            meta: {
                requestId: req.headers["x-request-id"] || null,
                duration: Date.now() - start
            },
        });
        db.insert_api_log("/v1/validate/syntax", "POST", 500, err.code, err.message, req.headers["x-request-id"] || crypto.randomUUID(), Date.now() - start)
    }
})

app.post("/v1/validate", async (req, res) => {
    const start = Date.now();
    const { vatnumber, countrycode, options: { timeout_ms, include_company_info } = {} } = req.body;

    // generate request ID if not provided by client
    const requestId = req.headers["x-request-id"] || crypto.randomUUID();

    const errors = [];
    const warnings = [];

    // syntax validation before VIES call to catch basic errors and avoid unnecessary calls to VIES
    if(vatnumber === undefined || countrycode === undefined){
        logger.warn("validation request missing required fields", { body: req.body });
        errors.push({ code: "MISSING_FIELDS", message: "vatnumber and countrycode are required" });
    } else {
        if(countrycode.length !== 2){
            logger.warn("validation request has invalid countrycode length", { countrycode });
            errors.push({ code: "INVALID_INPUT", message: "countrycode must be a 2-character ISO code" });
        } else {
            const country = countryMap[countrycode.toUpperCase()];
            const syntaxResult = checkVAT(`${countrycode.toUpperCase()}${vatnumber}`, country ? [country] : []);

            if(!syntaxResult.isSupportedCountry){
                logger.warn("validate request for unsupported country", { countrycode });
                errors.push({ code: "UNSUPPORTED_COUNTRY", message: "VAT validation is not supported for the provided country code" });
            } else if(!syntaxResult.isValidFormat){
                logger.warn("validate request failed syntax check", { vatnumber, countrycode });
                errors.push({ code: "INVALID_FORMAT", message: "VAT number format is invalid for the provided country code" });
            }
        }
    }

    if(timeout_ms !== undefined && (typeof timeout_ms !== "number" || timeout_ms <= 0)){
        logger.warn("validation request has invalid timeout_ms value", { timeout_ms });
        errors.push({ code: "INVALID_INPUT", message: "timeout_ms must be a positive number" });
    }

    if(errors.length > 0){
        return res.status(400).json({
            success: false,
            error_code: "VALIDATION_ERROR",
            message: "validation failed",
            errors: errors,
            warnings: warnings,
            meta: {
                requestId: requestId,
                duration: Date.now() - start
            },
        });
    }

    // throw out countries that arent supported right off the bat
    const NON_VIES_COUNTRIES = new Set(["GB", "NO", "CHE", "RU", "RS", "BR"]);
    if (NON_VIES_COUNTRIES.has(countrycode.toUpperCase())) {
        db.insert_api_log("/v1/validate", "POST", 400, "VIES_NOT_SUPPORTED", "This country is not supported by the VIES system", requestId, Date.now() - start)
        
        return res.status(400).json({
            success: false,
            error_code: "VIES_NOT_SUPPORTED",
            message: "This country is not supported by the VIES system",
            meta: {
                requestId: requestId,
                duration: Date.now() - start
            }
        });
    }

    const MAX_RETRIES = 3;
    const RETRYABLE_CODES = new Set([
            "SERVICE_UNAVAILABLE",
            "MS_UNAVAILABLE",
            "MS_MAX_CONCURRENT_REQ",
            "TIMEOUT",
            "SERVER_BUSY",
            "ECONNRESET",
            "ECONNREFUSED",
            "ETIMEDOUT",
        ]);

    // search cache before making VIES call
    try{
        const cached_result = await get_cache(`${countrycode}${vatnumber}`);

        if(cached_result){
            logger.info("cache hit, returning cached result", { vatnumber, countrycode });
            return res.status(200).json({
                success: true,
                source: "cache",
                stale: false,
                data: cached_result,
                meta: {
                    requestId: requestId,
                    duration: Date.now() - start
                }
            });
        }
        db.insert_usage_record(null, "/v1/validate", true, Date.now() - start)
    }catch(err){
        // do nothing
    };

    // check database cache before making VIES call
    try{
        const db_result = await db.get_lookup_validation(vatnumber, countrycode)
        if (db_result) {
            const vat_data = makeVatData(vatnumber, countrycode, db_result.registered, db_result.checked_at, db_result, include_company_info);
            const vat_response = makeValidateResponse("database", vat_data, requestId, Date.now() - start);
            
            db.insert_usage_record(null, "/v1/validate", true, Date.now() - start)
            logger.info("database cache hit, returning cached result", { vatnumber, countrycode });
            return res.status(200).json(vat_response);
        }
    }catch(err){
        // do nothing
    }

    let result;
    let lastErr;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            result = await validateVat(countrycode, vatnumber, timeout_ms ?? 5000);
            break;
        } catch (err) {
            lastErr = err;
            if (!RETRYABLE_CODES.has(err.code) || attempt === MAX_RETRIES) {
                logger.error("VAT validation failed, not retrying", { err, attempt });
                return res.status(503).json({
                    success: false,
                    error_code: err.code || "VIES_ERROR",
                    message: err.message,
                    retryable: RETRYABLE_CODES.has(err.code),
                    meta: {
                        requestId: requestId,
                        duration: Date.now() - start
                    }
                });
            }
            logger.warn("VAT validation failed, retrying...", { err, attempt });
            await new Promise(r => setTimeout(r, 500 * attempt));
        }
    }

    // unicode translation
    result.name = unicode_translate(result.name)
    result.address = unicode_translate(result.address);

    const response = {
        success: true,
        data: {
            vat_number: vatnumber,
            country_code: countrycode,
            registered: result.valid,
            company: include_company_info ? {
                name: result.name !== "---" ? result.name : null,
                address: result.address !== "---" ? result.address : null,
            } : undefined,
            checked_at: result.requestDate,
            source: "VIES",
        },
        meta: {
            requestId: requestId,
            duration: Date.now() - start
        }
    };

    const checked_at = new Date();
    const expires_at = expiresAt(checked_at.getTime());
    const duration = Date.now() - start;

    response["data"]["expires_at"] = expires_at;
    res.status(200).json(response);

    if(result.valid){
        set_cache(`${countrycode}${vatnumber}`, response.data);
        db.insert_validation(vatnumber, countrycode, result.valid, result.name, result.address, checked_at, expires_at)
    }
    db.insert_api_log("/v1/validate", "POST", 200, null, null, requestId, duration);
    logger.info("VAT validation successful", { vatnumber, countrycode, valid: result.valid });
});

// 28/34 VAT numbers source: https://www.iban.com/vat-checker
app.get("/v1/countries", (req, res) => {
    const start = Date.now()

    res.status(200).json({
        success: true,
        data: vatRates,
        meta: {
            requestId: req.headers["x-request-id"] || crypto.randomUUID(),
            count: vatRates.length,
            last_updated: "2026-04-30",
            cache: true,
            duration: Date.now() - start
        }
    });
    db.insert_api_log("/v1/countries", "GET", 200, null, null, req.headers["x-request-id"] || crypto.randomUUID(), Date.now() - start)
    db.insert_usage_record(null, "/v1/countries", true, Date.now() - start)
})

app.get("/v1/countries/:code", (req, res) => {
    const start = Date.now()
    const code = req.params.code.toUpperCase();

    if(!vatRatesDetailed[code]){
        const failed = {
            success: false,
            error_code: "CODE_NOT_FOUND",
            message: "code wasnt found in list of valid country codes",
            meta: {
                requestId: req.headers["x-request-id"] || crypto.randomUUID(),
                duration: Date.now() - start
            }
        }
        db.insert_usage_record(null, `/v1/countries/${code}`, true, Date.now() - start)
        return res.json(failed);
    }

    const detailed_rates = vatRatesDetailed[code].rates

    const result = {
        success: true,
        source: "database"
    }
    
    for(let index in vatRates){
        let country_code = vatRates[index]["code"]
        if(country_code == code){
            result["data"] = vatRates[index];
            break
        }
    }

    result["data"]["last_updated"] = vatRatesDetailed[code].last_updated
    result["data"]["rates"] = detailed_rates
    result["meta"] = {
        requestId: req.headers["x-request-id"] || crypto.randomUUID(),
        duration: Date.now() - start
    }

    return res.status(200).json(result)
})

app.get("/v1/rates/:country_code", (req, res) => {
    const start = Date.now();
    const code = req.params.country_code.toUpperCase();
    const country = vatRatesDetailed[code];

    if (!country) {
        return res.status(404).json({
            success: false,
            error_code: "COUNTRY_NOT_FOUND",
            message: `No rate data found for country code: ${code}`,
            meta: {
                requestId: req.headers["x-request-id"] || crypto.randomUUID(),
                duration: Date.now() - start
            }
        });
    }

    res.status(200).json({
        success: true,
        data: {
            country_code: code,
            country_name: country.country_name,
            rates: country.rates,
            last_updated: country.last_updated
        },
        meta: {
            requestId: req.headers["x-request-id"] || crypto.randomUUID(),
            duration: Date.now() - start
        }
    });
    db.insert_usage_record(null, `/v1/rates/${code}`, true, Date.now() - start)
})

app.get("/v1/status/vies", async (req, res) => {
    const start = Date.now()
    // this checks vies_status table entries in database for vies statuses
    const countries = []
    const errors = []
    let last_checked = null

    try{
        const response = await db.pool.query("SELECT * FROM vies_status;")
        for(let vies in response.rows){
            let vies_result = response.rows[vies]

            let country = {}

            country["code"] = vies_result.country_code
            vies_result.status === "ok" ? country["status"] = "operational" : country["status"] = "down"
            country["avg_response_ms"] = vies_result.response_time_ms

            countries.push(country)
            country = {}
        }
        last_checked = response.rows[0]?.checked_at ?? null
    } catch(err){
        errors.push({code: err.code, message: err.message})
    }

    const allOk  = countries.every(c => c.status === "operational");
    const allDown = countries.every(c => c.status === "down");
    const overall_status = allOk ? "operational" : allDown ? "down" : "degraded";

    let result = {
        success: true,
        source: "database",
        data: {
            overall_status: overall_status,
            last_checked: last_checked,
            countries: countries
        },
        meta: {
            requestId: req.headers["x-request-id"] || crypto.randomUUID(),
            duration: Date.now() - start
        }
    }

    if(errors.length > 0){
        result["errors"] = errors
    }else{
        db.insert_usage_record(null, `/v1/status/vies`, true, Date.now() - start)
        result["errors"] = null
    }

    return res.status(200).json(result)
})

app.listen(PORT, '0.0.0.0', () => {
    logger.info("server started", { port: PORT, url: `http://localhost:${PORT}` });
});
