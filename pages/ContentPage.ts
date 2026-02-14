import { Locator, Page, expect } from '@playwright/test';
import { TestIds, testIdSelector } from '../shared/testIds.js';
import { BasePage } from './BasePage.js';

/**
 * Page object for content upload and management functionality.
 *
 * This page object handles interactions with content upload components
 * including image, video, and document pickers.
 *
 * Note: UI components are not yet fully integrated into menu forms.
 * Some methods are placeholders for future integration.
 */
export class ContentPage extends BasePage {
  // Content Uploader
  readonly uploaderContainer: Locator;
  readonly uploaderButton: Locator;
  readonly uploaderError: Locator;

  // Content Preview
  readonly previewContainer: Locator;
  readonly previewImage: Locator;
  readonly previewVideoThumbnail: Locator;
  readonly previewDocument: Locator;
  readonly previewDeleteButton: Locator;

  // Upload Progress
  readonly progressContainer: Locator;
  readonly progressFileName: Locator;
  readonly progressBar: Locator;
  readonly progressCancelButton: Locator;

  // Pickers
  readonly imagePicker: Locator;
  readonly videoPicker: Locator;
  readonly documentPicker: Locator;

  constructor(page: Page) {
    super(page);

    // Content Uploader
    this.uploaderContainer = page.locator(testIdSelector(TestIds.CONTENT_UPLOADER));
    this.uploaderButton = page.locator(testIdSelector(TestIds.CONTENT_UPLOADER_BUTTON));
    this.uploaderError = page.locator(testIdSelector(TestIds.CONTENT_UPLOADER_ERROR));

    // Content Preview
    this.previewContainer = page.locator(testIdSelector(TestIds.CONTENT_PREVIEW));
    this.previewImage = page.locator(testIdSelector(TestIds.CONTENT_PREVIEW_IMAGE));
    this.previewVideoThumbnail = page.locator(testIdSelector(TestIds.CONTENT_PREVIEW_VIDEO_THUMBNAIL));
    this.previewDocument = page.locator(testIdSelector(TestIds.CONTENT_PREVIEW_DOCUMENT));
    this.previewDeleteButton = page.locator(testIdSelector(TestIds.CONTENT_PREVIEW_DELETE_BUTTON));

    // Upload Progress
    this.progressContainer = page.locator(testIdSelector(TestIds.UPLOAD_PROGRESS_CONTAINER));
    this.progressFileName = page.locator(testIdSelector(TestIds.UPLOAD_PROGRESS_FILE_NAME));
    this.progressBar = page.locator(testIdSelector(TestIds.UPLOAD_PROGRESS_BAR));
    this.progressCancelButton = page.locator(testIdSelector(TestIds.UPLOAD_PROGRESS_CANCEL_BUTTON));

    // Pickers
    this.imagePicker = page.locator(testIdSelector(TestIds.IMAGE_PICKER));
    this.videoPicker = page.locator(testIdSelector(TestIds.VIDEO_PICKER));
    this.documentPicker = page.locator(testIdSelector(TestIds.DOCUMENT_PICKER));
  }

  /**
   * Click the upload button to open file picker
   */
  async clickUploadButton() {
    await this.uploaderButton.click();
  }

