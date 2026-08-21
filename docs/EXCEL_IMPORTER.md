# Excel Importer for LCL Tariffs

The Excel importer enables bulk import of co-loader LCL (Less than Container Load) tariff files into the vendor rates database. It supports two industry-standard formats: **Solid Xpress/Globelink** and **ECU Worldwide**.

## API Endpoint

```
POST /api/rates/import?vendorId=<uuid>&effectiveDate=<ISO-8601-date>
Content-Type: multipart/form-data

file: <Excel file (XLSX)>
```

### Parameters

- **vendorId** (required, UUID): The vendor to import rates for
- **effectiveDate** (optional, ISO-8601): When the rates become effective (defaults to today)

### Response

```json
{
  "created": 45,
  "updated": 12,
  "errors": ["Row 15: Invalid rate value...", ...]
}
```

## Supported Formats

### 1. Solid Xpress OCEAN FREIGHT

**Sheet name**: `OCEAN FREIGHT`

**Expected columns**:
- destination / Destination
- rate / Rate / Cost (per W/M, supports "F.O.C" for zero cost, "ON REQUEST" for on-request availability)
- min / Min / minimumCharge (minimum charge in CBM)
- surcharges / Surcharges (optional)
- via / Via / viaPort (e.g., "DIRECT", "SIN", "PUS")
- transit / Transit / transitDays (text format, e.g., "10-12", "STI")
- collect / Collect / freightCollect (Y/N for freight collect flag)
- effective date / Effective Date (optional; uses endpoint param if not in file)
- remark / Remark (optional notes)

**Example row**:
```
destination | rate  | min | via    | transit | collect
HO CHI MINH | -17   | 120 | DIRECT | 10-12   | Y
SINGAPORE  | 45.50 | 150 | SIN    | 7-8     | N
```

**Features**:
- Automatically infers country from destination name (e.g., "HO CHI MINH" → VIETNAM)
- Sets weightRatio to 333 kg/CBM (Solid Xpress standard)
- Detects "F.O.C" (free of charge) as zero cost
- Detects "ON REQUEST" as ON_REQUEST availability status
- Detects "SUSPENDED" in remarks as SUSPENDED availability

---

### 2. ECU Worldwide EXPORT TARIFF

**Sheet name**: `EXPORT TARIFF`

**Expected columns**:
- port / Port / origin (port of origin, e.g., "PUS", "BANGKOK")
- province / Province / destination (destination/region)
- rate / Rate / Cost (per W/M)
- min / Min / minimumCharge (minimum charge in CBM)
- surcharges / Surcharges (optional JSON array)
- via / Via / viaPort (e.g., "DIRECT")
- transit / Transit / transitDays
- collect / Collect / freightCollect (Y/N)

**Example row**:
```
port     | province    | rate   | min | via    | transit | collect
BANGKOK  | NORTH ASIA  | 55.00  | 100 | DIRECT | 5       | Y
BANGKOK  | SOUTH ASIA  | 60.75  | 150 | SIN    | 8-10    | N
```

**Features**:
- Port (origin) must be specified; province (destination) is optional
- Sets weightRatio to 333 kg/CBM (ECU WW standard)
- Supports surcharges as JSON-formatted string
- Handles text-based transit day formats ("STI", "ON REQUEST", etc.)

---

## Pricing and Calculations

All imported rates use **PER_WM** (weight-or-measure) rate type, where:
- **Chargeable W/M** = max(volume in CBM, weight in KG ÷ weightRatio)
- **Default weightRatio**: 1000 kg/CBM (if vendor doesn't specify)
- **Solid Xpress & ECU WW**: 333 kg/CBM

### Example Quotation with Imported Rates

**Shipment**: 2000 kg, 3 CBM to Ho Chi Minh from Solid Xpress tariff

```
Chargeable W/M = max(3, 2000/333) = max(3, 6.006) = 6.006 CBM
Rate = -17 (rebate, per imported tariff)
Unit Cost = -17 × 6.006 = -102.10 (in quotation currency)
Minimum Charge = 120 (from tariff)
Total Cost = max(-102.10, 120) = NOT APPLIED (min only when cost < min && min > 0)
           = -102.10 ✓ (rebate preserved)

With 25% markup:
Unit Sell = -17 + |-17| × (25/100) = -17 + 4.25 = -12.75
Total Sell = 6.006 × -12.75 = -76.58
Gross Profit = -76.58 − (-102.10) = +25.52 ✓ (rebate credit)
GP% = 25.52 / |-76.58| × 100 = 33.3%
```

---

## Import Workflow

### 1. Prepare Excel File

Ensure the file has:
- Correct sheet name ("OCEAN FREIGHT" or "EXPORT TARIFF")
- Headers in the expected format (flexible; normalized on import)
- Data rows starting after headers
- No blank rows between data (can be at end)

### 2. Create Vendor (if new)

```bash
curl -X POST http://localhost:4000/api/vendors \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Solid Xpress Logistics",
    "email": "rates@solidxpress.com",
    "status": "ACTIVE"
  }'
# Returns: { "id": "vendor-uuid", "code": "VEN-0001", ... }
```

### 3. Upload File

```bash
curl -X POST "http://localhost:4000/api/rates/import?vendorId=vendor-uuid&effectiveDate=2026-01-01" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -F "file=@solid_xpress_tariff.xlsx"
# Returns: { "created": 45, "updated": 0, "errors": [] }
```

### 4. Verify in UI

- Go to `/rates` → filter by vendor
- Go to `/compare` → select service + lane → see imported rates
- Create a quotation → select the new rates → verify costing

---

## Error Handling

Import errors are collected and returned per row:
- **Invalid rate value**: Cannot parse number (e.g., "invalid_123")
- **Missing required field**: Destination/port is blank
- **Malformed surcharges JSON**: Surcharge field is not valid JSON

Non-fatal errors don't stop the import; successfully parsed rows are still created/updated.

---

## Future Enhancements

- [ ] UI file upload dialog in `/rates` page
- [ ] Batch import multiple vendors/files
- [ ] Rate update history / audit trail
- [ ] Scheduled re-import from shared drives (e.g., Box, OneDrive)
- [ ] Surcharge detail UI (display as expandable table)
- [ ] Before/after comparison preview before import commit
