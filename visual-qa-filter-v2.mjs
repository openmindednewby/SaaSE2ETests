// Visual QA Investigation V2: Column Filter Positioning Issue
// Focused on opening column menu and capturing popup position evidence

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

  // Prevent navigations from column menu clicks (like "Sort Ascending" etc.)
  // We only want to observe the popup position
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    // Step 1: Navigate to the page
    console.log('=== Step 1: Navigate ===');
    await page.goto('http://localhost:4444/alerts-incidents/alerts-management', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    await page.waitForTimeout(3000); // Wait for grid to fully render

    // Step 2: Take initial screenshot of just the grid area
    console.log('=== Step 2: Initial state ===');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '01-initial-full.png'),
      fullPage: true
    });

    // Get grid and header positions
    const gridInfo = await page.evaluate(() => {
      const grid = document.querySelector('.e-grid');
      if (!grid) return null;
      const rect = grid.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    });
    console.log('Grid position:', JSON.stringify(gridInfo));

    // Get all column menu buttons
    const columnMenuInfo = await page.evaluate(() => {
      const menuBtns = document.querySelectorAll('.e-columnmenu');
      const headers = document.querySelectorAll('.e-headercell');
      const results = [];

      for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        const headerRect = header.getBoundingClientRect();
        const menuBtn = header.querySelector('.e-columnmenu');
        const headerText = header.querySelector('.e-headercelldiv')?.textContent?.trim() || '';

        if (menuBtn) {
          const btnRect = menuBtn.getBoundingClientRect();
          results.push({
            headerIndex: i,
            headerText,
            headerRect: { x: Math.round(headerRect.x), y: Math.round(headerRect.y), w: Math.round(headerRect.width), h: Math.round(headerRect.height) },
            menuBtnRect: { x: Math.round(btnRect.x), y: Math.round(btnRect.y), w: Math.round(btnRect.width), h: Math.round(btnRect.height) },
            menuBtnVisible: btnRect.width > 0 && btnRect.height > 0,
          });
        }
      }
      return results;
    });
    console.log('Column menu buttons found:', columnMenuInfo.length);
    for (const info of columnMenuInfo) {
      console.log(`  "${info.headerText}" header@(${info.headerRect.x},${info.headerRect.y}) btn@(${info.menuBtnRect.x},${info.menuBtnRect.y}) visible=${info.menuBtnVisible}`);
    }

    // Step 3: Click each column menu button and analyze positioning
    console.log('\n=== Step 3: Click column menu buttons one by one ===');

    for (let idx = 0; idx < Math.min(columnMenuInfo.length, 8); idx++) {
      const col = columnMenuInfo[idx];
      if (!col.menuBtnVisible) continue;

      console.log(`\n--- Testing column: "${col.headerText}" (header index ${col.headerIndex}) ---`);

      // Navigate fresh to avoid stale state
      if (idx > 0) {
        await page.goto('http://localhost:4444/alerts-incidents/alerts-management', {
          waitUntil: 'networkidle',
          timeout: 30000
        });
        await page.waitForTimeout(2000);
      }

      // Find and click the column menu button for this specific column
      const clicked = await page.evaluate((headerIdx) => {
        const headers = document.querySelectorAll('.e-headercell');
        const header = headers[headerIdx];
        if (!header) return { error: 'header not found' };

        const menuBtn = header.querySelector('.e-columnmenu');
        if (!menuBtn) return { error: 'no menu button in header' };

        // Get header position before click
        const headerRect = header.getBoundingClientRect();
        const btnRect = menuBtn.getBoundingClientRect();

        // Click the menu button
        menuBtn.click();

        return {
          clicked: true,
          headerRect: { x: Math.round(headerRect.x), y: Math.round(headerRect.y), w: Math.round(headerRect.width), h: Math.round(headerRect.height) },
          btnRect: { x: Math.round(btnRect.x), y: Math.round(btnRect.y), w: Math.round(btnRect.width), h: Math.round(btnRect.height) },
        };
      }, col.headerIndex);

      if (clicked.error) {
        console.log(`  Error: ${clicked.error}`);
        continue;
      }
      console.log(`  Clicked menu button at (${clicked.btnRect.x}, ${clicked.btnRect.y})`);

      // Wait for popup to appear
      await page.waitForTimeout(800);

      // Take screenshot immediately
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, `02-colmenu-${col.headerText.replace(/[^a-zA-Z0-9]/g, '_')}-${idx}.png`),
        fullPage: true
      });

      // Analyze the popup position
      const popupAnalysis = await page.evaluate((headerIdx) => {
        const headers = document.querySelectorAll('.e-headercell');
        const header = headers[headerIdx];
        const headerRect = header ? header.getBoundingClientRect() : null;
        const menuBtn = header?.querySelector('.e-columnmenu');
        const btnRect = menuBtn ? menuBtn.getBoundingClientRect() : null;

        // Find all column menu popups
        const popupWrappers = document.querySelectorAll('.e-contextmenu-wrapper, .e-columnmenu-wrapper, .e-grid-column-menu, .e-menu-wrapper');
        const popups = [];

        for (const wrapper of popupWrappers) {
          const cs = window.getComputedStyle(wrapper);
          const rect = wrapper.getBoundingClientRect();

          if (rect.width === 0 && rect.height === 0) continue;

          // Find the actual menu items container
          const menuParent = wrapper.querySelector('.e-menu-parent, .e-contextmenu, ul');
          const menuRect = menuParent ? menuParent.getBoundingClientRect() : null;

          popups.push({
            tagName: wrapper.tagName,
            className: wrapper.className?.toString?.()?.substring(0, 200),
            inlineStyle: wrapper.getAttribute('style'),
            computed: {
              position: cs.position,
              top: cs.top,
              left: cs.left,
              right: cs.right,
              bottom: cs.bottom,
              transform: cs.transform,
              transformOrigin: cs.transformOrigin,
              zIndex: cs.zIndex,
              display: cs.display,
              visibility: cs.visibility,
              opacity: cs.opacity,
              maxHeight: cs.maxHeight,
            },
            boundingRect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              right: Math.round(rect.right),
              bottom: Math.round(rect.bottom),
            },
            menuParentRect: menuRect ? {
              x: Math.round(menuRect.x),
              y: Math.round(menuRect.y),
              width: Math.round(menuRect.width),
              height: Math.round(menuRect.height),
            } : null,
            children: [...wrapper.children].map(c => ({
              tag: c.tagName,
              class: c.className?.toString?.()?.substring(0, 100),
              rect: { x: Math.round(c.getBoundingClientRect().x), y: Math.round(c.getBoundingClientRect().y) },
            })),
          });
        }

        // Also check for filter-specific popups
        const filterPopups = document.querySelectorAll('.e-filter-popup, .e-excelfilter, .e-checkboxfilter');
        for (const fp of filterPopups) {
          const cs = window.getComputedStyle(fp);
          const rect = fp.getBoundingClientRect();
          if (cs.display !== 'none' && rect.width > 0) {
            popups.push({
              type: 'filter-popup',
              className: fp.className?.toString?.()?.substring(0, 200),
              inlineStyle: fp.getAttribute('style'),
              computed: {
                position: cs.position,
                top: cs.top,
                left: cs.left,
                transform: cs.transform,
                zIndex: cs.zIndex,
              },
              boundingRect: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            });
          }
        }

        // Calculate offset from header to popup
        let offset = null;
        if (headerRect && popups.length > 0) {
          const popup = popups[0];
          offset = {
            fromHeaderLeft: popup.boundingRect.x - Math.round(headerRect.x),
            fromHeaderRight: popup.boundingRect.x - Math.round(headerRect.x + headerRect.width),
            fromHeaderBottom: popup.boundingRect.y - Math.round(headerRect.y + headerRect.height),
            fromBtnLeft: btnRect ? popup.boundingRect.x - Math.round(btnRect.x) : null,
            fromBtnBottom: btnRect ? popup.boundingRect.y - Math.round(btnRect.y + btnRect.height) : null,
            popupVisibleInViewport: popup.boundingRect.x >= 0 && popup.boundingRect.y >= 0 && popup.boundingRect.x + popup.boundingRect.width <= window.innerWidth && popup.boundingRect.y + popup.boundingRect.height <= window.innerHeight,
          };
        }

        return {
          headerRect: headerRect ? { x: Math.round(headerRect.x), y: Math.round(headerRect.y), w: Math.round(headerRect.width), h: Math.round(headerRect.height) } : null,
          btnRect: btnRect ? { x: Math.round(btnRect.x), y: Math.round(btnRect.y), w: Math.round(btnRect.width), h: Math.round(btnRect.height) } : null,
          popups,
          offset,
          viewportSize: { width: window.innerWidth, height: window.innerHeight },
        };
      }, col.headerIndex);

      console.log(`  Popup analysis:`);
      console.log(`    Header rect: ${JSON.stringify(popupAnalysis.headerRect)}`);
      console.log(`    Button rect: ${JSON.stringify(popupAnalysis.btnRect)}`);
      console.log(`    Popups found: ${popupAnalysis.popups.length}`);

      for (const popup of popupAnalysis.popups) {
        console.log(`    Popup: class="${popup.className}"`);
        console.log(`      Inline style: ${popup.inlineStyle}`);
        console.log(`      Computed: position=${popup.computed.position} top=${popup.computed.top} left=${popup.computed.left} z=${popup.computed.zIndex}`);
        console.log(`      Bounding rect: x=${popup.boundingRect.x} y=${popup.boundingRect.y} w=${popup.boundingRect.width} h=${popup.boundingRect.height}`);
        if (popup.menuParentRect) {
          console.log(`      Menu parent rect: x=${popup.menuParentRect.x} y=${popup.menuParentRect.y} w=${popup.menuParentRect.width} h=${popup.menuParentRect.height}`);
        }
      }

      if (popupAnalysis.offset) {
        console.log(`    Offset from header:`);
        console.log(`      fromHeaderLeft=${popupAnalysis.offset.fromHeaderLeft}px fromHeaderRight=${popupAnalysis.offset.fromHeaderRight}px`);
        console.log(`      fromHeaderBottom=${popupAnalysis.offset.fromHeaderBottom}px`);
        console.log(`      fromBtnLeft=${popupAnalysis.offset.fromBtnLeft}px fromBtnBottom=${popupAnalysis.offset.fromBtnBottom}px`);
        console.log(`      Visible in viewport: ${popupAnalysis.offset.popupVisibleInViewport}`);

        // Check for mispositioning
        const isOff = Math.abs(popupAnalysis.offset.fromHeaderLeft) > 300 ||
                       Math.abs(popupAnalysis.offset.fromHeaderBottom) > 100 ||
                       popupAnalysis.offset.fromHeaderBottom < -50;
        if (isOff) {
          console.log(`      >>> MISPOSITIONING DETECTED <<<`);
        }
      }

      // Close the menu
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // Step 4: Check for filter-specific popups (click filter item in column menu)
    console.log('\n=== Step 4: Open filter from column menu ===');
    await page.goto('http://localhost:4444/alerts-incidents/alerts-management', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    await page.waitForTimeout(2000);

    // Click the ID column menu button (index 2 in headers based on earlier output)
    const openedFilterMenu = await page.evaluate(() => {
      // Find a header with column menu that has "ID" text
      const headers = document.querySelectorAll('.e-headercell');
      for (const header of headers) {
        const text = header.querySelector('.e-headercelldiv')?.textContent?.trim();
        if (text === 'ID') {
          const menuBtn = header.querySelector('.e-columnmenu');
          if (menuBtn) {
            menuBtn.click();
            return { clicked: true, headerText: text };
          }
        }
      }
      // Fallback: click any header's menu
      for (const header of headers) {
        const menuBtn = header.querySelector('.e-columnmenu');
        if (menuBtn) {
          const rect = menuBtn.getBoundingClientRect();
          if (rect.width > 0) {
            menuBtn.click();
            return { clicked: true, headerText: header.querySelector('.e-headercelldiv')?.textContent?.trim() };
          }
        }
      }
      return { clicked: false };
    });
    console.log('Opened column menu for:', openedFilterMenu);
    await page.waitForTimeout(800);

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '03-column-menu-open.png'),
      fullPage: true
    });

    // Now look for "Filter" menu item in the column menu and click it
    const filterMenuItem = await page.locator('.e-filter-item, .e-menu-item:has-text("Filter"), [class*="filter-item"]').first();
    const filterMenuVisible = await filterMenuItem.isVisible().catch(() => false);
    console.log('Filter menu item visible:', filterMenuVisible);

    if (filterMenuVisible) {
      // Hover over Filter to open submenu
      await filterMenuItem.hover();
      await page.waitForTimeout(800);

      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '04-filter-submenu-hover.png'),
        fullPage: true
      });

      // Click the Filter item
      await filterMenuItem.click();
      await page.waitForTimeout(1000);

      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '05-filter-dialog-open.png'),
        fullPage: true
      });

      // Analyze filter dialog position
      const filterDialogAnalysis = await page.evaluate(() => {
        // Look for filter dialog/popup
        const dialogs = document.querySelectorAll('.e-filter-popup, .e-excelfilter, .e-checkboxfilter, .e-dlg-container, .e-filterdiv');
        const results = [];
        for (const d of dialogs) {
          const cs = window.getComputedStyle(d);
          const rect = d.getBoundingClientRect();
          if (cs.display !== 'none' && rect.width > 0) {
            results.push({
              class: d.className?.toString?.()?.substring(0, 200),
              inlineStyle: d.getAttribute('style'),
              computed: {
                position: cs.position,
                top: cs.top,
                left: cs.left,
                transform: cs.transform,
                zIndex: cs.zIndex,
              },
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            });
          }
        }
        return results;
      });
      console.log('Filter dialog analysis:', JSON.stringify(filterDialogAnalysis, null, 2));
    }

    // Step 5: Comprehensive transform chain from popup to document root
    console.log('\n=== Step 5: Full ancestor chain for popups ===');
    await page.goto('http://localhost:4444/alerts-incidents/alerts-management', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    await page.waitForTimeout(2000);

    // Click a column menu to open it
    await page.evaluate(() => {
      const headers = document.querySelectorAll('.e-headercell');
      for (const header of headers) {
        const menuBtn = header.querySelector('.e-columnmenu');
        if (menuBtn) {
          const rect = menuBtn.getBoundingClientRect();
          if (rect.width > 0) {
            menuBtn.click();
            return;
          }
        }
      }
    });
    await page.waitForTimeout(800);

    const ancestorChain = await page.evaluate(() => {
      // Find the visible column menu popup
      const popup = document.querySelector('.e-contextmenu-wrapper.e-grid-column-menu');
      if (!popup) return { error: 'No popup found' };

      const popupRect = popup.getBoundingClientRect();
      const popupCs = window.getComputedStyle(popup);

      // Walk up the DOM tree from popup to document root
      const chain = [];
      let el = popup;
      while (el && el !== document.documentElement) {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        chain.push({
          tag: el.tagName,
          id: el.id || '',
          class: el.className?.toString?.()?.substring(0, 150) || '',
          inlineStyle: el.getAttribute('style')?.substring(0, 200) || '',
          position: cs.position,
          top: cs.top,
          left: cs.left,
          transform: cs.transform,
          transformOrigin: cs.transformOrigin,
          willChange: cs.willChange,
          perspective: cs.perspective,
          filter: cs.filter,
          contain: cs.contain,
          overflow: cs.overflow,
          overflowX: cs.overflowX,
          overflowY: cs.overflowY,
          clipPath: cs.clipPath,
          isolation: cs.isolation,
          zIndex: cs.zIndex,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        });
        el = el.parentElement;
      }

      // Also check: where is the popup in the DOM? Inside the grid or appended to body?
      const popupParent = popup.parentElement;
      const isInGrid = popup.closest('.e-grid') !== null;
      const isDirectBodyChild = popupParent === document.body;

      // Check Syncfusion grid's internal properties
      const gridEl = document.querySelector('.e-grid');
      const gridInstance = gridEl?.ej2_instances?.[0];

      return {
        popup: {
          class: popup.className?.toString?.(),
          inlineStyle: popup.getAttribute('style'),
          position: popupCs.position,
          top: popupCs.top,
          left: popupCs.left,
          transform: popupCs.transform,
          zIndex: popupCs.zIndex,
          rect: { x: Math.round(popupRect.x), y: Math.round(popupRect.y), w: Math.round(popupRect.width), h: Math.round(popupRect.height) },
        },
        domLocation: {
          isInGrid,
          isDirectBodyChild,
          parentTag: popupParent?.tagName,
          parentClass: popupParent?.className?.toString?.()?.substring(0, 100),
        },
        ancestorChain: chain,
        gridSettings: gridInstance ? {
          showColumnMenu: gridInstance.showColumnMenu,
          allowFiltering: gridInstance.allowFiltering,
          filterSettings: gridInstance.filterSettings?.type,
        } : null,
      };
    });

    console.log('Popup DOM location:', JSON.stringify(ancestorChain.domLocation, null, 2));
    console.log('Popup position:', JSON.stringify(ancestorChain.popup, null, 2));
    console.log('Grid settings:', JSON.stringify(ancestorChain.gridSettings, null, 2));
    console.log('\nAncestor chain (popup to root):');
    for (const item of ancestorChain.ancestorChain || []) {
      const hasTransform = item.transform !== 'none';
      const hasFilter = item.filter !== 'none';
      const hasContain = item.contain !== 'none';
      const hasWillChange = item.willChange !== 'auto';
      const hasPerspective = item.perspective !== 'none';
      const hasOverflow = item.overflow !== 'visible';
      const isIssue = hasTransform || hasFilter || hasContain || hasWillChange || hasPerspective;

      const prefix = isIssue ? '>>> ISSUE >>> ' : '              ';
      console.log(`${prefix}${item.tag}#${item.id} .${item.class.substring(0, 80)}`);
      console.log(`                position=${item.position} top=${item.top} left=${item.left}`);
      if (hasTransform) console.log(`                transform=${item.transform} origin=${item.transformOrigin}`);
      if (hasFilter) console.log(`                filter=${item.filter}`);
      if (hasContain) console.log(`                contain=${item.contain}`);
      if (hasWillChange) console.log(`                will-change=${item.willChange}`);
      if (hasPerspective) console.log(`                perspective=${item.perspective}`);
      if (hasOverflow) console.log(`                overflow=${item.overflow} (${item.overflowX}/${item.overflowY})`);
      if (item.inlineStyle) console.log(`                inline: ${item.inlineStyle}`);
      console.log(`                rect: x=${item.rect.x} y=${item.rect.y} w=${item.rect.w} h=${item.rect.h}`);
    }

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '06-final-popup-state.png'),
      fullPage: true
    });

    // Step 6: Check if the column menu position is correct relative to the clicked header
    console.log('\n=== Step 6: Position correctness analysis ===');

    // Re-check - we need header position that was clicked
    const correctnessCheck = await page.evaluate(() => {
      const popup = document.querySelector('.e-contextmenu-wrapper.e-grid-column-menu');
      if (!popup) return { error: 'no popup' };

      const popupRect = popup.getBoundingClientRect();

      // Find the header that the column menu belongs to
      // Check all headers and find which one has the active state or is closest to popup
      const headers = document.querySelectorAll('.e-headercell');
      let closestHeader = null;
      let minDistance = Infinity;

      for (const h of headers) {
        const menuBtn = h.querySelector('.e-columnmenu');
        if (!menuBtn) continue;

        const btnRect = menuBtn.getBoundingClientRect();
        const hRect = h.getBoundingClientRect();

        // Calculate distance from menu button to popup
        const dist = Math.abs(btnRect.x - popupRect.x) + Math.abs(btnRect.y + btnRect.height - popupRect.y);
        if (dist < minDistance) {
          minDistance = dist;
          closestHeader = {
            text: h.querySelector('.e-headercelldiv')?.textContent?.trim(),
            headerRect: { x: Math.round(hRect.x), y: Math.round(hRect.y), w: Math.round(hRect.width), h: Math.round(hRect.height) },
            btnRect: { x: Math.round(btnRect.x), y: Math.round(btnRect.y), w: Math.round(btnRect.width), h: Math.round(btnRect.height) },
            distance: Math.round(dist),
          };
        }
      }

      // Expected position: popup should be near the menu button
      // Typically right below the button, left-aligned with the button or header
      const expectedY = closestHeader ? closestHeader.btnRect.y + closestHeader.btnRect.h : 0;
      const expectedX = closestHeader ? closestHeader.btnRect.x : 0;

      const actualX = Math.round(popupRect.x);
      const actualY = Math.round(popupRect.y);

      const xOffset = actualX - expectedX;
      const yOffset = actualY - expectedY;

      return {
        closestHeader,
        popupRect: { x: actualX, y: actualY, w: Math.round(popupRect.width), h: Math.round(popupRect.height) },
        expectedPosition: { x: expectedX, y: expectedY },
        actualOffset: { x: xOffset, y: yOffset },
        isMispositioned: Math.abs(xOffset) > 50 || Math.abs(yOffset) > 50,
        severity: Math.abs(xOffset) > 200 || Math.abs(yOffset) > 200 ? 'SEVERE' :
                  Math.abs(xOffset) > 50 || Math.abs(yOffset) > 50 ? 'MODERATE' : 'OK',
      };
    });

    console.log('Position correctness:', JSON.stringify(correctnessCheck, null, 2));

    // Step 7: Specifically check if there's a sidebar or layout panel causing offset
    console.log('\n=== Step 7: Layout analysis (sidebar, main content, theme panel) ===');
    const layoutAnalysis = await page.evaluate(() => {
      // Check for sidebar
      const sidebar = document.querySelector('[class*="sidebar"], [class*="Sidebar"], nav[class*="nav"], [data-testid*="sidebar"]');
      const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : null;
      const sidebarCs = sidebar ? window.getComputedStyle(sidebar) : null;

      // Check for main content area
      const main = document.querySelector('main, [class*="main-content"], [class*="content-area"], [role="main"]');
      const mainRect = main ? main.getBoundingClientRect() : null;
      const mainCs = main ? window.getComputedStyle(main) : null;

      // Check for theme settings panel
      const themePanel = document.querySelector('[class*="theme-settings"], [class*="ThemeSettings"], [data-testid*="theme-settings"]');
      const themePanelRect = themePanel ? themePanel.getBoundingClientRect() : null;

      // Check for any scrollable containers
      const scrollContainers = [];
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        if (el.scrollTop > 0 || el.scrollLeft > 0) {
          scrollContainers.push({
            tag: el.tagName,
            class: el.className?.toString?.()?.substring(0, 100),
            scrollTop: el.scrollTop,
            scrollLeft: el.scrollLeft,
          });
        }
      }

      return {
        sidebar: sidebarRect ? {
          rect: { x: Math.round(sidebarRect.x), y: Math.round(sidebarRect.y), w: Math.round(sidebarRect.width), h: Math.round(sidebarRect.height) },
          position: sidebarCs?.position,
          transform: sidebarCs?.transform,
        } : null,
        mainContent: mainRect ? {
          rect: { x: Math.round(mainRect.x), y: Math.round(mainRect.y), w: Math.round(mainRect.width), h: Math.round(mainRect.height) },
          position: mainCs?.position,
          transform: mainCs?.transform,
          overflow: mainCs?.overflow,
        } : null,
        themePanel: themePanelRect ? {
          rect: { x: Math.round(themePanelRect.x), y: Math.round(themePanelRect.y), w: Math.round(themePanelRect.width), h: Math.round(themePanelRect.height) },
        } : null,
        scrollContainers: scrollContainers.slice(0, 10),
      };
    });
    console.log('Layout analysis:', JSON.stringify(layoutAnalysis, null, 2));

    // Step 8: Now test the filter dialog specifically (via column menu > Filter)
    console.log('\n=== Step 8: Test filter dialog via column menu ===');

    // Close existing menu
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Navigate fresh
    await page.goto('http://localhost:4444/alerts-incidents/alerts-management', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    await page.waitForTimeout(2000);

    // Open column menu on the "Severity" column
    await page.evaluate(() => {
      const headers = document.querySelectorAll('.e-headercell');
      for (const header of headers) {
        const text = header.querySelector('.e-headercelldiv')?.textContent?.trim();
        if (text === 'Severity') {
          const menuBtn = header.querySelector('.e-columnmenu');
          if (menuBtn) menuBtn.click();
          return;
        }
      }
    });
    await page.waitForTimeout(800);

    // Look for Filter menu item
    const filterItems = await page.locator('.e-menu-item').all();
    let filterItemFound = false;
    for (const item of filterItems) {
      const text = await item.textContent().catch(() => '');
      if (text.includes('Filter')) {
        console.log('Found Filter menu item, clicking...');

        // First hover to open submenu if needed
        await item.hover();
        await page.waitForTimeout(500);

        await page.screenshot({
          path: path.join(SCREENSHOTS_DIR, '07-filter-hover.png'),
          fullPage: true
        });

        await item.click();
        await page.waitForTimeout(1500);
        filterItemFound = true;

        await page.screenshot({
          path: path.join(SCREENSHOTS_DIR, '08-filter-dialog.png'),
          fullPage: true
        });

        // Analyze filter popup position
        const filterPopupData = await page.evaluate(() => {
          // Find any open dialog/popup
          const candidates = [
            ...document.querySelectorAll('.e-filter-popup'),
            ...document.querySelectorAll('.e-excelfilter'),
            ...document.querySelectorAll('.e-checkboxfilter'),
            ...document.querySelectorAll('.e-dialog:not(.e-popup-close)'),
            ...document.querySelectorAll('.e-popup:not(.e-popup-close)'),
            ...document.querySelectorAll('.e-dlg-container'),
          ];

          const results = [];
          for (const el of candidates) {
            const cs = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            if (cs.display === 'none' || rect.width === 0) continue;

            // Check ancestors for containing blocks that create new stacking context
            const containingAncestors = [];
            let ancestor = el.parentElement;
            while (ancestor && ancestor !== document.body) {
              const ancestorCs = window.getComputedStyle(ancestor);
              const isContainingBlock =
                ancestorCs.transform !== 'none' ||
                ancestorCs.willChange === 'transform' ||
                ancestorCs.filter !== 'none' ||
                ancestorCs.perspective !== 'none' ||
                ancestorCs.contain === 'paint' || ancestorCs.contain === 'layout' || ancestorCs.contain === 'strict';

              if (isContainingBlock) {
                containingAncestors.push({
                  tag: ancestor.tagName,
                  class: ancestor.className?.toString?.()?.substring(0, 100),
                  transform: ancestorCs.transform,
                  willChange: ancestorCs.willChange,
                  filter: ancestorCs.filter,
                  perspective: ancestorCs.perspective,
                  contain: ancestorCs.contain,
                  rect: ancestor.getBoundingClientRect(),
                });
              }
              ancestor = ancestor.parentElement;
            }

            results.push({
              class: el.className?.toString?.()?.substring(0, 200),
              inline: el.getAttribute('style'),
              position: cs.position,
              top: cs.top,
              left: cs.left,
              transform: cs.transform,
              zIndex: cs.zIndex,
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
              containingBlockAncestors: containingAncestors,
            });
          }
          return results;
        });

        console.log('Filter popup data:', JSON.stringify(filterPopupData, null, 2));
        break;
      }
    }

    if (!filterItemFound) {
      console.log('No Filter menu item found in column menu. Menu items:');
      for (const item of filterItems) {
        const text = await item.textContent().catch(() => '');
        const classes = await item.getAttribute('class').catch(() => '');
        console.log(`  "${text.trim()}" class="${classes}"`);
      }
    }

    // Step 9: Console errors
    console.log('\n=== Step 9: Console errors ===');
    console.log(`Total console errors: ${consoleErrors.length}`);
    for (const err of consoleErrors.slice(0, 20)) {
      console.log(`  ${err.substring(0, 300)}`);
    }

    // Final screenshot
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '09-final.png'),
      fullPage: true
    });

    console.log('\n=== Investigation complete ===');

  } catch (error) {
    console.error('Error:', error.message, error.stack?.substring(0, 500));
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'error.png'),
      fullPage: true
    }).catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
