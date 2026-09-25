// Regenerates the store screenshots, marquee and README popup shot by embedding the
// real popup (with stubbed chrome APIs) in composition pages.
// Usage: npm i -g playwright && node store-assets/render.js
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const globalRoot = require('child_process').execSync('npm root -g').toString().trim();
    return require(path.join(globalRoot, 'playwright'));
  }
}

const { chromium } = loadPlaywright();
const ROOT = path.resolve(__dirname, '..');
const EXT = `file://${ROOT}/extension`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'job-sniper-shots-'));

const STUB = () => {
  if (!location.href.includes('popup.html')) return;
  window.chrome = {
    runtime: { sendMessage: (m, cb) => cb({ ok: true, status: { running: true, interval: 0.5, targetTabId: 1 } }) },
    storage: { local: { get: async () => ({ hidePromoted: true, hideViewed: true }), set: async () => {} } },
    tabs: {
      query: async () => [{ id: 1, url: 'https://www.linkedin.com/jobs/search/?f_TPR=r600&f_WT=2,3&f_E=2,3&f_AL=true&sortBy=DD' }],
      sendMessage: async () => ({ hidden: { promoted: 4, viewed: 3 } }),
    },
  };
};

const FONT = [400, 500, 600, 700].map(w => `@font-face{font-family:Inter;font-weight:${w};src:url(${EXT}/fonts/inter-${w}.woff2)}`).join('');
const BASE = `${FONT}

*{margin:0;padding:0;box-sizing:border-box}
body{width:var(--w);height:var(--h);overflow:hidden;position:relative;background:#060a13;font-family:Inter,sans-serif;color:#eef2f7;-webkit-font-smoothing:antialiased;font-feature-settings:"calt" 0}
.bg{position:absolute;inset:0;background:
 radial-gradient(ellipse 45% 55% at 8% 4%,rgba(20,184,166,.42),transparent 70%),
 radial-gradient(ellipse 45% 50% at 96% 92%,rgba(59,130,246,.38),transparent 70%),
 radial-gradient(ellipse 30% 25% at 45% 108%,rgba(251,113,133,.16),transparent 70%)}
.eyebrow{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;letter-spacing:.16em;color:#5eead4;text-transform:uppercase}
.eyebrow::before{content:"";width:8px;height:8px;border-radius:50%;background:#5eead4;box-shadow:0 0 0 4px rgba(94,234,212,.18)}
h1{font-weight:700;letter-spacing:-.045em;line-height:1.02}
h1 em{font-style:normal;background:linear-gradient(180deg,#99f6e4,#2dd4bf);-webkit-background-clip:text;color:transparent}
p.lead{color:rgba(203,213,225,.72);line-height:1.5}
ul.checks{list-style:none;display:flex;flex-direction:column;gap:14px}
ul.checks li{display:flex;align-items:center;gap:14px;font-size:19px;color:#e2e8f0}
ul.checks li::before{content:"✓";display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:#5eead4;font-size:15px;font-weight:700}
.brand{display:flex;align-items:center;gap:16px;font-size:20px;font-weight:600}
.brand img{width:40px;height:40px;border-radius:10px}
.frame{position:absolute;transform-origin:0 0}
.frame iframe{display:block;border:0;background:transparent}
.popup{border-radius:22px;box-shadow:0 30px 80px -20px rgba(0,0,0,.8)}
`;

// Full popup with rounded corners, clipped inside the frame (clipping the iframe itself leaks at the corners).
const ROUNDED = `html{background:linear-gradient(transparent,transparent)!important} .toast{display:none}
body{height:596px;border-radius:22px;overflow:hidden!important;clip-path:inset(0 round 22px);border:1px solid rgba(255,255,255,.12)} .aurora,.grain{position:absolute!important}`;

// Frame CSS: show only some popup sections, transparent so the page backdrop shows through.
const only = (sel) => `html,body{background:transparent!important;max-height:none!important;overflow:visible!important}
.aurora,.grain,.header,.summary,#emptyState{display:none!important}
.app{padding:0!important} #mainContent>section{display:none!important} ${sel}{display:block!important}`;

