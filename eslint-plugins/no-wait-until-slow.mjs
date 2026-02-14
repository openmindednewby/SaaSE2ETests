/**
 * Custom ESLint Rule: No slow waitUntil values
 *
 * Prohibits waitUntil: 'load' and waitUntil: 'networkidle' in goto/reload options.
 * These wait for all resources or 500ms of network silence, making tests slow.
 * Use 'domcontentloaded' or 'commit' instead.
 *
 * Examples:
 *   BAD:  await page.goto(url, { waitUntil: 'load' });
 *   BAD:  await page.goto(url, { waitUntil: 'networkidle' });
 *   GOOD: await page.goto(url, { waitUntil: 'domcontentloaded' });
 *   GOOD: await page.goto(url, { waitUntil: 'commit' });
 */

const SLOW_VALUES = new Set(['load', 'networkidle']);

const noWaitUntilSlowRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow waitUntil: 'load' and waitUntil: 'networkidle'. Use 'domcontentloaded' or 'commit' instead.",
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      noSlowWaitUntil:
        "Avoid waitUntil: '{{value}}'. Use 'domcontentloaded' or 'commit' with actionable waits instead.",
    },
  },

  create(context) {
    return {
      Property(node) {
        if (
          node.key.type === 'Identifier' &&
          node.key.name === 'waitUntil' &&
          node.value.type === 'Literal' &&
          typeof node.value.value === 'string' &&
          SLOW_VALUES.has(node.value.value)
        ) {
          context.report({
            node,
            messageId: 'noSlowWaitUntil',
            data: { value: node.value.value },
          });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-wait-until-slow': noWaitUntilSlowRule,
  },
};
