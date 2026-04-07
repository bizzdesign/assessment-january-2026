# API Reference

## Standardized Order Schema

All imported orders must be transformed into this schema:

### Required Fields
| Field | Type | Description |
|-------|------|-------------|
| `orderId` | string | Unique order identifier |

### Optional Fields
| Field | Type | Description |
|-------|------|-------------|
| `customerId` | string | Customer identifier |
| `customerEmail` | string | Customer email address |
| `customerName` | string | Customer full name |
| `totalAmount` | number | Total amount in cents (integer) |
| `currency` | string | 3-letter currency code (USD, EUR, GBP) |
| `status` | string | Order status (e.g. pending, confirmed, processing, shipped, delivered, cancelled, refunded) |
| `itemCount` | number | Number of items in order |
| `shippingAddress` | string | Full shipping address |
| `shippingCity` | string | Shipping city |
| `shippingCountry` | string | Shipping country code |
| `createdAt` | string | ISO 8601 timestamp |
| `updatedAt` | string | ISO 8601 timestamp |
| `notes` | string | Order notes |

## Endpoints

### POST /generate/config

Uses an LLM to generate a mapping configuration for transforming source order data.

**Request:**
```json
{
  "sourceFile": "order_id,customer_email,total...",
  "fileType": "csv"
}
```

**Response:**
```json
{
  "config": {
    "name": "order-import",
    "sourceType": "csv",
    "idField": "order_id",
    "fieldMappings": [...],
    "options": { "skipEmptyFields": true, "validateRequired": true }
  },
  "sourceInfo": {
    "fields": ["order_id", "customer_email", "total"],
    "recordCount": 5,
    "sampleRecords": [...]
  }
}
```

### POST /execute/config

Executes a mapping configuration to transform source orders into standardized format.

**Request:**
```json
{
  "config": { ... },
  "sourceFile": "order_id,customer_email,total\n1,test@example.com,2999"
}
```

**Response:**
```json
{
  "valid": true,
  "summary": {
    "totalRecords": 5,
    "successfulImports": 5,
    "failedImports": 0,
    "importedAt": "2026-01-28T12:00:00.000Z"
  },
  "orders": [
    {
      "_sourceIndex": 0,
      "_success": true,
      "order": {
        "orderId": "1",
        "customerEmail": "test@example.com",
        "totalAmount": 2999,
        ...
      }
    }
  ]
}
```

## Sample Data Files

Various order data formats are available in `/sample-data/`:

| File | Format | Description |
|------|--------|-------------|
| `ecommerce-orders.csv` | CSV | Simple e-commerce orders |
| `shopify-export.json` | JSON | Shopify-style nested export |
| `legacy-system.csv` | CSV | Legacy system with codes (SHP, PND, DLV) |
| `woocommerce-export.json` | JSON | WooCommerce with wrapper object |
| `pos-transactions.csv` | CSV | Point-of-sale transactions |

