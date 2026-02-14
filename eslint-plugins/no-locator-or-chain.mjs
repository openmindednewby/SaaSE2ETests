/**
 * Custom ESLint Rule: No locator .or() chain
 *
 * Prohibits .or() on Playwright locator chains.
 * Multiple selectors in .or() make tests fragile and hard to debug.
 * Use specific, stable selectors (testID, role, text) instead.
 *
 * Examples:
 *   BAD:  page.locator('.btn').or(page.locator('.button'));
 *   GOOD: page.getByTestId('submit-button');
 *   GOOD: page.getByRole('button', { name: 'Submit' });
 */

const noLocatorOrChainRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow .or() on Playwright locator chains. Use specific, stable selectors instead.',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      noLocatorOr:
        'Avoid .or() on locator chains. Use a single stable selector (testID, role, text) instead of combining multiple fragile selectors.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'or' &&
          node.arguments.length > 0
        ) {
          // Check if the receiver looks like a locator chain
          const source = context.sourceCode.getText(node.callee.object);
          const isLocatorChain =
            source.includes('locator') ||
            source.includes('getBy') ||
            source.includes('page.') ||
            source.includes('this.page.');

          if (isLocatorChain)
            context.report({ node, messageId: 'noLocatorOr' });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-locator-or-chain': noLocatorOrChainRule,
  },
};
