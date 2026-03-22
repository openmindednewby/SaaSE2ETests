import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector, indexedTestIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

/**
 * Page object for Online Menus content upload operations.
 * Handles image upload, crop modal, content preview, and image verification.
 */
export class OnlineMenusContentPage extends BasePage {
  // Content Upload
  readonly contentUploader: Locator;
  readonly contentUploaderButton: Locator;
  readonly contentPreview: Locator;
  readonly contentPreviewImage: Locator;
  readonly uploadProgressContainer: Locator;

  // Preview Modal
  readonly previewModal: Locator;

  constructor(page: Page) {
    super(page);

    this.contentUploader = page.locator(testIdSelector(TestIds.CONTENT_UPLOADER));
    this.contentUploaderButton = page.locator(testIdSelector(TestIds.CONTENT_UPLOADER_BUTTON));
    this.contentPreview = page.locator(testIdSelector(TestIds.CONTENT_PREVIEW));
    this.contentPreviewImage = page.locator(testIdSelector(TestIds.CONTENT_PREVIEW_IMAGE));
    this.uploadProgressContainer = page.locator(testIdSelector(TestIds.UPLOAD_PROGRESS_CONTAINER));
    this.previewModal = page.locator(testIdSelector(TestIds.MENU_PREVIEW_MODAL));
  }

