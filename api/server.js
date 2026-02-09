import 'dotenv/config';
import express from 'express';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { Output, generateText } from 'ai';

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
//   openai/gpt-4o              - Best overall, fast, great at structured output
//   openai/gpt-4o-mini         - Cheaper, still very capable
//   anthropic/claude-3.5-sonnet - Excellent reasoning and instruction following
//   anthropic/claude-3-haiku   - Fast and cheap, good for simple tasks
//   google/gemini-2.0-flash    - Very fast, good value
//   google/gemini-1.5-pro      - Strong reasoning, large context
//   meta-llama/llama-3.1-70b-instruct - Open source, good performance
//   deepseek/deepseek-chat     - Very cheap, surprisingly capable

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Serve test.html at root (from parent directory)
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, '..', 'test.html'));
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
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse a CSV string into an array of objects
 */
function parseCSV(csvString) {
  const lines = csvString.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  const records = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const record = {};
    headers.forEach((header, idx) => {
      record[header] = values[idx] || '';
    });
    records.push(record);
  }
  
  return records;
}

/**
 * Parse a JSON string into an array of objects
 * Handles both array format and nested object format (looks for an array property)
 */
function parseJSON(jsonString) {
  const parsed = JSON.parse(jsonString);
  
  if (Array.isArray(parsed)) {
    return parsed;
  }
  
  // Look for an array property in the object
  for (const key of Object.keys(parsed)) {
    if (Array.isArray(parsed[key])) {
      return parsed[key];
    }
  }
  
  // Single object - wrap in array
  return [parsed];
}

/**
 * Parse source file based on type
 */
function parseSourceFile(sourceFile, sourceType) {
  if (sourceType === 'csv') {
    return parseCSV(sourceFile);
  } else if (sourceType === 'json') {
    return parseJSON(sourceFile);
  }
  throw new Error(`Unsupported source type: ${sourceType}`);
}

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
 *   - config: object - The generated mapping configuration
 *   - sourceInfo: object - Information about the parsed source file
 */
app.post('/generate/config', async (req, res) => {
  try {
    const { sourceFile, fileType } = req.body;

    if (!sourceFile || typeof sourceFile !== 'string') {
      return res.status(400).json({ error: 'sourceFile is required and must be a string' });
    }

    if (!fileType || !['csv', 'json'].includes(fileType)) {
      return res.status(400).json({ error: 'fileType is required and must be "csv" or "json"' });
    }

    // Parse the source file to extract field names and sample data for the LLM
    let sourceFields = [];
    let parsedRecords = [];
    let sampleRecords = [];
    try {
      parsedRecords = parseSourceFile(sourceFile, fileType);
      if (parsedRecords.length > 0) {
        sourceFields = Object.keys(parsedRecords[0]);
        // Get first 3 records as sample data
        sampleRecords = parsedRecords.slice(0, 3);
      }
    } catch (parseError) {
      return res.status(400).json({ error: `Failed to parse source file: ${parseError.message}` });
    }

    // TODO: Implement the LLM call here using Vercel AI SDK + OpenRouter
    // 
    // Documentation: 
    //   - Vercel AI SDK: https://sdk.vercel.ai/docs
    //   - generateObject: https://sdk.vercel.ai/docs/ai-sdk-core/generating-structured-data
    //   - OpenRouter: https://openrouter.ai/docs
    // 
    // The `generateObject` function is already imported. Use it to generate
    // a MappingConfigSchema-compliant config from the LLM.
    // 
    // Example usage:
    //   const result = await generateObject({
    //     model: openrouter('openai/gpt-4o'),  // or any model from the list above
    //     schema: MappingConfigSchema,
    //     prompt: '...',
    //   });
    //   return res.json({ config: result.object });
    // 
    // Available context for the LLM:
    //   - sourceFields: array of field names found in the source file
    //   - sampleRecords: first 3 records from the source file
    //   - TARGET_ORDER_SCHEMA: the target schema with required/optional fields
    //   - fileType: 'csv' or 'json'
    //
    // The candidate should:
    // 1. Craft an appropriate system prompt explaining the task
    // 2. Include the source fields, target schema, and sample data in the prompt
    // 3. Use MappingConfigSchema to ensure structured output
    // 4. Handle the result and return the generated config
    //
    // For now, returning a placeholder:

    const llmRes = await generateText({
      model: openrouter('anthropic/claude-4.5-sonnet'),
      prompt: `
      You are a helpful assistant that generates a mapping configuration to transform order data 
      from a source format into our standardized order format.
      
      The source file is a ${fileType.toUpperCase()} file containing order data.
      
      SOURCE DATA:
      Fields available: ${JSON.stringify(sourceFields)}
      
      Sample records:
      ${JSON.stringify(sampleRecords, null, 2)}

      TARGET ORDER SCHEMA:
      Required fields: ${JSON.stringify(TARGET_ORDER_SCHEMA.required)}
      Optional fields: ${JSON.stringify(TARGET_ORDER_SCHEMA.optional)}
      
      Field descriptions:
      - orderId: Unique order identifier (string)
      - customerId: Customer identifier (string)
      - customerEmail: Customer email address (string)
      - totalAmount: Total order amount in cents as integer (e.g., 2999 for $29.99)
      - currency: 3-letter currency code (e.g., "USD", "EUR", "GBP")
      - status: One of: pending, confirmed, processing, shipped, delivered, cancelled, refunded
      - customerName: Customer full name (optional)
      - itemCount: Number of items in order (optional)
      - shippingAddress: Full shipping address (optional)
      - shippingCity: Shipping city (optional)
      - shippingCountry: Shipping country code (optional)
      - createdAt: ISO 8601 timestamp (optional)
      - updatedAt: ISO 8601 timestamp (optional)
      - notes: Order notes (optional)

      INSTRUCTIONS:
      1. Map source fields to target fields based on semantic meaning
      2. Use 'number' transform for totalAmount to convert to integer cents
      3. Use 'lowercase' transform for status if needed to match enum values
      4. The idField should be set to the source field that contains the order ID
      5. Map as many fields as possible, prioritizing required fields
      `,
      output: Output.object({
        schema: MappingConfigSchema,
      }),
    })
    const config = llmRes.output;

    console.log('output', config);

    return res.json({
      config,
      sourceInfo: {
        fields: sourceFields,
        recordCount: parsedRecords.length,
        sampleRecords: sampleRecords,
      },
    });
  } catch (error) {
    console.error('Error generating config:', error);
    return res.status(500).json({ error: 'Failed to generate config' });
  }
});

