/**
 * Custom ESLint Rule: No fragile selectors
 *
 * Prohibits XPath selectors (// or xpath=) in locator() calls and
 * .nth(N) with a literal index. These selectors are brittle and
 * break when DOM structure changes.
 *
 * Examples:
 *   BAD:  page.locator('//div[@class="item"]');
 *   BAD:  page.locator('xpath=//button');
 *   BAD:  page.locator('.item').nth(2);
 *   GOOD: page.getByTestId('item');
 *   GOOD: page.getByRole('button', { name: 'Submit' });
 */

const noFragileSelectorsRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow XPath selectors and .nth(N) with literal index. Use testID or role-based selectors.',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      noXPath:
        'Avoid XPath selectors in locator(). Use testID, role, or text-based selectors instead.',
      noNthLiteral:
        'Avoid .nth({{index}}) with a literal index. Use a more specific selector (testID, role, text) instead.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        // Check for XPath in locator() calls
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'locator' &&
          node.arguments.length > 0
        ) {
          const arg = node.arguments[0];
          if (arg.type === 'Literal' && typeof arg.value === 'string') {
            const val = arg.value.trim();
            if (val.startsWith('//') || val.startsWith('xpath='))
              context.report({ node: arg, messageId: 'noXPath' });
          }

          if (arg.type === 'TemplateLiteral' && arg.quasis.length > 0) {
            const raw = arg.quasis[0].value.raw;
            if (raw.startsWith('//') || raw.startsWith('xpath='))
              context.report({ node: arg, messageId: 'noXPath' });
          }
        }

        // Check for .nth(N) with literal index
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'nth' &&
          node.arguments.length > 0
        ) {
          const arg = node.arguments[0];
          if (arg.type === 'Literal' && typeof arg.value === 'number') {
            context.report({
              node,
              messageId: 'noNthLiteral',
              data: { index: String(arg.value) },
            });
          }
        }
      },
    };
  },
};

export default {
  rules: {
    'no-fragile-selectors': noFragileSelectorsRule,
  },
};
