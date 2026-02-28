// Visual QA Investigation: Column Filter Positioning Issue
// Page: http://localhost:4444/alerts-incidents/alerts-management

import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = 'C:/desktopContents/projects/SaaS/E2ETests/visual-qa-screenshots';

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

  // Collect console errors
  const consoleErrors = [];
  const consoleWarnings = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });

  // Collect network errors
  const networkErrors = [];
  page.on('response', response => {
    if (response.status() >= 400) {
      networkErrors.push({
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
      });
    }
  });

  try {
    // Step 1: Navigate to the page
    console.log('=== Step 1: Navigating to alerts management page ===');
    await page.goto('http://localhost:4444/alerts-incidents/alerts-management', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    await page.waitForTimeout(2000); // Let animations settle

    // Step 2: Take initial screenshot
    console.log('=== Step 2: Taking initial screenshot ===');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '01-initial-page-state.png'),
      fullPage: true
    });
    console.log('Initial screenshot saved');

    // Step 3: Find the data grid and identify column headers
    console.log('=== Step 3: Finding data grid ===');

    // Look for Syncfusion Grid
    const gridExists = await page.locator('.e-grid, .e-gridcontent, [class*="grid"], [data-testid*="grid"], [class*="Grid"]').first().isVisible().catch(() => false);
    console.log('Grid visible:', gridExists);

    // Get all column headers
    const headerCells = await page.locator('.e-headercell, .e-headercelldiv, th, [role="columnheader"]').all();
    console.log('Found header cells:', headerCells.length);

    for (let i = 0; i < Math.min(headerCells.length, 10); i++) {
      const text = await headerCells[i].textContent().catch(() => 'N/A');
      const classes = await headerCells[i].getAttribute('class').catch(() => 'N/A');
      console.log(`  Header ${i}: "${text?.trim()}" classes="${classes}"`);
    }

    // Step 4: Look for filter icons in column headers
    console.log('\n=== Step 4: Looking for filter icons ===');
    const filterIcons = await page.locator('.e-filtermenudiv, .e-icon-filter, .e-filtered, [class*="filter"], .e-filter-icon, .e-columnmenu, .e-icons.e-columnmenu, .e-columnmenu-icon').all();
    console.log('Found filter icons:', filterIcons.length);

    for (let i = 0; i < Math.min(filterIcons.length, 10); i++) {
      const tag = await filterIcons[i].evaluate(el => el.tagName);
      const classes = await filterIcons[i].getAttribute('class').catch(() => 'N/A');
      const visible = await filterIcons[i].isVisible().catch(() => false);
      const box = await filterIcons[i].boundingBox().catch(() => null);
      console.log(`  Filter icon ${i}: <${tag}> classes="${classes}" visible=${visible} box=${JSON.stringify(box)}`);
    }

    // Also look for header filter areas and menu buttons
    const menuBtns = await page.locator('.e-columnmenubtn, [class*="menubtn"], .e-icon-grightarrow').all();
    console.log('Found menu buttons:', menuBtns.length);

    // Step 5: Try right-clicking a column header to open context menu
    console.log('\n=== Step 5: Attempting to open column filter ===');

    // Approach A: Click filter icon directly
    let filterOpened = false;

    if (filterIcons.length > 0) {
      for (let i = 0; i < Math.min(filterIcons.length, 5); i++) {
        const visible = await filterIcons[i].isVisible().catch(() => false);
        if (visible) {
          const box = await filterIcons[i].boundingBox();
          if (box && box.width > 0 && box.height > 0) {
            console.log(`Clicking filter icon ${i} at (${box.x + box.width/2}, ${box.y + box.height/2})`);
            await filterIcons[i].click({ force: true });
            await page.waitForTimeout(1000);
            filterOpened = true;
            break;
          }
        }
      }
    }

    // Screenshot after first click attempt
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '02-after-filter-icon-click.png'),
      fullPage: true
    });

    // Approach B: If no filter icon found, try clicking column header and looking for column menu
    if (!filterOpened && headerCells.length > 0) {
      // Try hovering over a header cell to reveal filter icon
      for (let i = 0; i < Math.min(headerCells.length, 5); i++) {
        const visible = await headerCells[i].isVisible().catch(() => false);
        if (visible) {
          console.log(`Hovering over header cell ${i}...`);
          await headerCells[i].hover();
          await page.waitForTimeout(500);

          // Check if filter icon appeared after hover
          const hoverFilterIcons = await page.locator('.e-filtermenudiv, .e-icon-filter, .e-columnmenu, .e-filter-icon').all();
          for (const icon of hoverFilterIcons) {
            const isVis = await icon.isVisible().catch(() => false);
            if (isVis) {
              const box = await icon.boundingBox();
              if (box && box.width > 0) {
                console.log(`Found visible filter icon after hover, clicking...`);
                await icon.click({ force: true });
                await page.waitForTimeout(1000);
                filterOpened = true;
                break;
              }
            }
          }
          if (filterOpened) break;
        }
      }
    }

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '03-after-hover-and-click.png'),
      fullPage: true
    });

    // Approach C: Right-click header cell
    if (!filterOpened && headerCells.length > 0) {
      for (let i = 0; i < Math.min(headerCells.length, 5); i++) {
        const visible = await headerCells[i].isVisible().catch(() => false);
        if (visible) {
          console.log(`Right-clicking header cell ${i}...`);
          await headerCells[i].click({ button: 'right' });
          await page.waitForTimeout(1000);

          const contextMenu = await page.locator('.e-contextmenu, .e-menu-popup, .e-contextmenuwrapper, [class*="contextmenu"], [class*="popup"]').first().isVisible().catch(() => false);
          if (contextMenu) {
            filterOpened = true;
            console.log('Context menu opened via right-click');
            break;
          }
        }
      }
    }

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '04-after-right-click.png'),
      fullPage: true
    });

    // Step 6: Check for any open filter/popup dialogs
    console.log('\n=== Step 6: Checking for filter popups ===');
    const filterPopups = await page.locator('.e-filter-popup, .e-filterdiv, .e-excelfilter, .e-checkboxfilter, .e-dlg-container, .e-popup, .e-dialog, [class*="filter-popup"], [class*="filter-dialog"], .e-popup-open').all();
    console.log('Found filter popups:', filterPopups.length);

    for (let i = 0; i < filterPopups.length; i++) {
      const visible = await filterPopups[i].isVisible().catch(() => false);
      const box = await filterPopups[i].boundingBox().catch(() => null);
      const classes = await filterPopups[i].getAttribute('class').catch(() => 'N/A');
      const styles = await filterPopups[i].evaluate(el => {
        const cs = window.getComputedStyle(el);
        return {
          position: cs.position,
          top: cs.top,
          left: cs.left,
          right: cs.right,
          bottom: cs.bottom,
          transform: cs.transform,
          zIndex: cs.zIndex,
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          width: cs.width,
          height: cs.height,
          overflow: cs.overflow,
        };
      }).catch(() => null);

      console.log(`  Popup ${i}: visible=${visible} box=${JSON.stringify(box)} classes="${classes}"`);
      console.log(`    Computed styles: ${JSON.stringify(styles, null, 2)}`);
    }

    // Step 7: Try broader approach - get ALL visible elements that look like popups/dropdowns
    console.log('\n=== Step 7: Broader popup search ===');
    const allPopups = await page.evaluate(() => {
      const results = [];
      // Look for all elements with position:absolute or position:fixed that might be popups
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const cs = window.getComputedStyle(el);
        if ((cs.position === 'absolute' || cs.position === 'fixed') &&
            cs.display !== 'none' &&
            cs.visibility !== 'hidden' &&
            el.offsetWidth > 50 && el.offsetHeight > 50) {
          const rect = el.getBoundingClientRect();
          // Filter to likely popup candidates (not body, html, etc)
          if (rect.width < 1000 && rect.height < 800 && rect.width > 50 && rect.height > 50) {
            results.push({
              tagName: el.tagName,
              id: el.id,
              className: el.className?.toString?.()?.substring(0, 200) || '',
              position: cs.position,
              top: cs.top,
              left: cs.left,
              transform: cs.transform,
              zIndex: cs.zIndex,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            });
          }
        }
      }
      return results;
    });
    console.log('Popup-like positioned elements:', allPopups.length);
    for (const popup of allPopups.slice(0, 20)) {
      console.log(`  ${popup.tagName}#${popup.id} class="${popup.className.substring(0,100)}" pos=${popup.position} top=${popup.top} left=${popup.left} transform=${popup.transform} z=${popup.zIndex} rect=${JSON.stringify(popup.rect)}`);
    }

    // Step 8: Inspect the full page DOM structure for the grid
    console.log('\n=== Step 8: DOM structure analysis ===');
    const gridInfo = await page.evaluate(() => {
      const grid = document.querySelector('.e-grid, [class*="e-grid"]');
      if (!grid) return { found: false, message: 'No Syncfusion grid found' };

      const rect = grid.getBoundingClientRect();
      const cs = window.getComputedStyle(grid);

      // Check all ancestors for transforms
      const ancestorTransforms = [];
      let el = grid;
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        if (style.transform && style.transform !== 'none') {
          ancestorTransforms.push({
            tagName: el.tagName,
            id: el.id,
            className: el.className?.toString?.()?.substring(0, 100) || '',
            transform: style.transform,
            position: style.position,
          });
        }
        el = el.parentElement;
      }

      return {
        found: true,
        gridRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        gridPosition: cs.position,
        gridTransform: cs.transform,
        gridOverflow: cs.overflow,
        ancestorTransforms,
      };
    });
    console.log('Grid info:', JSON.stringify(gridInfo, null, 2));

    // Step 9: Now try a more aggressive approach - look at ALL Syncfusion classes in DOM
    console.log('\n=== Step 9: Full Syncfusion class inventory ===');
    const sfClasses = await page.evaluate(() => {
      const allEls = document.querySelectorAll('[class*="e-"]');
      const classSet = new Set();
      for (const el of allEls) {
        const classes = el.className?.toString?.()?.split(' ') || [];
        for (const c of classes) {
          if (c.startsWith('e-') && (c.includes('filter') || c.includes('menu') || c.includes('popup') || c.includes('dialog') || c.includes('column'))) {
            classSet.add(c);
          }
        }
      }
      return [...classSet].sort();
    });
    console.log('Syncfusion filter/menu/popup classes in DOM:', sfClasses);

    // Step 10: Now let's try to find the filter by looking at the header structure more carefully
    console.log('\n=== Step 10: Detailed header inspection ===');
    const headerHTML = await page.evaluate(() => {
      const header = document.querySelector('.e-gridheader, .e-headercelldiv, thead, [class*="header"]');
      if (!header) return 'No header found';
      return header.outerHTML.substring(0, 5000);
    });
    console.log('Header HTML (first 5000 chars):', headerHTML);

    // Step 11: If filter was opened, inspect its position relative to the triggering header
    console.log('\n=== Step 11: Filter position analysis ===');

    // Try a different approach: use Syncfusion grid API
    const gridAPI = await page.evaluate(() => {
      // Try to access Syncfusion grid instance
      const gridEl = document.querySelector('.e-grid');
      if (!gridEl) return { error: 'No grid element found' };

      // Syncfusion stores the instance on the element
      const instance = gridEl?.ej2_instances?.[0];
      if (!instance) return { error: 'No Syncfusion grid instance found', gridHTML: gridEl.outerHTML.substring(0, 2000) };

      return {
        columns: instance.columns?.map(c => ({ field: c.field, headerText: c.headerText, allowFiltering: c.allowFiltering })),
        allowFiltering: instance.allowFiltering,
        filterSettings: instance.filterSettings,
        showColumnMenu: instance.showColumnMenu,
        contextMenuItems: instance.contextMenuItems,
      };
    });
    console.log('Grid API info:', JSON.stringify(gridAPI, null, 2));

    // Step 12: Now actually open a filter via Syncfusion's programmatic API
    console.log('\n=== Step 12: Attempting programmatic filter open ===');
    const filterOpenResult = await page.evaluate(() => {
      const gridEl = document.querySelector('.e-grid');
      if (!gridEl) return { error: 'No grid element' };

      const instance = gridEl?.ej2_instances?.[0];
      if (!instance) return { error: 'No grid instance' };

      try {
        // Try to show filter bar or open column menu
        if (instance.showColumnMenu) {
          const firstHeader = document.querySelector('.e-headercell');
          if (firstHeader) {
            // Try to trigger column menu
            const event = new MouseEvent('click', { bubbles: true, cancelable: true });
            const menuBtn = firstHeader.querySelector('.e-columnmenubtn, .e-filtermenudiv, [class*="menu"]');
            if (menuBtn) {
              menuBtn.dispatchEvent(event);
              return { triggered: 'columnMenuButton', target: menuBtn.className };
            }
          }
        }

        // Try filter dialog
        if (instance.allowFiltering) {
          const firstColumn = instance.columns?.[0];
          if (firstColumn?.field) {
            // Try openColumnMenu or showFilterBar methods
            if (typeof instance.showColumnMenu === 'function') {
              return { error: 'showColumnMenu is boolean, not function' };
            }
          }
        }

        return { error: 'Could not trigger filter programmatically', showColumnMenu: instance.showColumnMenu, allowFiltering: instance.allowFiltering };
      } catch (e) {
        return { error: e.message };
      }
    });
    console.log('Filter open result:', JSON.stringify(filterOpenResult, null, 2));

    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '05-after-programmatic-attempt.png'),
      fullPage: true
    });

    // Step 13: Try clicking directly on the first column header cell and its internal elements
    console.log('\n=== Step 13: Direct interaction with column header elements ===');

    // Get detailed info about header cell internal structure
    const headerStructure = await page.evaluate(() => {
      const headers = document.querySelectorAll('.e-headercell');
      const results = [];
      for (let i = 0; i < Math.min(headers.length, 5); i++) {
        const h = headers[i];
        const children = [];
        const walk = (el, depth) => {
          if (depth > 3) return;
          for (const child of el.children) {
            children.push({
              tag: child.tagName,
              class: child.className?.toString?.()?.substring(0, 100) || '',
              rect: child.getBoundingClientRect(),
              text: child.textContent?.substring(0, 50),
            });
            walk(child, depth + 1);
          }
        };
        walk(h, 0);
        results.push({
          index: i,
          class: h.className?.toString?.() || '',
          rect: h.getBoundingClientRect(),
          childElements: children,
        });
      }
      return results;
    });
    console.log('Header structure:');
    for (const h of headerStructure) {
      console.log(`  Header ${h.index}: class="${h.class}" rect=${JSON.stringify({x: Math.round(h.rect.x), y: Math.round(h.rect.y), w: Math.round(h.rect.width), h: Math.round(h.rect.height)})}`);
      for (const c of h.childElements) {
        console.log(`    ${c.tag}.${c.class} rect=${JSON.stringify({x: Math.round(c.rect.x), y: Math.round(c.rect.y), w: Math.round(c.rect.width), h: Math.round(c.rect.height)})} "${c.text?.trim()}"`);
      }
    }

    // Try clicking the column menu button specifically
    const menuBtnSelector = '.e-columnmenubtn, .e-icon-columnmenu, .e-filtermenudiv';
    const menuButtons = await page.locator(menuBtnSelector).all();
    console.log(`\nFound ${menuButtons.length} column menu buttons with selector: ${menuBtnSelector}`);

    if (menuButtons.length > 0) {
      for (let i = 0; i < Math.min(menuButtons.length, 3); i++) {
        const btn = menuButtons[i];
        const box = await btn.boundingBox().catch(() => null);
        const visible = await btn.isVisible().catch(() => false);
        console.log(`  Menu button ${i}: visible=${visible} box=${JSON.stringify(box)}`);

        if (visible && box) {
          console.log(`  Clicking menu button ${i}...`);
          await btn.click({ force: true });
          await page.waitForTimeout(1500);

          // Take screenshot showing the result
          await page.screenshot({
            path: path.join(SCREENSHOTS_DIR, `06-after-menu-btn-click-${i}.png`),
            fullPage: true
          });

          // Now check for opened popups
          const openedPopup = await page.evaluate(() => {
            const popups = document.querySelectorAll('.e-filter-popup, .e-popup-open, .e-dialog, .e-popup:not(.e-popup-close), .e-contextmenu, .e-menu-wrapper, .e-columnmenu');
            const results = [];
            for (const p of popups) {
              const cs = window.getComputedStyle(p);
              const rect = p.getBoundingClientRect();
              if (cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0) {
                // Find all ancestors with transforms
                const transforms = [];
                let ancestor = p.parentElement;
                while (ancestor && ancestor !== document.body) {
                  const ancestorStyle = window.getComputedStyle(ancestor);
                  if (ancestorStyle.transform !== 'none') {
                    transforms.push({
                      tag: ancestor.tagName,
                      id: ancestor.id,
                      class: ancestor.className?.toString?.()?.substring(0, 100) || '',
                      transform: ancestorStyle.transform,
                      position: ancestorStyle.position,
                      rect: ancestor.getBoundingClientRect(),
                    });
                  }
                  ancestor = ancestor.parentElement;
                }

                results.push({
                  tag: p.tagName,
                  id: p.id,
                  class: p.className?.toString?.()?.substring(0, 200) || '',
                  position: cs.position,
                  top: cs.top,
                  left: cs.left,
                  transform: cs.transform,
                  zIndex: cs.zIndex,
                  display: cs.display,
                  visibility: cs.visibility,
                  rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                  ancestorTransforms: transforms,
                  inlineStyle: p.getAttribute('style'),
                });
              }
            }
            return results;
          });

          console.log(`  Opened popups after clicking button ${i}:`, JSON.stringify(openedPopup, null, 2));

          if (openedPopup.length > 0) {
            // Close it before trying next button
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
          }
        }
      }
    }

    // Step 14: Try finding filter by hovering headers to reveal hidden icons
    console.log('\n=== Step 14: Hover-reveal approach ===');
    const headerCellsAll = await page.locator('.e-headercell').all();
    for (let i = 0; i < Math.min(headerCellsAll.length, 5); i++) {
      const cell = headerCellsAll[i];
      const visible = await cell.isVisible().catch(() => false);
      if (!visible) continue;

      await cell.hover();
      await page.waitForTimeout(300);

      // Check if any icon became visible inside this header
      const revealedIcons = await cell.locator('.e-filtermenudiv, .e-icon-filter, .e-columnmenubtn').all();
      for (const icon of revealedIcons) {
        const iconVisible = await icon.isVisible().catch(() => false);
        const box = await icon.boundingBox().catch(() => null);
        if (iconVisible && box && box.width > 0) {
          console.log(`  Revealed icon in header ${i}: box=${JSON.stringify(box)}`);

          // Click it
          await icon.click({ force: true });
          await page.waitForTimeout(1500);

          await page.screenshot({
            path: path.join(SCREENSHOTS_DIR, `07-after-hover-reveal-click-${i}.png`),
            fullPage: true
          });

          // Analyze popup position
          const popupAnalysis = await page.evaluate((headerIndex) => {
            const headers = document.querySelectorAll('.e-headercell');
            const header = headers[headerIndex];
            if (!header) return { error: 'header not found' };

            const headerRect = header.getBoundingClientRect();

            // Find any visible popup
            const allPopups = document.querySelectorAll('.e-filter-popup, .e-popup-open, .e-dialog, .e-popup:not(.e-popup-close), .e-contextmenu, .e-menu-wrapper, .e-columnmenu, .e-filterdiv, .e-excelfilter, .e-checkboxfilter');

            for (const popup of allPopups) {
              const cs = window.getComputedStyle(popup);
              if (cs.display === 'none' || cs.visibility === 'hidden') continue;
              const popupRect = popup.getBoundingClientRect();
              if (popupRect.width === 0 || popupRect.height === 0) continue;

              // Calculate offset from header
              const offsetX = popupRect.x - headerRect.x;
              const offsetY = popupRect.y - (headerRect.y + headerRect.height);

              // Check for ancestor transforms
              const transforms = [];
              let el = popup.parentElement;
              while (el && el !== document.documentElement) {
                const s = window.getComputedStyle(el);
                if (s.transform !== 'none') {
                  transforms.push({
                    tag: el.tagName,
                    id: el.id,
                    class: el.className?.toString?.()?.substring(0, 100),
                    transform: s.transform,
                    transformOrigin: s.transformOrigin,
                    position: s.position,
                  });
                }
                el = el.parentElement;
              }

              return {
                headerRect: { x: Math.round(headerRect.x), y: Math.round(headerRect.y), width: Math.round(headerRect.width), height: Math.round(headerRect.height) },
                popupRect: { x: Math.round(popupRect.x), y: Math.round(popupRect.y), width: Math.round(popupRect.width), height: Math.round(popupRect.height) },
                offset: { x: Math.round(offsetX), y: Math.round(offsetY) },
                popupCSS: {
                  position: cs.position,
                  top: cs.top,
                  left: cs.left,
                  right: cs.right,
                  bottom: cs.bottom,
                  transform: cs.transform,
                  transformOrigin: cs.transformOrigin,
                  zIndex: cs.zIndex,
                  maxHeight: cs.maxHeight,
                  maxWidth: cs.maxWidth,
                },
                popupClass: popup.className?.toString?.()?.substring(0, 200),
                popupInlineStyle: popup.getAttribute('style'),
                ancestorTransforms: transforms,
                isMispositioned: Math.abs(offsetX) > 200 || Math.abs(offsetY) > 200 || popupRect.x < 0 || popupRect.y < 0,
              };
            }

            return { error: 'no popup found after click' };
          }, i);

          console.log(`  Popup analysis for header ${i}:`, JSON.stringify(popupAnalysis, null, 2));

          // Close before next
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
        }
      }
    }

    // Step 15: Check ALL parent elements for transforms from root to grid
    console.log('\n=== Step 15: Complete transform chain analysis ===');
    const transformChain = await page.evaluate(() => {
      const grid = document.querySelector('.e-grid');
      if (!grid) return { error: 'No grid found' };

      const chain = [];
      let el = grid;
      while (el && el !== document.documentElement) {
        const cs = window.getComputedStyle(el);
        chain.push({
          tag: el.tagName,
          id: el.id,
          class: el.className?.toString?.()?.substring(0, 150) || '',
          position: cs.position,
          transform: cs.transform,
          transformOrigin: cs.transformOrigin,
          willChange: cs.willChange,
          perspective: cs.perspective,
          filter: cs.filter !== 'none' ? cs.filter : undefined,
          contain: cs.contain !== 'none' ? cs.contain : undefined,
          overflow: cs.overflow,
          overflowX: cs.overflowX,
          overflowY: cs.overflowY,
        });
        el = el.parentElement;
      }
      return chain;
    });
    console.log('Transform chain (grid to root):');
    for (const item of transformChain) {
      const hasIssue = item.transform !== 'none' || item.willChange !== 'auto' || item.perspective !== 'none' || item.filter;
      const prefix = hasIssue ? '>>> ' : '    ';
      console.log(`${prefix}${item.tag}#${item.id} .${item.class.substring(0, 80)}`);
      if (hasIssue) {
        console.log(`        transform: ${item.transform}, willChange: ${item.willChange}, perspective: ${item.perspective}, filter: ${item.filter}`);
      }
      if (item.overflow !== 'visible' && item.overflow !== '') {
        console.log(`        overflow: ${item.overflow} (${item.overflowX}/${item.overflowY})`);
      }
    }

    // Step 16: Check for CSS zoom or scale on body/root
    console.log('\n=== Step 16: Check for zoom/scale on root elements ===');
    const rootStyles = await page.evaluate(() => {
      const html = document.documentElement;
      const body = document.body;
      const htmlCs = window.getComputedStyle(html);
      const bodyCs = window.getComputedStyle(body);

      return {
        html: {
          zoom: htmlCs.zoom,
          transform: htmlCs.transform,
          fontSize: htmlCs.fontSize,
          position: htmlCs.position,
        },
        body: {
          zoom: bodyCs.zoom,
          transform: bodyCs.transform,
          fontSize: bodyCs.fontSize,
          position: bodyCs.position,
        },
        devicePixelRatio: window.devicePixelRatio,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      };
    });
    console.log('Root styles:', JSON.stringify(rootStyles, null, 2));

    // Step 17: Console errors summary
    console.log('\n=== Step 17: Console errors ===');
    console.log('Errors:', consoleErrors.length);
    for (const err of consoleErrors.slice(0, 20)) {
      console.log(`  ERROR: ${err.substring(0, 200)}`);
    }
    console.log('Warnings:', consoleWarnings.length);
    for (const warn of consoleWarnings.slice(0, 10)) {
      console.log(`  WARN: ${warn.substring(0, 200)}`);
    }

    // Step 18: Network errors summary
    console.log('\n=== Step 18: Network errors ===');
    console.log('Network errors:', networkErrors.length);
    for (const err of networkErrors) {
      console.log(`  ${err.status} ${err.statusText}: ${err.url.substring(0, 150)}`);
    }

    // Final full-page screenshot
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '08-final-state.png'),
      fullPage: true
    });

    console.log('\n=== Investigation complete ===');
    console.log(`Screenshots saved to: ${SCREENSHOTS_DIR}`);

  } catch (error) {
    console.error('Investigation error:', error.message);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'error-state.png'),
      fullPage: true
    }).catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
