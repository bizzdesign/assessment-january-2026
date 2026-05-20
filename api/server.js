import 'dotenv/config';
import express from 'express';
import { z } from 'zod';
import { callLLM, MappingConfigSchema, executeConfig } from './service.js';

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
  const { sourceFile, fileType } = req.body;
  if (!sourceFile || !fileType) {
    return res.status(400).json({ error: 'sourceFile and fileType are required' });
  }
  try {
    const result = await callLLM({
      schema: MappingConfigSchema,
      prompt: `You are a data mapping expert. Given this ${fileType} order data, generate a mapping configuration that maps its fields to the standardized order schema.\n\n${sourceFile}`,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  const { config, sourceFile } = req.body;
  if (!config || !sourceFile) {
    return res.status(400).json({ error: 'config and sourceFile are required' });
  }

  const parsed = MappingConfigSchema.safeParse(config);
  if (!parsed.success) {
    return res.json({
      valid: false,
      errors: parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
    });
  }

  try {
    const result = executeConfig(parsed.data, sourceFile);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
