/**
 * Custom ESLint Rule: No waitForTimeout
 *
 * Prohibits page.waitForTimeout() / locator.waitForTimeout() calls.
 * Use actionable waits instead: waitForSelector, waitForResponse, expect().toBeVisible(), etc.
 *
 * Examples:
 *   BAD:  await page.waitForTimeout(1000);
 *   GOOD: await page.waitForSelector('[data-testid="loaded"]');
 *   GOOD: await expect(locator).toBeVisible();
 */

const noWaitForTimeoutRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow waitForTimeout(). Use actionable waits (waitForSelector, expect toBeVisible, etc.) instead.',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      noWaitForTimeout:
        'Avoid waitForTimeout(). Use actionable waits like waitForSelector(), waitForResponse(), or expect().toBeVisible() instead.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'waitForTimeout'
        ) {
          context.report({ node, messageId: 'noWaitForTimeout' });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-wait-for-timeout': noWaitForTimeoutRule,
  },
};
