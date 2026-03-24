import { Page } from '@playwright/test';

/**
 * Fill all visible text inputs and select the first radio option on the current page.
 *
 * React Native Web renders:
 * - TextInput as <input> with placeholder "Enter your answer"
 * - Radio options as TouchableOpacity (role="button") with option text labels
 */
export async function fillCurrentPageFields(page: Page, answerPrefix = 'Test answer'): Promise<void> {
  // Fill any visible text inputs (React Native Web TextInput)
  const textInputs = page.getByPlaceholder(/enter your answer/i);
  const inputCount = await textInputs.count();

  for (let i = 0; i < inputCount; i++) {
    const input = textInputs.nth(i);
    if (await input.isVisible()) {
      await input.fill(`${answerPrefix} ${i + 1}`);
    }
  }

  // Also try standard HTML inputs as fallback
  if (inputCount === 0) {
    const htmlInputs = page.locator('input[type="text"], textarea');
    const htmlCount = await htmlInputs.count();
    for (let i = 0; i < htmlCount; i++) {
      const input = htmlInputs.nth(i);
      if (await input.isVisible()) {
        await input.fill(`${answerPrefix} ${i + 1}`);
      }
    }
  }

  // Select first radio option: React Native radio uses TouchableOpacity with
  // role="button" and option text. Try standard radiogroup first, then fallback
  // to known option labels from the test template.
  const radioGroups = page.locator('[role="radiogroup"]');
  const radioGroupCount = await radioGroups.count();

  if (radioGroupCount > 0) {
    for (let i = 0; i < radioGroupCount; i++) {
      const group = radioGroups.nth(i);
      if (await group.isVisible()) {
        const firstRadio = group.locator('[role="radio"]').first();
        if (await firstRadio.isVisible()) {
          await firstRadio.click();
        }
      }
    }
  } else {
    // React Native Web: radio options rendered as role="button" with option text.
    // Click the first known option per question group on the current page.
    const knownOptions = ['Excellent', 'Yes'];
    for (const option of knownOptions) {
      const btn = page.getByRole('button', { name: option, exact: true });
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await btn.click();
      }
    }
  }
}
