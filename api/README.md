# assessment-january-2026

Frontend & LLM Prompting Assessment

## Setup

```bash
npm install
```

Set your OpenRouter API key (get one at https://openrouter.ai/keys):
```bash
export OPENROUTER_API_KEY=your-key-here
```

Run the server:
```bash
npm start
```

## Endpoints

### POST /generate/config

Uses an LLM to generate a mapping configuration based on a source file.

**Request:**
```json
{
  "sourceFile": "user_id,email_address,full_name\n1,alice@example.com,Alice Smith",
  "fileType": "csv",
  "targetRepository": "users"
}
```

**Response:**
```json
{
  "config": {
    "name": "user-import",
    "sourceType": "csv",
    "targetRepository": "users",
    "idField": "user_id",
    "fieldMappings": [
      { "sourceField": "email_address", "targetField": "email" },
      { "sourceField": "full_name", "targetField": "name", "transform": "trim" }
    ],
    "options": {
      "skipEmptyFields": true,
      "validateRequired": true
    }
  }
}
```

### POST /execute/config

Executes a mapping configuration against a source file, producing standardized output.

**Request:**
```json
{
  "config": {
    "name": "user-import",
    "sourceType": "csv",
    "targetRepository": "users",
    "idField": "user_id",
    "fieldMappings": [
      { "sourceField": "email_address", "targetField": "email" },
      { "sourceField": "full_name", "targetField": "name", "transform": "trim" }
    ],
    "options": {
      "skipEmptyFields": true,
      "validateRequired": true
    }
  },
  "sourceFile": "user_id,email_address,full_name\n1,alice@example.com,  Alice Smith  \n2,bob@example.com,Bob Jones"
}
```

**Response (successful import):**
```json
{
  "valid": true,
  "summary": {
    "totalRecords": 2,
    "successfulImports": 2,
    "failedImports": 0,
    "targetRepository": "users",
    "importedAt": "2026-01-28T12:00:00.000Z"
  },
  "records": [
    {
      "id": "1",
      "type": "users",
      "data": { "email": "alice@example.com", "name": "Alice Smith" },
      "_meta": { "sourceIndex": 0, "importedAt": "2026-01-28T12:00:00.000Z", "success": true }
    },
    {
      "id": "2",
      "type": "users",
      "data": { "email": "bob@example.com", "name": "Bob Jones" },
      "_meta": { "sourceIndex": 1, "importedAt": "2026-01-28T12:00:00.000Z", "success": true }
    }
  ]
}
```

**Response (invalid config):**
```json
{
  "valid": false,
  "errors": [
    { "path": "fieldMappings", "message": "Missing required target field: \"email\"" }
  ]
}
```

## Standardized Output Format

All imported records are transformed into a consistent structure:

```json
{
  "id": "string",           // Unique identifier from source (via idField)
  "type": "string",         // Target repository (users, products, orders)
  "data": { ... },          // Mapped field values
  "_meta": {
    "sourceIndex": 0,       // Position in source file
    "importedAt": "...",    // ISO timestamp
    "success": true,        // Whether import succeeded
    "errors": []            // Any transformation errors
  }
}
```

## Available Repositories

The following target repositories are available:

- **users**: required `[id, email, name]`, optional `[phone, address, role]`
- **products**: required `[sku, name, price]`, optional `[description, category, stock]`
- **orders**: required `[orderId, customerId, total]`, optional `[status, createdAt, items]`

## Available Transforms

- `none` - no transformation
- `uppercase` - convert to uppercase
- `lowercase` - convert to lowercase  
- `trim` - trim whitespace
- `number` - convert to number

## Sample Data

Sample source files are available in `/sample-data/`:

- `users.csv` - CSV user data → users repository
- `products.json` - JSON product data → products repository  
- `orders.csv` - CSV order data → orders repository
- `inventory.json` - Nested JSON inventory data → products repository