  /**
   * Cancel an in-progress upload
   */
  async cancelUpload() {
    await this.progressCancelButton.click();
    // Wait for progress container to disappear
    await expect(this.progressContainer).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Delete the currently previewed content
   */
  async deletePreviewedContent() {
    await this.previewDeleteButton.click();
    // Wait for preview to disappear
    await expect(this.previewContainer).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Wait for upload to complete
   * Waits for progress container to disappear and preview to appear
   */
  async waitForUploadComplete(contentType: 'image' | 'video' | 'document' = 'image') {
    // Wait for progress to complete
    await expect(this.progressContainer).not.toBeVisible({ timeout: 60000 });

    // Wait for preview to appear based on content type
    switch (contentType) {
      case 'image':
        await expect(this.previewImage).toBeVisible({ timeout: 10000 });
        break;
      case 'video':
        await expect(this.previewVideoThumbnail).toBeVisible({ timeout: 10000 });
        break;
      case 'document':
        await expect(this.previewDocument).toBeVisible({ timeout: 10000 });
        break;
    }
  }

  /**
   * Check if an upload error is displayed
   */
  async hasUploadError(): Promise<boolean> {
    return await this.uploaderError.count() > 0 && await this.uploaderError.isVisible();
  }

  /**
   * Get the upload error message
   */
  async getUploadErrorMessage(): Promise<string> {
    if (await this.hasUploadError()) {
      return (await this.uploaderError.textContent()) ?? '';
    }
    return '';
  }

  /**
   * Expect upload to be in progress
   */
  async expectUploadInProgress() {
    await expect(this.progressContainer).toBeVisible();
  }

  /**
   * Expect upload progress bar to show specific progress
   * Note: This is a placeholder - actual implementation depends on how progress is exposed
   */
  async expectUploadProgress(_minProgress: number) {
    await expect(this.progressBar).toBeVisible();
    // Additional progress assertions would depend on how the component exposes progress value
  }

  /**
   * Expect image preview to be visible
   */
  async expectImagePreviewVisible() {
    await expect(this.previewImage).toBeVisible();
  }

  /**
   * Expect video preview to be visible
   */
  async expectVideoPreviewVisible() {
    await expect(this.previewVideoThumbnail).toBeVisible();
  }

  /**
   * Expect document preview to be visible
   */
  async expectDocumentPreviewVisible() {
    await expect(this.previewDocument).toBeVisible();
  }

  /**
   * Expect no content preview (content was deleted or not uploaded)
   */
  async expectNoPreview() {
    await expect(this.previewContainer).not.toBeVisible();
  }

  /**
   * Expect upload error to be visible with specific message
   */
  async expectUploadError(messageContains?: string) {
    await expect(this.uploaderError).toBeVisible();
    if (messageContains) {
      await expect(this.uploaderError).toContainText(messageContains);
    }
  }

  /**
   * Expect no upload error
   */
  async expectNoUploadError() {
    // Use count() for instant check
    const errorCount = await this.uploaderError.count();
    if (errorCount > 0) {
      await expect(this.uploaderError).not.toBeVisible();
    }
  }

  /**
   * Get the current file name being uploaded
   */
  async getUploadingFileName(): Promise<string> {
    return (await this.progressFileName.textContent()) ?? '';
  }

  /**
   * Check if image picker is available
   */
  async isImagePickerAvailable(): Promise<boolean> {
    return await this.imagePicker.count() > 0;
  }

  /**
   * Check if video picker is available
   */
  async isVideoPickerAvailable(): Promise<boolean> {
    return await this.videoPicker.count() > 0;
  }

  /**
   * Check if document picker is available
   */
  async isDocumentPickerAvailable(): Promise<boolean> {
    return await this.documentPicker.count() > 0;
  }

  /**
   * Upload a file using the file chooser
   * Note: This requires the browser's file chooser to be triggered
   *
   * @param filePath - Path to the file to upload
   * @param pickerType - Type of picker to use
   */
  async uploadFile(filePath: string, pickerType: 'image' | 'video' | 'document' = 'image') {
    // Get the appropriate picker
    let picker: Locator;
    switch (pickerType) {
      case 'image':
        picker = this.imagePicker;
        break;
      case 'video':
        picker = this.videoPicker;
        break;
      case 'document':
        picker = this.documentPicker;
        break;
    }

    // Set up file chooser listener before clicking
    const fileChooserPromise = this.page.waitForEvent('filechooser');

    // Click the picker or upload button
    if (await picker.count() > 0) {
      await picker.click();
    } else {
      await this.uploaderButton.click();
    }

    // Handle file chooser
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);
  }
}
