/**
 * Custom ESLint Rule: Max tests per batch
 *
 * Ensures no E2E test batch exceeds a configured maximum total test count.
 * Each spec file's tests run across multiple browser projects (chromium, mobile,
 * firefox), so the total = uniqueTests × browserMultiplier + setupOverhead.
 *
 * Default: max 100 total tests per batch → max 32 unique tests per batch directory.
 *
 * Batches map to Tilt resources (e.g., playwright-e2e-questioner-all).
 * By default, the batch boundary is the first-level directory under tests/.
 * Directories split into sub-batches (like online-menus) can define custom
 * batch groupings via the `subBatches` option.
 *
 * Examples:
 *   BAD:  tests/questioner/ with 51 unique tests → 155 total (over 100)
 *   GOOD: tests/questioner/ split into sub-batches of ≤32 unique tests each
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const MAX_TOTAL_DEFAULT = 100;
const BROWSER_MULTIPLIER_DEFAULT = 3;
const SETUP_OVERHEAD_DEFAULT = 2;

// Cache directory scan results per lint run
const batchCache = new Map();

/**
 * Recursively find all .spec.ts files in a directory.
 */
function findSpecFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findSpecFiles(fullPath));
      } else if (entry.name.endsWith('.spec.ts')) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
  return results;
}

/**
 * Count test DEFINITIONS in a file using regex.
 * A test definition has a string literal as the first argument (the test name).
 *
 * Matches:  test('name',   test.skip('name',   test.only('name',
 * Excludes: test.skip()    test.skip(true,     regex.test(    test.describe(
 */
function countTestsInFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    // Match test definitions: test('name' or test.skip('name' etc.
    // (?<!\.) ensures we don't match .test() (regex/string method)
    // \(\s*['"`] ensures first argument is a string literal (test name)
    const matches = content.match(
      /(?<!\.)test(?:\.(?:skip|only|slow|fixme|fail))?\s*\(\s*['"`]/g
    );
    return matches ? matches.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Get total unique test count for a batch directory.
 * Results are cached per lint run.
 */
function getBatchTestCount(batchDir) {
  if (batchCache.has(batchDir)) return batchCache.get(batchDir);

  const specFiles = findSpecFiles(batchDir);
  let totalTests = 0;
  const fileDetails = [];

  for (const filePath of specFiles) {
    const count = countTestsInFile(filePath);
    totalTests += count;
    fileDetails.push({ filePath, count });
  }

  const result = { totalTests, fileDetails };
  batchCache.set(batchDir, result);
  return result;
}

/**
 * Resolve the batch directory for a given file path.
 * Returns the first-level directory under tests/.
 */
function getBatchDir(filePath) {
  // Normalize path separators
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/\/tests\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Check if a file belongs to a sub-batch and return sub-batch info.
 * Returns { name, files } if matched, null otherwise.
 */
function getSubBatch(filePath, subBatches) {
  if (!subBatches) return null;
  const normalized = filePath.replace(/\\/g, '/');
  const fileName = normalized.split('/').pop();

  for (const [batchName, filePatterns] of Object.entries(subBatches)) {
    for (const pattern of filePatterns) {
      if (fileName.startsWith(pattern) || fileName === pattern) {
        return { name: batchName, patterns: filePatterns };
      }
    }
  }
  return null;
}

const maxTestsPerBatchRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ensure E2E test batches do not exceed maximum test count. ' +
        'Total = uniqueTests × browserMultiplier + setupOverhead.',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          max: {
            type: 'number',
            description:
              'Maximum total tests per batch (unique × browsers + setup). Default: 100.',
          },
          browserMultiplier: {
            type: 'number',
            description:
              'Number of browser projects each test runs in. Default: 3.',
          },
          setupOverhead: {
            type: 'number',
            description:
              'Number of setup tests added per batch run. Default: 2.',
          },
          subBatches: {
            type: 'object',
            description:
              'Define sub-batches for directories already split at Tilt level. ' +
              'Key: sub-batch name, Value: array of file prefixes.',
            additionalProperties: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooManyTests:
        'Batch "{{batch}}" has {{uniqueTests}} unique tests → {{projectedTotal}} total ' +
        '({{uniqueTests}} × {{browserMultiplier}} browsers + {{setupOverhead}} setup). ' +
        'Max allowed: {{max}}. Split into sub-batches with ≤{{maxUnique}} unique tests each.',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const max = options.max || MAX_TOTAL_DEFAULT;
    const browserMultiplier =
      options.browserMultiplier || BROWSER_MULTIPLIER_DEFAULT;
    const setupOverhead = options.setupOverhead || SETUP_OVERHEAD_DEFAULT;
    const subBatches = options.subBatches || null;

    const maxUnique = Math.floor((max - setupOverhead) / browserMultiplier);

    return {
      'Program:exit'(node) {
        const filePath = context.filename || context.getFilename();

        // Only check spec files
        if (!filePath.includes('.spec.')) return;

        const batchName = getBatchDir(filePath);
        if (!batchName) return;

        // Find tests/ root directory from file path
        const normalized = filePath.replace(/\\/g, '/');
        const testsIndex = normalized.indexOf('/tests/');
        if (testsIndex === -1) return;
        const testsRoot = normalized.substring(0, testsIndex + 7); // includes /tests/
        const batchDir = testsRoot + batchName;

        // Check if this file belongs to a sub-batch
        const subBatch = getSubBatch(filePath, subBatches);

        if (subBatch) {
          // Count only files in this sub-batch
          const specFiles = findSpecFiles(batchDir);
          let subBatchTotal = 0;
          for (const sf of specFiles) {
            const sfName = sf.replace(/\\/g, '/').split('/').pop();
            const inSubBatch = subBatch.patterns.some(
              (p) => sfName.startsWith(p) || sfName === p
            );
            if (inSubBatch) {
              subBatchTotal += countTestsInFile(sf);
            }
          }
          const projected =
            subBatchTotal * browserMultiplier + setupOverhead;
          if (projected > max) {
            context.report({
              node,
              messageId: 'tooManyTests',
              data: {
                batch: subBatch.name,
                uniqueTests: String(subBatchTotal),
                projectedTotal: String(projected),
                browserMultiplier: String(browserMultiplier),
                setupOverhead: String(setupOverhead),
                max: String(max),
                maxUnique: String(maxUnique),
              },
            });
          }
          return;
        }

        // Standard batch: count all tests in the directory
        const { totalTests } = getBatchTestCount(batchDir);
        const projectedTotal =
          totalTests * browserMultiplier + setupOverhead;

        if (projectedTotal > max) {
          context.report({
            node,
            messageId: 'tooManyTests',
            data: {
              batch: batchName,
              uniqueTests: String(totalTests),
              projectedTotal: String(projectedTotal),
              browserMultiplier: String(browserMultiplier),
              setupOverhead: String(setupOverhead),
              max: String(max),
              maxUnique: String(maxUnique),
            },
          });
        }
      },
    };
  },
};

export default {
  rules: {
    'max-tests-per-batch': maxTestsPerBatchRule,
  },
};
