/**
 * Custom ESLint Rule: No setTimeout in Promise
 *
 * Prohibits `new Promise(r => setTimeout(r, N))` patterns used as hardcoded waits.
 * Use actionable waits instead.
 *
 * Examples:
 *   BAD:  await new Promise(resolve => setTimeout(resolve, 2000));
 *   BAD:  await new Promise(r => setTimeout(r, 500));
 *   GOOD: await expect(locator).toBeVisible();
 */

const noSetTimeoutInPromiseRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow new Promise(r => setTimeout(r, N)) hardcoded waits.',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      noSetTimeoutInPromise:
        'Avoid new Promise(r => setTimeout(r, N)). Use actionable waits like waitForSelector(), waitForResponse(), or expect().toBeVisible() instead.',
    },
  },

  create(context) {
    return {
      NewExpression(node) {
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'Promise'
        )
          return;

        const callback = node.arguments[0];
        if (!callback) return;

        // Handle arrow functions and function expressions
        const body =
          callback.type === 'ArrowFunctionExpression' ||
          callback.type === 'FunctionExpression'
            ? callback.body
            : null;

        if (!body) return;

        // Check if the body (or the single expression) is a setTimeout call
        const expr =
          body.type === 'CallExpression'
            ? body
            : body.type === 'BlockStatement' &&
                body.body.length === 1 &&
                body.body[0].type === 'ExpressionStatement'
              ? body.body[0].expression
              : null;

        if (
          expr &&
          expr.type === 'CallExpression' &&
          expr.callee.type === 'Identifier' &&
          expr.callee.name === 'setTimeout'
        ) {
          context.report({ node, messageId: 'noSetTimeoutInPromise' });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-set-timeout-in-promise': noSetTimeoutInPromiseRule,
  },
};
