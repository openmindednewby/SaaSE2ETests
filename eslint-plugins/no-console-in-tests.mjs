/**
 * Custom ESLint Rule: No console in tests
 *
 * Prohibits console.log/warn/error/info/debug in test files.
 * Debugging console statements should not be committed to test code.
 * Use Playwright's built-in tracing and reporting instead.
 *
 * Examples:
 *   BAD:  console.log('debugging');
 *   BAD:  console.error(err);
 *   GOOD: // Use Playwright trace viewer for debugging
 */

const noConsoleInTestsRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow console.log/warn/error/info/debug in E2E test files.',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      noConsole:
        'Remove console.{{method}}(). Use Playwright tracing/reporting for debugging instead of console statements in tests.',
    },
  },

  create(context) {
    const CONSOLE_METHODS = new Set([
      'log',
      'warn',
      'error',
      'info',
      'debug',
    ]);

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'console' &&
          callee.property.type === 'Identifier' &&
          CONSOLE_METHODS.has(callee.property.name)
        ) {
          context.report({
            node,
            messageId: 'noConsole',
            data: { method: callee.property.name },
          });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-console-in-tests': noConsoleInTestsRule,
  },
};