  /**
   * Get the image picker wrapper for a menu item
   */
  getMenuItemImagePicker(categoryIndex: number, itemIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM_IMAGE_PICKER, categoryIndex, itemIndex));
  }

  /**
   * Get the video picker wrapper for a menu item
   */
  getMenuItemVideoPicker(categoryIndex: number, itemIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM_VIDEO_PICKER, categoryIndex, itemIndex));
  }

  /**
   * Get the document picker wrapper for a menu item
   */
  getMenuItemDocumentPicker(categoryIndex: number, itemIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.MENU_ITEM_DOCUMENT_PICKER, categoryIndex, itemIndex));
  }

  /**
   * Get the image picker wrapper for a category
   */
  getCategoryImagePicker(categoryIndex: number): Locator {
    return this.page.locator(indexedTestIdSelector(TestIds.CATEGORY_IMAGE_PICKER, categoryIndex));
  }

  /**
   * Handle the crop modal that appears after selecting an image file.
   */
  async handleCropModal() {
    const cropDialog = this.page.getByRole('dialog').filter({ hasText: /crop image/i });
    try {
      await expect(cropDialog).toBeVisible({ timeout: 10000 });
    } catch {
      return;
    }

    const applyButton = cropDialog.getByRole('button', { name: /apply/i });
    await expect(applyButton).toBeEnabled({ timeout: 10000 });
    await applyButton.click();
    await expect(cropDialog).not.toBeVisible({ timeout: 10000 });
  }

  /**
   * Upload an image to a menu item
   */
  async uploadImageToMenuItem(categoryIndex: number, itemIndex: number, filePath: string) {
    const imagePicker = this.getMenuItemImagePicker(categoryIndex, itemIndex);
    const uploadButton = imagePicker.locator(testIdSelector(TestIds.CONTENT_UPLOADER_BUTTON));
    await expect(uploadButton).toBeVisible({ timeout: 5000 });

    const fileChooserPromise = this.page.waitForEvent('filechooser', { timeout: 10000 });
    await uploadButton.click();

    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);

    await this.handleCropModal();

    const preview = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW));
    await expect(preview).toBeVisible({ timeout: 45000 });
  }

  /**
   * Upload an image to a category
   */
  async uploadImageToCategory(categoryIndex: number, filePath: string) {
    const imagePicker = this.getCategoryImagePicker(categoryIndex);
    const uploadButton = imagePicker.locator(testIdSelector(TestIds.CONTENT_UPLOADER_BUTTON));

    const fileChooserPromise = this.page.waitForEvent('filechooser', { timeout: 10000 });
    await uploadButton.click();

    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);

    await this.handleCropModal();

    const preview = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW));
    await expect(preview).toBeVisible({ timeout: 45000 });
  }

  /**
   * Verify that an image preview is visible for a menu item
   */
  async expectMenuItemImageVisible(categoryIndex: number, itemIndex: number) {
    const imagePicker = this.getMenuItemImagePicker(categoryIndex, itemIndex);
    const preview = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW));
    await expect(preview).toBeVisible({ timeout: 10000 });

    const imageElement = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW_IMAGE));
    await expect(imageElement).toBeVisible({ timeout: 10000 });
  }

  /**
   * Verify that an image preview is visible for a category
   */
  async expectCategoryImageVisible(categoryIndex: number) {
    const imagePicker = this.getCategoryImagePicker(categoryIndex);
    const preview = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW));
    await expect(preview).toBeVisible({ timeout: 10000 });

    const imageElement = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW_IMAGE));
    await expect(imageElement).toBeVisible({ timeout: 10000 });
  }

  /**
   * Delete an uploaded image from a menu item
   */
  async deleteMenuItemImage(categoryIndex: number, itemIndex: number) {
    const imagePicker = this.getMenuItemImagePicker(categoryIndex, itemIndex);
    const deleteButton = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW_DELETE_BUTTON));
    await deleteButton.scrollIntoViewIfNeeded();
    await deleteButton.dispatchEvent('click');

    const preview = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW));
    await expect(preview).not.toBeVisible({ timeout: 5000 });

    const uploadButton = imagePicker.locator(testIdSelector(TestIds.CONTENT_UPLOADER_BUTTON));
    await expect(uploadButton).toBeVisible({ timeout: 5000 });
  }

  /**
   * Get the image URL from a menu item's content preview
   */
  async getMenuItemImageUrl(categoryIndex: number, itemIndex: number): Promise<string | null> {
    const imagePicker = this.getMenuItemImagePicker(categoryIndex, itemIndex);
    const imageElement = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW_IMAGE));

    if (await imageElement.count() === 0) {
      return null;
    }

    const src = await imageElement.getAttribute('src');
    return src;
  }

  /**
   * Verify image loads successfully (no CORS errors)
   */
  async expectImageLoaded(categoryIndex: number, itemIndex: number) {
    const imagePicker = this.getMenuItemImagePicker(categoryIndex, itemIndex);
    const previewContainer = imagePicker.locator(testIdSelector(TestIds.CONTENT_PREVIEW_IMAGE));

    await expect(previewContainer).toBeVisible({ timeout: 10000 });

    await expect(async () => {
      const result = await previewContainer.evaluate((el: HTMLElement) => {
        const innerDiv = el.querySelector('div');
        const innerStyle = innerDiv ? window.getComputedStyle(innerDiv) : null;
        const bgImage = innerStyle?.backgroundImage ?? 'none';

        const accessibilityImg = el.querySelector('img');
        const imgSrc = accessibilityImg?.getAttribute('src') ?? '';

        return {
          hasBackgroundImage: bgImage !== 'none' && bgImage !== '',
          backgroundImage: bgImage,
          hasImgSrc: imgSrc !== '',
          imgSrc,
        };
      });

      const hasImage = result.hasBackgroundImage || result.hasImgSrc;
      if (!hasImage) {
        throw new Error(`No image found: bg=${result.backgroundImage}, src=${result.imgSrc}`);
      }

      const url = result.backgroundImage !== 'none' ? result.backgroundImage : result.imgSrc;
      const isValidUrl = url.includes('http://') || url.includes('https://') || url.includes('data:');
      if (!isValidUrl) {
        throw new Error(`Invalid image URL: ${url}`);
      }

      expect(hasImage).toBe(true);
      expect(isValidUrl).toBe(true);
    }).toPass({ timeout: 30000 });
  }

  /**
   * Verify images load in the preview modal (catches CORS issues)
   */
  async expectPreviewImagesLoaded() {
    await expect(this.previewModal).toBeVisible({ timeout: 5000 });

    await expect(async () => {
      const result = await this.previewModal.evaluate((modal: HTMLElement) => {
        const images = modal.querySelectorAll('img');
        const validImages: string[] = [];
        images.forEach((img) => {
          const src = img.getAttribute('src') ?? '';
          if (src.startsWith('http://') || src.startsWith('https://')) {
            validImages.push(src);
          }
        });

        const divs = modal.querySelectorAll('div');
        divs.forEach((div) => {
          const style = window.getComputedStyle(div);
          const bgImage = style.backgroundImage;
          if (bgImage !== 'none' && bgImage !== '') {
            const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
            if (urlMatch?.[1]?.startsWith('http')) {
              validImages.push(urlMatch[1]);
            }
          }
        });

        return { validImages, count: validImages.length };
      });

      if (result.count === 0) {
        throw new Error('No images with valid URLs found in preview modal');
      }

      expect(result.count).toBeGreaterThan(0);
    }).toPass({ timeout: 15000 });
  }
}
