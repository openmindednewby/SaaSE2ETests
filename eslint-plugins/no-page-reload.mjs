/**
 * Custom ESLint Rule: No page.reload()
 *
 * Warns against page.reload() usage. Tests should not rely on page refreshes
 * to reach a desired state. Navigate directly or use UI actions instead.
 * Some legitimate uses exist (e.g., testing persistence after reload).
 *
 * Examples:
 *   BAD:  await page.reload();
 *   BAD:  await this.page.reload();
 *   GOOD: await page.goto(targetUrl);
 *   GOOD: // For persistence tests, reload may be acceptable
 */

const noPageReloadRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warn against page.reload(). Navigate directly or use UI actions to reach desired state.',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      noPageReload:
        'Avoid page.reload(). Navigate directly or use UI actions instead. If testing persistence, add a comment explaining why reload is needed.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'reload'
        ) {
          const obj = node.callee.object;
          const isPage =
            (obj.type === 'Identifier' && obj.name === 'page') ||
            (obj.type === 'MemberExpression' &&
              obj.property.type === 'Identifier' &&
              obj.property.name === 'page');

          if (isPage)
            context.report({ node, messageId: 'noPageReload' });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-page-reload': noPageReloadRule,
  },
};
