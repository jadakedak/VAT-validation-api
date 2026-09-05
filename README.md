# VAT Validation API

A comprehensive REST API for validating VAT numbers across multiple countries. This API provides real-time VAT verification, VAT rate lookups, and caching mechanisms for optimal performance.

## Features

- ✅ **Multi-country VAT validation** – Support for 30+ countries including EU member states, UK, Switzerland, and more
- 🔄 **Real-time VAT checking** – Validates VAT numbers against official government services
- 💾 **Intelligent caching** – In-memory caching with PostgreSQL fallback for high-performance lookups
- 📊 **VAT rate lookups** – Get current and detailed VAT rates by country
- 🔐 **Rate limiting & logging** – Built-in Winston logging and API usage tracking
- 🕐 **Automatic data updates** – Scheduled cron jobs to refresh VAT rate data
- 🚀 **Production-ready** – Error handling, input validation, and comprehensive API endpoints

## Tech Stack

- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js
- **Database**: PostgreSQL
- **Caching**: Node-cache + PostgreSQL
- **Validation**: jsvat, validate-vat
- **Logging**: Winston
- **Task scheduling**: node-cron
- **HTTP client**: Axios

## Installation

### Prerequisites
- Node.js (v16+)
- PostgreSQL database
- Environment variables configured

### Setup

1. **Clone and install dependencies**
   ```bash
   git clone <repository-url>
   cd VAT-validation-api-main
   npm install
   ```

2. **Configure environment variables**
   Create a `.env` file in the root directory:
   ```
   PORT=3000
   NODE_ENV=production
   DB_HOST=your_db_host
   DB_PORT=5432
   DB_NAME=vat_api_db
   DB_USER=your_db_user
   DB_PASSWORD=your_db_password
   LOG_LEVEL=info
   CACHE_ENABLED=true
   ```

3. **Start the server**
   ```bash
   npm start
   ```

The API will start on `http://localhost:3000`

## API Endpoints

### Validate VAT Number
```
POST /api/validate
Content-Type: application/json

{
  "country_code": "DK",
  "vat_number": "12345678"
}
```

**Response:**
```json
{
  "valid": true,
  "country": "Denmark",
  "vat_number": "12345678",
  "cached": false
}
```

### Get VAT Rates
```
GET /api/vat-rates
```

Returns current VAT rates for all supported countries.

### Get Detailed VAT Information
```
GET /api/vat-rates/detailed
```

Returns detailed VAT rates including reduced rates, super-reduced rates, and zero rates.

### Get Specific Country VAT Rate
```
GET /api/vat-rates/:country_code
```

Example: `GET /api/vat-rates/DK` returns Danish VAT rates.

## Project Structure

```
.
├── node.js                    # Main Express server and API endpoints
├── db.js                      # Database connection and queries
├── cache.js                   # Caching logic (node-cache + PostgreSQL)
├── config/
│   └── config.js             # Environment and configuration management
├── data/
│   ├── vatrates.json         # Standard VAT rates by country
│   ├── vatrates_detailed.json # Detailed VAT rates with all variations
│   └── known_vat_numbers.json # Pre-validated VAT numbers for testing
├── update_vatrates.js        # Scheduled job to update VAT rate data
├── logs/
│   └── app.log               # Application logs
└── package.json              # Dependencies and scripts
```

## Key Components

### Caching Strategy
The API uses a two-tier caching system:
1. **Node-cache** – Fast in-memory cache for validated VAT numbers
2. **PostgreSQL** – Persistent cache for data redundancy and scalability

Cache keys are automatically managed, with options to clear and update caches as needed.

### VAT Validation
Supports validation across 30+ countries using the `jsvat` library:
- All EU member states
- UK, Switzerland, Norway
- Brazil, Russia, Serbia, Andorra

### Logging
Winston logger tracks all API requests, errors, and system events with timestamp and JSON formatting.

### Scheduled Updates
Node-cron jobs automatically refresh VAT rate data at configured intervals to ensure accuracy.

## Usage Examples

### Node.js
```javascript
import fetch from 'node-fetch';

const validateVAT = async (country, vat) => {
  const response = await fetch('http://localhost:3000/api/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ country_code: country, vat_number: vat })
  });
  return response.json();
};

const result = await validateVAT('DK', '12345678');
console.log(result);
```

### cURL
```bash
curl -X POST http://localhost:3000/api/validate \
  -H "Content-Type: application/json" \
  -d '{"country_code":"DK","vat_number":"12345678"}'
```

## Notes

⚠️ **Important**: To run this API in production, you will need:
- A VPS or cloud server to host the PostgreSQL database
- Proper environment variable configuration
- API key management for usage tracking (configured in `db.insert_usage_record`)

## Known Limitations & Future Improvements

- Current caching uses Node-cache; consider migrating to Redis for better distributed caching
- Can be extended to support additional countries
- All API requests should be logged and monitored (TODO: comprehensive logging for all endpoints)
- Extensive testing needed with various invalid inputs

## License

MIT

---

**Questions or issues?** Open an issue on GitHub or contact the developer.
