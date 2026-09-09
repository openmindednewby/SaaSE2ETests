const { chromium } = require('@playwright/test');
const fs = require('fs');
const OUT = 'C:/desktopContents/projects/SaaS/E2ETests/visual-baselines/kefi-align';
const SUFFIX = process.env.PHASE || 'before';
const TENANTS = ['csdf','ubb','ubs','kucy','kizomba-union-cy','united-by-salsa'];
const WIDTHS = [390,768,1024,1440];

function probe() {
  const out = { template: document.body.getAttribute('data-template') || document.documentElement.getAttribute('data-template'), grids: [] };
  const sels = ['.teachers-grid','.artists-grid','[class*="teacher"][class*="grid"]','[class*="artist"][class*="grid"]'];
  const seen = new Set();
  for (const s of sels) {
    for (const g of document.querySelectorAll(s)) {
      if (seen.has(g)) continue; seen.add(g);
      const cs = getComputedStyle(g);
      const kids = [...g.children].map(c => {
        const r = c.getBoundingClientRect();
        const imgs = [...c.querySelectorAll('img')].map(i => { const ir = i.getBoundingClientRect(); return { ovX: +(ir.right - r.right).toFixed(1), ovB: +(ir.bottom - r.bottom).toFixed(1) }; });
        return { top: +r.top.toFixed(1), left: +r.left.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
                 scrollOverflow: c.scrollHeight - c.clientHeight, imgs };
      });
      const rows = {};
      kids.forEach(k => { const key = Math.round(k.top / 5) * 5; (rows[key] = rows[key] || []).push(k); });
      const rowSummary = Object.keys(rows).sort((a,b)=>a-b).map(k => {
        const hs = rows[k].map(x=>x.h);
        return { count: rows[k].length, minH: Math.min(...hs), maxH: Math.max(...hs), spread: +(Math.max(...hs)-Math.min(...hs)).toFixed(1),
                 bottomMax: Math.max(...rows[k].map(x=>x.top+x.h)) };
      });
      for (let i=1;i<rowSummary.length;i++) rowSummary[i].gapFromPrev = +(Object.keys(rows).sort((a,b)=>a-b)[i] - rowSummary[i-1].bottomMax).toFixed(1);
      out.grids.push({ cls: g.className, alignItems: cs.alignItems, cols: cs.gridTemplateColumns, display: cs.display,
                       rowGap: cs.rowGap, n: kids.length, rows: rowSummary,
                       overflowingImgs: kids.reduce((a,k)=>a+k.imgs.filter(i=>i.ovX>1||i.ovB>1).length,0),
                       overflowingCards: kids.filter(k=>k.scrollOverflow>1).length });
    }
  }
  out.cssHasTeachersGrid = [...document.styleSheets].filter(ss=>{try{return [...ss.cssRules].some(r=>r.cssText&&r.cssText.includes('teachers-grid'))}catch(e){return false}}).length;
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (const t of TENANTS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0,160)); });
    page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0,160)));
    for (const w of WIDTHS) {
      const rec = { tenant: t, width: w };
      try {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(`https://${t}.kefi.dloizides.com/`, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(2500);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(600);
        const file = `${OUT}/${t}-${w}-${SUFFIX}.png`;
        await page.screenshot({ path: file, fullPage: true });
        Object.assign(rec, await page.evaluate(probe));
        rec.screenshot = file;
        rec.consoleErrors = errs.splice(0).slice(0, 4);
      } catch (e) { rec.error = String(e).slice(0, 200); }
      results.push(rec);
      console.log(`${t} ${w} :: align=${rec.grids ? rec.grids.map(g=>g.alignItems+'/n='+g.n).join(',') : 'NO-GRID'} tpl=${rec.template} err=${(rec.consoleErrors||[]).length}${rec.error?' FAIL '+rec.error:''}`);
    }
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/metrics-${SUFFIX}.json`, JSON.stringify(results, null, 1));
  await browser.close();
})();
