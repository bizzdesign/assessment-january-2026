import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const model = openrouter('anthropic/claude-haiku-4-5');

export const MappingConfigSchema = z.object({
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

const mappingCache = [];

function getCachedMapping(fields) {
  const key = [...fields].sort().join(',');
  return mappingCache.find(entry => entry.key === key)?.config ?? null;
}

function cacheMapping(fields, config) {
  const key = [...fields].sort().join(',');
  mappingCache.push({ key, config });
}

export async function callLLM({ schema, prompt, fields }) {
  if (fields) {
    const cached = getCachedMapping(fields);
    if (cached) return cached;
  }
  const { object } = await generateObject({ model, schema, prompt });
  if (fields) cacheMapping(fields, object);
  return object;
}

function parseSource(sourceFile, sourceType) {
  if (sourceType === 'json') {
    const data = JSON.parse(sourceFile);
    return Array.isArray(data) ? data : (Object.values(data).find(v => Array.isArray(v)) ?? [data]);
  }
  const lines = sourceFile.trim().split('\n').filter(Boolean);
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

export function executeConfig(config, sourceFile) {
  const records = parseSource(sourceFile, config.sourceType);

  const orders = records.map((record, index) => {
    const order = {};
    for (const mapping of config.fieldMappings) {
      const value = record[mapping.sourceField];
      if (value !== undefined && value !== '') {
        order[mapping.targetField] = value;
      }
    }
    if (!order.orderId && record[config.idField] !== undefined) {
      order.orderId = String(record[config.idField]);
    }
    const success = !!order.orderId;
    return {
      _sourceIndex: index,
      _success: success,
      ...(!success && { _errors: ['Missing required field: orderId'] }),
      order,
    };
  });

  const successfulImports = orders.filter(o => o._success).length;

  return {
    valid: true,
    summary: {
      totalRecords: records.length,
      successfulImports,
      failedImports: records.length - successfulImports,
      importedAt: new Date().toISOString(),
    },
    orders,
  };
}
