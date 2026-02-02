# assessment-january-2026

Frontend & LLM Prompting Assessment

## Setup

```bash
npm install
```

Set your OpenAI API key:
```bash
export OPENAI_API_KEY=your-key-here
```

Run the server:
```bash
npm start
```

## Endpoints

### POST /generate/config

Uses an LLM to generate a mapping configuration based on user input.

**Request:**
```json
{
  "prompt": "Create a mapping to import CSV user data into the users repository. Source has columns: user_id, email_address, full_name"
}
```

**Response:**
```json
{
  "config": { ... }
}
```

### POST /execute/config

Validates a mapping configuration and simulates importing data using it.

**Request (validate only):**
```json
{
  "config": {
    "name": "user-import",
    "sourceType": "csv",
    "targetRepository": "users",
    "fieldMappings": [
      { "sourceField": "user_id", "targetField": "id" },
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

**Request (with data to import):**
```json
{
  "config": { ... },
  "sourceData": [
    { "user_id": "1", "email_address": "alice@example.com", "full_name": "  Alice Smith  " },
    { "user_id": "2", "email_address": "bob@example.com", "full_name": "Bob Jones" }
  ]
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
    "targetRepository": "users"
  },
  "importedRecords": [
    { "_index": 0, "_success": true, "_errors": [], "record": { "id": "1", "email": "alice@example.com", "name": "Alice Smith" } },
    { "_index": 1, "_success": true, "_errors": [], "record": { "id": "2", "email": "bob@example.com", "name": "Bob Jones" } }
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