async function render(browser, name, w, h, html, frames = {}) {
  const file = path.join(DIR, `${name}.html`);
  fs.writeFileSync(file, `<!doctype html><html><head><style>${BASE}</style></head><body style="--w:${w}px;--h:${h}px"><div class="bg"></div>${html}</body></html>`);
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.addInitScript(STUB);
  await page.goto(`file://${file}`);
  await page.waitForTimeout(800);
  for (const f of page.frames()) {
    const css = frames[f.name()];
    if (css) await f.addStyleTag({ content: css });
    if (f !== page.mainFrame()) await f.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  }
  await page.waitForTimeout(300);
  return page;
}

const iframe = (name, { x, y, scale, w = 360, h = 596, cls = '' }) =>
  `<div class="frame ${cls}" style="left:${x}px;top:${y}px;transform:scale(${scale})"><iframe name="${name}" src="${EXT}/popup.html" width="${w}" height="${h}" allowtransparency="true"></iframe></div>`;

const JOBS = [
  ['Frontend Engineer', 'Northwind Labs · Remote', '3 minutes ago', null],
  ['Senior React Developer', 'Contoso Cloud · Hybrid', 'Promoted', 'promoted'],
  ['Software Engineer II', 'Fabrikam · Remote', '7 minutes ago', null],
  ['Full Stack Developer', 'Tailspin Systems · Hybrid', 'Viewed', 'viewed'],
  ['Product Engineer', 'Litware · Remote', 'Promoted', 'promoted'],
];

