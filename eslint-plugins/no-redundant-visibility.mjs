/**
 * Custom ESLint Rule: No redundant visibility check
 *
 * Warns against guarding expect(x).toBeVisible() with if (await x.isVisible()).
 * The isVisible() check is redundant because toBeVisible() already has
 * built-in waiting and assertion. The if guard silently passes when the
 * element is NOT visible, hiding real failures.
 *
 * Examples:
 *   BAD:  if (await elem.isVisible()) { await expect(elem).toBeVisible(); }
 *   GOOD: await expect(elem).toBeVisible();
 */

const noRedundantVisibilityRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warn against guarding toBeVisible() with isVisible(). The guard makes the assertion useless.',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      redundantVisibility:
        'Remove the isVisible() guard. expect(x).toBeVisible() already waits and asserts. The if guard silently passes when the element is NOT visible.',
    },
  },

  create(context) {
    return {
      IfStatement(node) {
        // Check if the test is an await of isVisible()
        const test = node.test;
        const awaitExpr =
          test.type === 'AwaitExpression' ? test.argument : null;

        if (!awaitExpr) return;
        if (awaitExpr.type !== 'CallExpression') return;
        if (awaitExpr.callee.type !== 'MemberExpression') return;
        if (
          awaitExpr.callee.property.type !== 'Identifier' ||
          awaitExpr.callee.property.name !== 'isVisible'
        )
          return;

        // Check if the consequent block contains toBeVisible()
        const body =
          node.consequent.type === 'BlockStatement'
            ? node.consequent.body
            : [node.consequent];

        const source = context.sourceCode || context.getSourceCode();
        const blockText = body.map((s) => source.getText(s)).join(' ');

        if (blockText.includes('toBeVisible'))
          context.report({ node, messageId: 'redundantVisibility' });
      },
    };
  },
};

export default {
  rules: {
    'no-redundant-visibility': noRedundantVisibilityRule,
  },
};
