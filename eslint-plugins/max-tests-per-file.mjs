/**
 * Custom ESLint Rule: Max tests per file
 *
 * Counts test() and test.skip() / test.only() / test.fixme() / test.slow()
 * / test.fail() calls in a single spec file and reports when the count
 * exceeds a configurable maximum (default 50).
 *
 * Only string-literal test definitions are counted (the first argument must
 * be a quoted string), so helper calls like `regex.test(...)` or
 * `test.describe(...)` are excluded.
 *
 * Examples:
 *   BAD:  A spec file with 55 test() calls
 *   GOOD: Multiple focused files each with <= 50 tests
 */

const MAX_TESTS_DEFAULT = 50;

/**
 * Match test definitions whose first argument is a string literal:
 *   test('name'    test.skip('name'    test.only("name"    test.slow(`name`
 *
 * (?<!\.) prevents matching obj.test(...) — e.g., regex.test('abc')
 * The (?:\.(?:skip|only|slow|fixme|fail))? part handles Playwright modifiers.
 * \(\s*['"`] ensures the first argument is a string literal (a test name).
 */
const TEST_DEFINITION_RE =
  /(?<!\.)test(?:\.(?:skip|only|slow|fixme|fail))?\s*\(\s*['"`]/g;

const maxTestsPerFileRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce a maximum number of test() calls per spec file. ' +
        'Large files should be split into focused test suites.',
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
              'Maximum number of test() calls allowed per file. Default: 50.',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooManyTests:
        'File has {{actual}} tests, maximum allowed is {{max}}. ' +
        'Split into smaller, focused spec files.',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const max = options.max || MAX_TESTS_DEFAULT;

    return {
      'Program:exit'(node) {
        const filePath = context.filename || context.getFilename();

        // Only check spec files
        if (!filePath.includes('.spec.')) return;

        const sourceCode = context.sourceCode || context.getSourceCode();
        const text = sourceCode.getText();

        const matches = text.match(TEST_DEFINITION_RE);
        const actual = matches ? matches.length : 0;

        if (actual > max) {
          context.report({
            node,
            messageId: 'tooManyTests',
            data: {
              actual: String(actual),
              max: String(max),
            },
          });
        }
      },
    };
  },
};

export default {
  rules: {
    'max-tests-per-file': maxTestsPerFileRule,
  },
};
