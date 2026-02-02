import 'dotenv/config';
import express from 'express';
import { z } from 'zod';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

// ============================================================================
// OPENROUTER CONFIGURATION
// ============================================================================
// Set your API key: export OPENROUTER_API_KEY=your-key-here
// Get a key at: https://openrouter.ai/keys

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Available models (pick one to use with openrouter('model-id')):
// See full list at: https://openrouter.ai/models
//
// RECOMMENDED MODELS:
//   anthropic/claude-sonnet-4-6 - Excellent reasoning and instruction following
//   anthropic/claude-haiku-4-5  - Fast and cheap, good for simple tasks
//   openai/gpt-4o               - Strong overall, fast, great at structured output
//   openai/gpt-4o-mini          - Cheaper, still very capable
//   google/gemini-2.5-flash     - Very fast, good value
//   google/gemini-2.5-pro       - Strong reasoning, large context
//   deepseek/deepseek-chat-v3   - Very cheap, surprisingly capable

const app = express();
app.use(express.json({ limit: '10mb' }));

// Enable CORS for testing
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ============================================================================
// STANDARDIZED ORDER SCHEMA
// ============================================================================
// All imported order data must be transformed into this standardized format.
// The LLM's job is to map from various source formats to this target schema.

const StandardizedOrderSchema = z.object({
  // Required field - every order must have an ID
  orderId: z.string().describe('Unique order identifier'),

  // All other fields are optional - map as many as possible from source
  customerId: z.string().optional().describe('Customer identifier'),
  customerEmail: z.string().optional().describe('Customer email address'),
  customerName: z.string().optional().describe('Customer full name'),
  totalAmount: z.number().optional().describe('Total order amount in cents (integer)'),
  currency: z.string().optional().describe('3-letter currency code (e.g., USD, EUR, GBP)'),
  status: z.string().optional().describe('Order status (e.g., pending, shipped, delivered)'),
  itemCount: z.number().optional().describe('Number of items in order'),
  shippingAddress: z.string().optional().describe('Shipping address as single string'),
  shippingCity: z.string().optional().describe('Shipping city'),
  shippingCountry: z.string().optional().describe('Shipping country code'),
  createdAt: z.string().optional().describe('Order creation timestamp (ISO 8601)'),
  updatedAt: z.string().optional().describe('Last update timestamp (ISO 8601)'),
  notes: z.string().optional().describe('Order notes or special instructions'),
});

// The target schema that the LLM needs to map to
const TARGET_ORDER_SCHEMA = {
  required: ['orderId'],
  optional: ['customerId', 'customerEmail', 'customerName', 'totalAmount', 'currency', 'status', 'itemCount', 'shippingAddress', 'shippingCity', 'shippingCountry', 'createdAt', 'updatedAt', 'notes'],
};

// Full response schema for /execute/config
const ExecuteConfigResponseSchema = z.object({
  valid: z.boolean(),
  summary: z.object({
    totalRecords: z.number(),
    successfulImports: z.number(),
    failedImports: z.number(),
    importedAt: z.string(),
  }).optional(),
  orders: z.array(z.object({
    _sourceIndex: z.number(),
    _success: z.boolean(),
    _errors: z.array(z.string()).optional(),
    order: StandardizedOrderSchema.partial(), // The actual order data
  })).optional(),
  errors: z.array(z.object({
    path: z.string(),
    message: z.string(),
  })).optional(),
});

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

// Schema for the mapping config that the LLM should generate
const MappingConfigSchema = z.object({
  name: z.string().describe('Name of this import mapping'),
  sourceType: z.enum(['csv', 'json']).describe('Type of the source data'),
  idField: z.string().describe('The source field to use as the order ID'),
  fieldMappings: z.array(z.object({
    sourceField: z.string().describe('Field name in the source data'),
    targetField: z.string().describe('Field name in the standardized order schema'),
    transform: z.enum(['none', 'uppercase', 'lowercase', 'trim', 'number']).optional()
      .describe('Optional transformation to apply'),
  })).describe('Array of field mappings from source to target order fields'),
  options: z.object({
    skipEmptyFields: z.boolean().describe('Whether to skip empty source fields'),
    validateRequired: z.boolean().describe('Whether to validate required target fields'),
  }),
});

// ============================================================================
// ENDPOINTS
// ============================================================================

/**
 * POST /generate/config
 *
 * Uses an LLM to generate a mapping configuration to transform source order data
 * into the standardized order format.
 *
 * Request body:
 *   - sourceFile: string - The stringified content of the source file (CSV or JSON)
 *   - fileType: 'csv' | 'json' - The type of the source file
 *
 * Response:
 *   - config: MappingConfigSchema - The generated mapping configuration
 *   - sourceInfo: object - Information about the parsed source file
 *     - fields: string[] - Field names found in the source data
 *     - recordCount: number - Total number of records
 *     - sampleRecords: object[] - First 3 records as sample
 */
app.post('/generate/config', async (req, res) => {
  // TODO: Implement
});

/**
 * POST /execute/config
 *
 * Validates a mapping configuration and executes the import, transforming
 * source order data into the standardized order format.
 *
 * Request body:
 *   - config: MappingConfigSchema - The mapping configuration (from /generate/config)
 *   - sourceFile: string - The stringified source file content
 *
 * Response: ExecuteConfigResponseSchema
 *   - valid: boolean - Whether the config was valid
 *   - summary: { totalRecords, successfulImports, failedImports, importedAt }
 *   - orders: array of { _sourceIndex, _success, _errors?, order }
 *   - errors: array of { path, message } (if config is invalid)
 */
app.post('/execute/config', async (req, res) => {
  // TODO: Implement
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
