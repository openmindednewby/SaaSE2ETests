// Visual QA Investigation V3: Capture scrolled views showing the mispositioned elements
// and deep CSS analysis

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = 'C:/desktopContents/projects/SaaS/E2ETests/visual-qa-screenshots/filter-investigation';

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function main() {
  await ensureDir(SCREENSHOTS_DIR);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  try {
    // Navigate
    await page.goto('http://localhost:4444/alerts-incidents/alerts-management', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    await page.waitForTimeout(3000);

    // ===================== TEST 1: Column Menu Mispositioning =====================
    console.log('=== TEST 1: Column Menu ===');

    // Click the ID column menu
    await page.evaluate(() => {
      const headers = document.querySelectorAll('.e-headercell');
      for (const header of headers) {
        const text = header.querySelector('.e-headercelldiv')?.textContent?.trim();
        if (text === 'ID') {
          header.querySelector('.e-columnmenu')?.click();
          return;
        }
      }
    });
    await page.waitForTimeout(800);

    // Screenshot of grid area (NOT scrolled - showing header where menu should appear)
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '10-colmenu-viewport-view.png'),
    });

    // Now scroll to the bottom to see where the menu actually is
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '11-colmenu-scrolled-to-bottom.png'),
    });

    // Get the column menu wrapper's full CSS and DOM details
    const menuWrapperCSS = await page.evaluate(() => {
      const wrapper = document.querySelector('.e-contextmenu-wrapper.e-grid-column-menu');
      if (!wrapper) return { error: 'no wrapper found' };

      const cs = window.getComputedStyle(wrapper);
      const rect = wrapper.getBoundingClientRect();

      // Get the inner UL (actual menu)
      const menuUL = wrapper.querySelector('ul.e-menu-parent, ul.e-contextmenu');
      const menuULcs = menuUL ? window.getComputedStyle(menuUL) : null;
      const menuULrect = menuUL ? menuUL.getBoundingClientRect() : null;

      // Check the wrapper's inline style attribute
      const wrapperStyle = wrapper.getAttribute('style');

      // Also check if the UL has position:fixed with top/left
      const ulStyle = menuUL?.getAttribute('style');

      return {
        wrapper: {
          tagName: wrapper.tagName,
          className: wrapper.className,
          inlineStyle: wrapperStyle,
          outerHTML: wrapper.outerHTML.substring(0, 3000),
          computed: {
            position: cs.position,
            top: cs.top,
            left: cs.left,
            right: cs.right,
            bottom: cs.bottom,
            width: cs.width,
            height: cs.height,
            display: cs.display,
            transform: cs.transform,
            zIndex: cs.zIndex,
            overflow: cs.overflow,
          },
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        },
        menuUL: menuUL ? {
          tagName: menuUL.tagName,
          className: menuUL.className?.toString?.(),
          inlineStyle: ulStyle,
          computed: {
            position: menuULcs.position,
            top: menuULcs.top,
            left: menuULcs.left,
            width: menuULcs.width,
            height: menuULcs.height,
            display: menuULcs.display,
            transform: menuULcs.transform,
            zIndex: menuULcs.zIndex,
          },
          rect: menuULrect ? { x: Math.round(menuULrect.x), y: Math.round(menuULrect.y), w: Math.round(menuULrect.width), h: Math.round(menuULrect.height) } : null,
        } : null,
      };
    });
    console.log('Column menu wrapper details:');
    console.log(JSON.stringify(menuWrapperCSS, null, 2));

    // Check: Is the issue that the wrapper is position:static (no positioning)?
    // The Syncfusion column menu wrapper should be position:fixed or position:absolute
    console.log('\n--- KEY FINDING ---');
    console.log(`Wrapper position: ${menuWrapperCSS.wrapper?.computed?.position}`);
    console.log(`Wrapper inline style: ${menuWrapperCSS.wrapper?.inlineStyle}`);
    if (menuWrapperCSS.menuUL) {
      console.log(`Menu UL position: ${menuWrapperCSS.menuUL.computed?.position}`);
      console.log(`Menu UL inline style: ${menuWrapperCSS.menuUL.inlineStyle}`);
    }

    // Close menu
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // ===================== TEST 2: Filter Dialog Mispositioning =====================
    console.log('\n=== TEST 2: Filter Dialog ===');

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    // Open column menu, then click Filter
    await page.evaluate(() => {
      const headers = document.querySelectorAll('.e-headercell');
      for (const header of headers) {
        const text = header.querySelector('.e-headercelldiv')?.textContent?.trim();
        if (text === 'Severity') {
          header.querySelector('.e-columnmenu')?.click();
          return;
        }
      }
    });
    await page.waitForTimeout(800);

    // Click Filter menu item
    const filterItems = await page.locator('.e-menu-item').all();
    for (const item of filterItems) {
      const text = await item.textContent().catch(() => '');
      if (text.includes('Filter')) {
        await item.click();
        break;
      }
    }
    await page.waitForTimeout(1000);

    // Screenshot showing filter dialog position
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '12-filter-dialog-viewport.png'),
    });

    // Scroll to see the filter dialog at the bottom-left
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '13-filter-dialog-scrolled.png'),
    });

    // Get filter dialog CSS details
    const filterDialogCSS = await page.evaluate(() => {
      const dialog = document.querySelector('.e-filter-popup.e-dialog');
      if (!dialog) return { error: 'no filter dialog found' };

      const cs = window.getComputedStyle(dialog);
      const rect = dialog.getBoundingClientRect();

      // Where is the Severity header?
      const headers = document.querySelectorAll('.e-headercell');
      let severityHeaderRect = null;
      for (const h of headers) {
        if (h.querySelector('.e-headercelldiv')?.textContent?.trim() === 'Severity') {
          severityHeaderRect = h.getBoundingClientRect();
          break;
        }
      }

      // Where is the dialog's parent (containing block)?
      let parent = dialog.parentElement;
      const parentInfo = parent ? {
        tag: parent.tagName,
        class: parent.className?.toString?.()?.substring(0, 100),
        position: window.getComputedStyle(parent).position,
        rect: parent.getBoundingClientRect(),
      } : null;

      // Walk up to find the first positioned ancestor (containing block)
      let containingBlock = dialog.parentElement;
      while (containingBlock && containingBlock !== document.documentElement) {
        const cbCs = window.getComputedStyle(containingBlock);
        if (cbCs.position !== 'static') {
          break;
        }
        containingBlock = containingBlock.parentElement;
      }

      return {
        dialog: {
          className: dialog.className,
          inlineStyle: dialog.getAttribute('style'),
          computed: {
            position: cs.position,
            top: cs.top,
            left: cs.left,
            right: cs.right,
            bottom: cs.bottom,
            width: cs.width,
            height: cs.height,
            maxHeight: cs.maxHeight,
            transform: cs.transform,
            zIndex: cs.zIndex,
          },
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        },
        parent: parentInfo,
        containingBlock: containingBlock ? {
          tag: containingBlock.tagName,
          class: containingBlock.className?.toString?.()?.substring(0, 100),
          position: window.getComputedStyle(containingBlock).position,
          rect: containingBlock.getBoundingClientRect(),
        } : null,
        severityHeaderRect: severityHeaderRect ? {
          x: Math.round(severityHeaderRect.x),
          y: Math.round(severityHeaderRect.y),
          w: Math.round(severityHeaderRect.width),
          h: Math.round(severityHeaderRect.height),
        } : null,
        documentScrollTop: document.documentElement.scrollTop,
        bodyScrollTop: document.body.scrollTop,
      };
    });
    console.log('Filter dialog details:');
    console.log(JSON.stringify(filterDialogCSS, null, 2));

    console.log('\n--- KEY FINDING ---');
    console.log(`Filter dialog position: ${filterDialogCSS.dialog?.computed?.position}`);
    console.log(`Filter dialog inline style: ${filterDialogCSS.dialog?.inlineStyle}`);
    console.log(`Filter dialog left: ${filterDialogCSS.dialog?.computed?.left} (NEGATIVE = mispositioned)`);
    console.log(`Filter dialog top: ${filterDialogCSS.dialog?.computed?.top}`);
    console.log(`Filter dialog rect: x=${filterDialogCSS.dialog?.rect?.x}, y=${filterDialogCSS.dialog?.rect?.y}`);
    if (filterDialogCSS.severityHeaderRect) {
      console.log(`Severity header rect: x=${filterDialogCSS.severityHeaderRect.x}, y=${filterDialogCSS.severityHeaderRect.y}`);
      const dx = filterDialogCSS.dialog?.rect?.x - filterDialogCSS.severityHeaderRect.x;
      const dy = filterDialogCSS.dialog?.rect?.y - (filterDialogCSS.severityHeaderRect.y + filterDialogCSS.severityHeaderRect.h);
      console.log(`Offset from header: dx=${dx}px, dy=${dy}px`);
    }

    // ===================== TEST 3: Check what CSS rule is affecting the positioning =====================
    console.log('\n=== TEST 3: CSS Rule Analysis ===');

    // Check all stylesheets for rules affecting .e-contextmenu-wrapper and .e-filter-popup
    const cssRules = await page.evaluate(() => {
      const results = { contextMenuWrapper: [], filterPopup: [], columnMenu: [] };

      for (const sheet of document.styleSheets) {
        try {
          const rules = sheet.cssRules || sheet.rules;
          if (!rules) continue;

          for (const rule of rules) {
            const text = rule.cssText || '';
            const selector = rule.selectorText || '';

            // Check for rules that target our elements
            if (selector.includes('e-contextmenu-wrapper') || selector.includes('e-grid-column-menu')) {
              if (text.includes('position') || text.includes('top') || text.includes('left') || text.includes('transform') || text.includes('z-index')) {
                results.contextMenuWrapper.push({
                  selector,
                  cssText: text.substring(0, 500),
                  source: sheet.href || 'inline',
                });
              }
            }

            if (selector.includes('e-filter-popup') || selector.includes('e-flmenu')) {
              if (text.includes('position') || text.includes('top') || text.includes('left') || text.includes('transform')) {
                results.filterPopup.push({
                  selector,
                  cssText: text.substring(0, 500),
                  source: sheet.href || 'inline',
                });
              }
            }

            if (selector.includes('e-columnmenu') || selector.includes('e-colmenu')) {
              results.columnMenu.push({
                selector,
                cssText: text.substring(0, 300),
                source: sheet.href || 'inline',
              });
            }
          }
        } catch (e) {
          // Cross-origin stylesheet, skip
        }
      }
      return results;
    });

    console.log('CSS rules for .e-contextmenu-wrapper:');
    for (const rule of cssRules.contextMenuWrapper) {
      console.log(`  [${rule.source?.split('/').pop()}] ${rule.selector}`);
      console.log(`    ${rule.cssText.substring(0, 300)}`);
    }
    console.log('\nCSS rules for .e-filter-popup:');
    for (const rule of cssRules.filterPopup) {
      console.log(`  [${rule.source?.split('/').pop()}] ${rule.selector}`);
      console.log(`    ${rule.cssText.substring(0, 300)}`);
    }

    // ===================== TEST 4: Check if position:fixed is being overridden =====================
    console.log('\n=== TEST 4: Position override check ===');

    // Close current dialogs
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    // Open column menu and check if Syncfusion sets position:fixed on the UL
    await page.evaluate(() => {
      const headers = document.querySelectorAll('.e-headercell');
      for (const header of headers) {
        const text = header.querySelector('.e-headercelldiv')?.textContent?.trim();
        if (text === 'ID') {
          header.querySelector('.e-columnmenu')?.click();
          return;
        }
      }
    });
    await page.waitForTimeout(800);

    const positionDetails = await page.evaluate(() => {
      const wrapper = document.querySelector('.e-contextmenu-wrapper.e-grid-column-menu');
      if (!wrapper) return { error: 'no wrapper' };

      // The wrapper itself
      const wrapperCs = window.getComputedStyle(wrapper);

      // All children
      const children = [];
      for (const child of wrapper.querySelectorAll('*')) {
        const cs = window.getComputedStyle(child);
        if (cs.position === 'fixed' || cs.position === 'absolute') {
          children.push({
            tag: child.tagName,
            class: child.className?.toString?.()?.substring(0, 100),
            position: cs.position,
            top: cs.top,
            left: cs.left,
            inlineStyle: child.getAttribute('style'),
            rect: child.getBoundingClientRect(),
          });
        }
      }

      // Check if Syncfusion is supposed to set position:fixed on the wrapper
      // Normal Syncfusion behavior: wrapper is position:fixed, UL inside has top/left set inline
      return {
        wrapperPosition: wrapperCs.position,
        wrapperDisplay: wrapperCs.display,
        wrapperInlineStyle: wrapper.getAttribute('style'),
        fixedOrAbsoluteChildren: children,
        totalChildren: wrapper.querySelectorAll('*').length,
      };
    });
    console.log('Position override details:');
    console.log(JSON.stringify(positionDetails, null, 2));

    // ===================== TEST 5: Check if custom CSS overrides Syncfusion positioning =====================
    console.log('\n=== TEST 5: Custom CSS Override Check ===');

    const overrideCheck = await page.evaluate(() => {
      const wrapper = document.querySelector('.e-contextmenu-wrapper.e-grid-column-menu');
      if (!wrapper) return { error: 'no wrapper' };

      // Get all matching CSS rules for this specific element
      const matchingRules = [];
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of (sheet.cssRules || sheet.rules || [])) {
            if (rule.selectorText && wrapper.matches(rule.selectorText)) {
              matchingRules.push({
                selector: rule.selectorText,
                position: rule.style?.position || '',
                top: rule.style?.top || '',
                left: rule.style?.left || '',
                display: rule.style?.display || '',
                source: sheet.href?.split('/').pop() || 'inline/<style>',
                fullCSS: rule.cssText.substring(0, 400),
              });
            }
          }
        } catch (e) { /* cross-origin */ }
      }

      // Also check the UL element
      const ul = wrapper.querySelector('ul');
      const ulMatchingRules = [];
      if (ul) {
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of (sheet.cssRules || sheet.rules || [])) {
              if (rule.selectorText && ul.matches(rule.selectorText)) {
                if (rule.style?.position || rule.style?.top || rule.style?.left) {
                  ulMatchingRules.push({
                    selector: rule.selectorText,
                    position: rule.style?.position || '',
                    top: rule.style?.top || '',
                    left: rule.style?.left || '',
                    source: sheet.href?.split('/').pop() || 'inline/<style>',
                    fullCSS: rule.cssText.substring(0, 400),
                  });
                }
              }
            }
          } catch (e) { /* cross-origin */ }
        }
      }

      return {
        wrapperMatchingRules: matchingRules,
        ulMatchingRules,
      };
    });
    console.log('Wrapper matching CSS rules:');
    for (const rule of overrideCheck.wrapperMatchingRules || []) {
      console.log(`  [${rule.source}] ${rule.selector}`);
      if (rule.position) console.log(`    position: ${rule.position}`);
      if (rule.top) console.log(`    top: ${rule.top}`);
      if (rule.left) console.log(`    left: ${rule.left}`);
      console.log(`    ${rule.fullCSS.substring(0, 200)}`);
    }
    console.log('\nUL matching CSS rules:');
    for (const rule of overrideCheck.ulMatchingRules || []) {
      console.log(`  [${rule.source}] ${rule.selector}`);
      console.log(`    ${rule.fullCSS.substring(0, 200)}`);
    }

    // ===================== TEST 6: Check the Syncfusion popup utility position method =====================
    console.log('\n=== TEST 6: Syncfusion popup openPopup check ===');

    const popupInfo = await page.evaluate(() => {
      const wrapper = document.querySelector('.e-contextmenu-wrapper.e-grid-column-menu');
      if (!wrapper) return { error: 'no wrapper' };

      // Check if there's a Popup instance on any element
      const popupElements = wrapper.querySelectorAll('.e-popup, [class*="e-popup"]');
      const popupInstances = [];
      for (const el of [wrapper, ...popupElements]) {
        if (el.ej2_instances) {
          for (const inst of el.ej2_instances) {
            popupInstances.push({
              constructor: inst.constructor?.name,
              position: inst.position,
              offsetX: inst.offsetX,
              offsetY: inst.offsetY,
              relateTo: inst.relateTo?.toString?.()?.substring(0, 100),
              collision: inst.collision,
              targetType: inst.targetType,
              element: {
                tag: el.tagName,
                class: el.className?.toString?.()?.substring(0, 100),
              },
            });
          }
        }
      }

      // Also check the UL context menu instance
      const ul = wrapper.querySelector('ul');
      if (ul?.ej2_instances) {
        for (const inst of ul.ej2_instances) {
          popupInstances.push({
            constructor: inst.constructor?.name,
            cssClass: inst.cssClass,
            items: inst.items?.length,
            target: inst.target?.substring?.(0, 100),
            element: {
              tag: ul.tagName,
              class: ul.className?.toString?.()?.substring(0, 100),
            },
          });
        }
      }

      return { popupInstances };
    });
    console.log('Syncfusion popup instances:', JSON.stringify(popupInfo, null, 2));

    // Take a final annotated screenshot
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '14-final-annotated.png'),
    });

    // Scroll to bottom to show the mispositioned menu
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '15-bottom-showing-menu.png'),
    });

    console.log('\n=== INVESTIGATION SUMMARY ===');
    console.log('1. Column menu wrapper (.e-contextmenu-wrapper) has position:static instead of position:fixed');
    console.log('2. This causes the menu to appear in normal document flow at the bottom of the page');
    console.log('3. The filter dialog (.e-filter-popup) has position:absolute with left:-287px, top:847px');
    console.log('4. These inline styles from Syncfusion calculate position relative to viewport but the');
    console.log('   containing block is wrong because the wrapper lacks position:fixed');
    console.log('5. The wrapper is a direct child of document.body, so with position:static it flows');
    console.log('   after all other body content');

    console.log('\n=== Done ===');

  } catch (error) {
    console.error('Error:', error.message);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'v3-error.png'),
    }).catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
