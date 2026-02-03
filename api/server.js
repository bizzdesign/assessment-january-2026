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
// STANDARDIZED OUTPUT FORMAT
// ============================================================================
// All imported data is transformed into this standardized format.
// Each record becomes a StandardizedRecord with consistent structure.

const StandardizedRecordSchema = z.object({
  id: z.string().describe('Unique identifier from source (via idField)'),
  type: z.enum(['users', 'products', 'orders']).describe('Target repository type'),
  data: z.record(z.string(), z.any()).describe('Mapped field values'),
  _meta: z.object({
    sourceIndex: z.number().describe('Position in source file (0-indexed)'),
    importedAt: z.string().describe('ISO timestamp of import'),
    success: z.boolean().describe('Whether import succeeded'),
    errors: z.array(z.string()).optional().describe('Any transformation errors'),
  }),
});

// Example standardized output:
// {
//   id: "1",
//   type: "users",
//   data: { email: "alice@example.com", name: "Alice Smith", phone: "555-1234" },
//   _meta: { sourceIndex: 0, importedAt: "2026-01-28T12:00:00Z", success: true }
// }

// Full response schema for /execute/config
const ExecuteConfigResponseSchema = z.object({
  valid: z.boolean(),
  summary: z.object({
    totalRecords: z.number(),
    successfulImports: z.number(),
    failedImports: z.number(),
    targetRepository: z.string(),
    importedAt: z.string(),
  }).optional(),
  records: z.array(StandardizedRecordSchema).optional(),
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
  targetRepository: z.enum(['users', 'products', 'orders']).describe('Name of the target repository'),
  idField: z.string().describe('The source field to use as the unique identifier'),
  fieldMappings: z.array(z.object({
    sourceField: z.string().describe('Field name in the source data'),
    targetField: z.string().describe('Field name in the target repository'),
    transform: z.enum(['none', 'uppercase', 'lowercase', 'trim', 'number']).optional()
      .describe('Optional transformation to apply'),
  })).describe('Array of field mappings from source to target'),
  options: z.object({
    skipEmptyFields: z.boolean().describe('Whether to skip empty source fields'),
    validateRequired: z.boolean().describe('Whether to validate required target fields'),
  }),
});

// Target repository schemas - the LLM needs to know these to create valid mappings
const REPOSITORY_SCHEMA = {
  users: { required: ['id', 'email', 'name'], optional: ['phone', 'address', 'role'] },
  products: { required: ['sku', 'name', 'price'], optional: ['description', 'category', 'stock'] },
  orders: { required: ['orderId', 'customerId', 'total'], optional: ['status', 'createdAt', 'items'] },
};

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
 * Uses an LLM to generate a mapping configuration based on the source file.
 * 
 * Request body:
 *   - sourceFile: string - The stringified content of the source file (CSV or JSON)
 *   - fileType: 'csv' | 'json' - The type of the source file
 *   - targetRepository: 'users' | 'products' | 'orders' - The target repository to map to
 * 
 * Response:
 *   - config: object - The generated mapping configuration
 */
app.post('/generate/config', async (req, res) => {
  try {
    const { sourceFile, fileType, targetRepository } = req.body;

    if (!sourceFile || typeof sourceFile !== 'string') {
      return res.status(400).json({ error: 'sourceFile is required and must be a string' });
    }

    if (!fileType || !['csv', 'json'].includes(fileType)) {
      return res.status(400).json({ error: 'fileType is required and must be "csv" or "json"' });
    }

    if (!targetRepository || !REPOSITORY_SCHEMA[targetRepository]) {
      return res.status(400).json({ 
        error: `targetRepository is required and must be one of: ${Object.keys(REPOSITORY_SCHEMA).join(', ')}` 
      });
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
    //   - targetRepository: the target repository name
    //   - REPOSITORY_SCHEMA[targetRepository]: the target schema with required/optional fields
    //   - fileType: 'csv' or 'json'
    //   - sourceFile: the raw file content (first few lines might be useful as examples)
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
      You are a helpful assistant that generates a mapping configuration for a given source file and target repository.
      The source file is a CSV or JSON file and the target repository is a users, products, or orders repository.
      The mapping configuration should be a JSON object that matches the MappingConfigSchema schema.
      The mapping configuration should be generated based on the source file and the target repository.
      The mapping configuration should be generated based on the source file and the target repository.

      Here is the shape of the input to be mapped:
      ${JSON.stringify(sourceFields)}

      And a sample of the records therein:
      ${JSON.stringify(sampleRecords)}


      The target repository "${targetRepository}" has the following schema:
      Required fields: ${JSON.stringify(REPOSITORY_SCHEMA[targetRepository].required)}
      Optional fields: ${JSON.stringify(REPOSITORY_SCHEMA[targetRepository].optional)}

      Be sure to always map a field from the input to an id. Don't invent an id field.
      `,
      output: Output.object({
        schema: MappingConfigSchema,
      }),
    })
    const config = llmRes.output;

    console.log('output', config);

    return res.json({config});
  } catch (error) {
    console.error('Error generating config:', error);
    return res.status(500).json({ error: 'Failed to generate config' });
  }
});

/**
 * POST /execute/config
 * 
 * Validates a mapping configuration and executes the import, transforming
 * source data into the standardized output format.
 * 
 * Request body:
 *   - config: object - The mapping configuration (from /generate/config)
 *   - sourceFile: string - The stringified source file content
 * 
 * Response:
 *   - valid: boolean - Whether the config was valid
 *   - records: array - Standardized records (if valid)
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

    // Check target repository schema
    const repoSchema = REPOSITORY_SCHEMA[validConfig.targetRepository];

    // Check if required fields are mapped (excluding 'id' which comes from idField)
    const mappedTargetFields = validConfig.fieldMappings.map(m => m.targetField);
    const requiredWithoutId = repoSchema.required.filter(f => f !== 'id');
    const missingRequired = requiredWithoutId.filter(f => !mappedTargetFields.includes(f));
    
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
        records: [],
      });
    }

    // Transform source records into standardized format
    const importedAt = new Date().toISOString();
    const records = [];
    const errors = [];

    for (let index = 0; index < sourceRecords.length; index++) {
      const sourceRecord = sourceRecords[index];
      const recordErrors = [];

      // Extract the ID from the source record
      const recordId = sourceRecord[validConfig.idField];
      if (recordId === undefined || recordId === null || recordId === '') {
        recordErrors.push(`Missing ID field "${validConfig.idField}"`);
      }

      // Build the data object by applying field mappings
      const data = {};

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
            case 'number':
              const numValue = Number(value);
              if (isNaN(numValue)) {
                recordErrors.push(`Field "${mapping.sourceField}" could not be converted to number`);
                value = 0;
              } else {
                value = numValue;
              }
              break;
          }
        }

        data[mapping.targetField] = value;
      }

      // Create standardized record
      const standardizedRecord = {
        id: String(recordId || `unknown-${index}`),
        type: validConfig.targetRepository,
        data: data,
        _meta: {
          sourceIndex: index,
          importedAt: importedAt,
          success: recordErrors.length === 0,
          errors: recordErrors.length > 0 ? recordErrors : undefined,
        },
      };

      records.push(standardizedRecord);

      if (recordErrors.length > 0) {
        errors.push({ index, errors: recordErrors });
      }
    }

    const successCount = records.filter(r => r._meta.success).length;

    return res.json({
      valid: true,
      summary: {
        totalRecords: sourceRecords.length,
        successfulImports: successCount,
        failedImports: sourceRecords.length - successCount,
        targetRepository: validConfig.targetRepository,
        importedAt: importedAt,
      },
      records: records,
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
