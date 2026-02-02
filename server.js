import express from 'express';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const app = express();
app.use(express.json());

// Schema for the mapping config that the LLM should generate
// This config maps source fields to target repository fields
const MappingConfigSchema = z.object({
  name: z.string().describe('Name of this import mapping'),
  sourceType: z.string().describe('Type of the source data (e.g., "csv", "api", "json")'),
  targetRepository: z.string().describe('Name of the target repository'),
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

// Simulated target repository with required fields
const REPOSITORY_SCHEMA = {
  users: { required: ['id', 'email', 'name'], optional: ['phone', 'address', 'role'] },
  products: { required: ['sku', 'name', 'price'], optional: ['description', 'category', 'stock'] },
  orders: { required: ['orderId', 'customerId', 'total'], optional: ['status', 'createdAt', 'items'] },
};

/**
 * POST /generate/config
 * 
 * Uses an LLM to generate a configuration object based on user input.
 * 
 * Request body:
 *   - prompt: string - The user's description of what config they want
 * 
 * Response:
 *   - config: object - The generated configuration
 */
app.post('/generate/config', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required and must be a string' });
    }

    // TODO: Implement the LLM call here using Vercel AI SDK
    // 
    // Documentation: https://sdk.vercel.ai/docs
    // 
    // You should use the `generateObject` function from the 'ai' package.
    // This function allows you to generate structured JSON output from an LLM.
    // 
    // See: https://sdk.vercel.ai/docs/ai-sdk-core/generating-structured-data
    // 
    // Example usage:
    //   const result = await generateObject({
    //     model: openai('gpt-4o'),
    //     schema: MappingConfigSchema,
    //     prompt: '...',
    //   });
    // 
    // The candidate should:
    // 1. Craft an appropriate system prompt and user prompt
    // 2. Use the MappingConfigSchema defined above to ensure structured output
    // 3. Consider including REPOSITORY_SCHEMA info so the LLM knows valid target fields
    // 4. Handle the result appropriately
    //
    // For now, returning a placeholder:
    const config = {
      _placeholder: true,
      message: 'LLM integration not yet implemented',
      userPrompt: prompt,
    };

    return res.json({ config });
  } catch (error) {
    console.error('Error generating config:', error);
    return res.status(500).json({ error: 'Failed to generate config' });
  }
});

/**
 * POST /execute/config
 * 
 * Validates a mapping configuration and simulates importing data using it.
 * 
 * Request body:
 *   - config: object - The mapping configuration
 *   - sourceData: array - Array of source objects to import
 * 
 * Response:
 *   - valid: boolean - Whether the config was valid
 *   - importedRecords: array - The transformed records (if valid)
 *   - errors: array - Validation/import errors
 */
app.post('/execute/config', async (req, res) => {
  try {
    const { config, sourceData } = req.body;

    if (!config) {
      return res.status(400).json({ error: 'config is required' });
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

    // Check if target repository exists
    const repoSchema = REPOSITORY_SCHEMA[validConfig.targetRepository];
    if (!repoSchema) {
      return res.json({
        valid: false,
        errors: [{ 
          path: 'targetRepository', 
          message: `Unknown repository "${validConfig.targetRepository}". Valid: ${Object.keys(REPOSITORY_SCHEMA).join(', ')}` 
        }],
      });
    }

    // Check if required fields are mapped
    const mappedTargetFields = validConfig.fieldMappings.map(m => m.targetField);
    const missingRequired = repoSchema.required.filter(f => !mappedTargetFields.includes(f));
    
    if (validConfig.options.validateRequired && missingRequired.length > 0) {
      return res.json({
        valid: false,
        errors: missingRequired.map(field => ({
          path: 'fieldMappings',
          message: `Missing required target field: "${field}"`,
        })),
      });
    }

    // If no source data provided, just validate the config
    if (!sourceData || !Array.isArray(sourceData)) {
      return res.json({
        valid: true,
        message: 'Config is valid. Provide sourceData array to simulate import.',
        configSummary: {
          name: validConfig.name,
          targetRepository: validConfig.targetRepository,
          fieldCount: validConfig.fieldMappings.length,
          mappedFields: mappedTargetFields,
        },
      });
    }

    // Apply the mapping to transform source data
    const importedRecords = sourceData.map((sourceRecord, index) => {
      const targetRecord = {};
      const recordErrors = [];

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
              value = Number(value);
              if (isNaN(value)) {
                recordErrors.push(`Field "${mapping.sourceField}" could not be converted to number`);
                value = 0;
              }
              break;
          }
        }

        targetRecord[mapping.targetField] = value;
      }

      return {
        _index: index,
        _success: recordErrors.length === 0,
        _errors: recordErrors,
        record: targetRecord,
      };
    });

    const successCount = importedRecords.filter(r => r._success).length;

    return res.json({
      valid: true,
      summary: {
        totalRecords: sourceData.length,
        successfulImports: successCount,
        failedImports: sourceData.length - successCount,
        targetRepository: validConfig.targetRepository,
      },
      importedRecords,
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