/**
 * POST /execute/config
 * 
 * Validates a mapping configuration and executes the import, transforming
 * source order data into the standardized order format.
 * 
 * Request body:
 *   - config: object - The mapping configuration (from /generate/config)
 *   - sourceFile: string - The stringified source file content
 * 
 * Response:
 *   - valid: boolean - Whether the config was valid
 *   - orders: array - Standardized order records (if valid)
 *   - errors: array - Validation/import errors
 */
app.post('/execute/config', async (req, res) => {
  try {
    const { config, sourceFile } = req.body;

    if (!config) {
      return res.status(400).json({ error: 'config is required' });
    }

    if (!sourceFile || typeof sourceFile !== 'string') {
      return res.status(400).json({ error: 'sourceFile is required and must be a string' });
    }

    // Validate the config against our schema
    const parseResult = MappingConfigSchema.safeParse(config);

    if (!parseResult.success) {
      return res.json({
        valid: false,
        errors: parseResult.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const validConfig = parseResult.data;

    // Check if required order fields are mapped (excluding orderId which comes from idField)
    const mappedTargetFields = new Set(validConfig.fieldMappings.map(m => m.targetField));
    const requiredFields = TARGET_ORDER_SCHEMA.required.filter(f => f !== 'orderId');
    const missingRequired = requiredFields.filter(f => !mappedTargetFields.has(f));
    
    if (validConfig.options.validateRequired && missingRequired.length > 0) {
      return res.json({
        valid: false,
        errors: missingRequired.map(field => ({
          path: 'fieldMappings',
          message: `Missing required target field: "${field}"`,
        })),
      });
    }

    // Parse the source file
    let sourceRecords;
    try {
      sourceRecords = parseSourceFile(sourceFile, validConfig.sourceType);
    } catch (parseError) {
      return res.json({
        valid: false,
        errors: [{ path: 'sourceFile', message: `Failed to parse: ${parseError.message}` }],
      });
    }

    if (sourceRecords.length === 0) {
      return res.json({
        valid: true,
        message: 'Source file parsed but contains no records.',
        orders: [],
      });
    }

    // Transform source records into standardized order format
    const importedAt = new Date().toISOString();
    const orders = [];

    for (let index = 0; index < sourceRecords.length; index++) {
      const sourceRecord = sourceRecords[index];
      const recordErrors = [];

      // Extract the order ID from the source record
      const orderId = sourceRecord[validConfig.idField];
      if (orderId === undefined || orderId === null || orderId === '') {
        recordErrors.push(`Missing order ID field "${validConfig.idField}"`);
      }

      // Build the order object by applying field mappings
      const order = {
        orderId: String(orderId || `unknown-${index}`),
      };

      for (const mapping of validConfig.fieldMappings) {
        let value = sourceRecord[mapping.sourceField];

        // Skip empty fields if configured
        if ((value === undefined || value === null || value === '') && validConfig.options.skipEmptyFields) {
          continue;
        }

        // Apply transformation
        if (value !== undefined && value !== null) {
          switch (mapping.transform) {
            case 'uppercase':
              value = String(value).toUpperCase();
              break;
            case 'lowercase':
              value = String(value).toLowerCase();
              break;
            case 'trim':
              value = String(value).trim();
              break;
            case 'number': {
              const numValue = Number(value);
              if (Number.isNaN(numValue)) {
                recordErrors.push(`Field "${mapping.sourceField}" could not be converted to number`);
                value = 0;
              } else {
                value = numValue;
              }
              break;
            }
          }
        }

        order[mapping.targetField] = value;
      }

      orders.push({
        _sourceIndex: index,
        _success: recordErrors.length === 0,
        _errors: recordErrors.length > 0 ? recordErrors : undefined,
        order: order,
      });
    }

    const successCount = orders.filter(o => o._success).length;

    return res.json({
      valid: true,
      summary: {
        totalRecords: sourceRecords.length,
        successfulImports: successCount,
        failedImports: sourceRecords.length - successCount,
        importedAt: importedAt,
      },
      orders: orders,
    });
  } catch (error) {
    console.error('Error executing config:', error);
    return res.status(500).json({ error: 'Failed to execute config' });
  }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
