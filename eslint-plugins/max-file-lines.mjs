/**
 * Custom ESLint Rule: Max file lines
 *
 * Warns when a file exceeds the configured maximum line count (default: 300).
 * Large test files should be split into focused test suites.
 *
 * Examples:
 *   BAD:  A 500-line test file with many unrelated test cases
 *   GOOD: Multiple focused files under 300 lines each
 */

const MAX_LINES_DEFAULT = 300;

const maxFileLinesRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warn when files exceed maximum line count. Split large test files into focused suites.',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          max: {
            type: 'number',
            description: 'Maximum number of lines allowed per file',
            default: MAX_LINES_DEFAULT,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooManyLines:
        'File has {{actual}} lines (max {{max}}). Split into smaller, focused test files.',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const max = options.max || MAX_LINES_DEFAULT;

    return {
      Program(node) {
        const sourceCode = context.sourceCode || context.getSourceCode();
        const actual = sourceCode.lines.length;

        if (actual > max) {
          context.report({
            node,
            messageId: 'tooManyLines',
            data: { actual: String(actual), max: String(max) },
          });
        }
      },
    };
  },
};

export default {
  rules: {
    'max-file-lines': maxFileLinesRule,
  },
};