(async () => {
  const browser = await chromium.launch();

  // 1 — hero with the full popup
  let p = await render(browser, 'screenshot-1', 1280, 800, `
    <div style="position:absolute;left:90px;top:112px;width:560px">
      <div class="brand"><img src="${EXT}/icons/icon128.png">Job Sniper</div>
      <div class="eyebrow" style="margin-top:50px">For LinkedIn Jobs</div>
      <h1 style="font-size:78px;margin-top:22px">Be the first<br>to <em>apply.</em></h1>
      <p class="lead" style="font-size:21px;margin-top:26px">See jobs minutes after they're posted, filtered to exactly what you want, refreshed automatically.</p>
      <ul class="checks" style="margin-top:34px">
        <li>Posted within 1 minute to 1 week</li>
        <li>Auto-refresh every 30s, 1m, 2m or 5m</li>
        <li>Hide Promoted &amp; already Viewed jobs</li>
      </ul>
    </div>
    ${iframe('pop', { x: 766, y: 38, scale: 1.215, cls: 'popup' })}`, { pop: ROUNDED });
  await p.screenshot({ path: `${ROOT}/store-assets/screenshot-1.jpg`, type: 'jpeg', quality: 92 });

  // 2 — auto-refresh + posted within
  p = await render(browser, 'screenshot-2', 1280, 800, `
    ${iframe('a', { x: 90, y: 196, scale: 1.556, h: 250 })}
    <div style="position:absolute;left:730px;top:210px;width:470px">
      <div class="eyebrow">Always fresh</div>
      <h1 style="font-size:64px;margin-top:22px">New jobs,<br><em>every 30<br>seconds.</em></h1>
      <p class="lead" style="font-size:20px;margin-top:26px">Auto-refresh stays locked to your search tab, even when you switch tabs. Choose any window from the last minute to the last week, or type your own.</p>
    </div>`, { a: only('#mainContent>section:nth-of-type(1),#mainContent>section:nth-of-type(2)') + '#mainContent{gap:10px!important}' });
  await p.screenshot({ path: `${ROOT}/store-assets/screenshot-2.jpg`, type: 'jpeg', quality: 92 });

  // 3 — filters card
  p = await render(browser, 'screenshot-3', 1280, 800, `
    <div style="position:absolute;left:90px;top:200px;width:470px">
      <div class="eyebrow">Precise filters</div>
      <h1 style="font-size:64px;margin-top:22px">Only the roles<br><em>that fit you.</em></h1>
      <p class="lead" style="font-size:20px;margin-top:26px">Remote, Hybrid or On-site. Internship to Executive. Easy Apply only, newest first. One tap each, and the page updates once.</p>
      <ul class="checks" style="margin-top:30px"><li>Filters always match the page</li><li>No account, no tracking, no data collected</li></ul>
    </div>
    ${iframe('f', { x: 630, y: 178, scale: 1.556, h: 300 })}`, { f: only('#mainContent>section:nth-of-type(3)') });
  await p.screenshot({ path: `${ROOT}/store-assets/screenshot-3.jpg`, type: 'jpeg', quality: 92 });

  // 4 — hide promoted & viewed
  const rows = JOBS.map(([t, c, meta, kind]) => `
    <div class="job ${kind ? 'gone' : ''}">
      <div class="logo">${t[0]}</div>
      <div class="txt"><div class="t">${t}</div><div class="c">${c}</div><div class="m ${kind || 'fresh'}">${meta}</div></div>
      ${kind ? '<span class="tag">Hidden</span>' : ''}
    </div>`).join('');
  p = await render(browser, 'screenshot-4', 1280, 800, `
    <style>
      .list{position:absolute;left:90px;top:200px;width:540px;padding:10px;border-radius:24px;background:linear-gradient(160deg,rgba(255,255,255,.085),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.1);box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 30px 80px -20px rgba(0,0,0,.8)}
      .job{display:flex;align-items:center;gap:16px;padding:14px 16px;border-radius:16px}
      .job+.job{margin-top:4px}
      .job:not(.gone){background:rgba(0,0,0,.16);border:1px solid rgba(255,255,255,.06)}
      .job.gone{border:1px dashed rgba(255,255,255,.16)}.job.gone>.logo,.job.gone>.txt{opacity:.3}
      .job.gone .t{text-decoration:line-through;text-decoration-color:rgba(255,255,255,.5)}
      .logo{flex:none;display:grid;place-items:center;width:46px;height:46px;border-radius:12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);font-weight:700;font-size:18px;color:rgba(226,232,240,.8)}
      .txt{flex:1;min-width:0}.t{font-size:17px;font-weight:600;letter-spacing:-.01em}.c{font-size:14px;color:rgba(203,213,225,.7);margin-top:3px}
      .m{font-size:13px;margin-top:5px;color:rgba(203,213,225,.55)}.m.fresh{color:#5eead4}
      .tag{flex:none;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:5px 10px;border-radius:999px;color:#fda4af;background:rgba(253,164,175,.12);border:1px solid rgba(253,164,175,.3)}
    </style>
    <div class="list">${rows}</div>
    ${iframe('h', { x: 90, y: 100, scale: 1.5, h: 60 })}
    <div style="position:absolute;left:730px;top:196px;width:470px">
      <div class="eyebrow">Less noise</div>
      <h1 style="font-size:64px;margin-top:22px">Skip the ads.<br><em>Skip the<br>repeats.</em></h1>
      <p class="lead" style="font-size:20px;margin-top:26px">Hide Promoted listings and jobs you've already opened, so only fresh posts are left in your results.</p>
      <ul class="checks" style="margin-top:30px"><li>A job you open stays until the next refresh</li><li>Works with auto-refresh</li></ul>
    </div>`, { h: only('#mainContent>section:nth-of-type(3)') + `
      #mainContent>section:nth-of-type(3){padding:10px!important}
      #mainContent>section:nth-of-type(3)>:not(.toggle-pair){display:none!important}
      .toggle-pair{grid-template-columns:1fr 1fr!important}
      .toggle-pair>.toggle-cell:nth-child(-n+2){display:none!important}` });
  await p.screenshot({ path: `${ROOT}/store-assets/screenshot-4.jpg`, type: 'jpeg', quality: 92 });

  // Marquee 1400x560
  p = await render(browser, 'marquee', 1400, 560, `
    <div style="position:absolute;left:110px;top:134px;width:700px">
      <div class="brand"><img src="${EXT}/icons/icon128.png" style="width:48px;height:48px">Job Sniper</div>
      <h1 style="font-size:82px;margin-top:40px">Be the first<br>to <em>apply.</em></h1>
      <p class="lead" style="font-size:21px;margin-top:26px">Minute-level filters, auto-refresh, and no Promoted clutter.</p>
    </div>
    ${iframe('pop', { x: 898, y: 180, scale: 1.09, cls: 'popup' })}`, { pop: ROUNDED });
  await p.screenshot({ path: `${ROOT}/store-assets/marquee-1400x560.jpg`, type: 'jpeg', quality: 92 });

  // README popup shot at 2x
  const pp = await browser.newPage({ viewport: { width: 360, height: 596 }, deviceScaleFactor: 2 });
  await pp.addInitScript(STUB);
  await pp.goto(`${EXT}/popup.html`);
  await pp.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  await pp.waitForTimeout(600);
  await pp.screenshot({ path: `${ROOT}/screenshots/job-sniper.png` });

  await browser.close();
})();
