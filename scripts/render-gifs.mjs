// Renders docs/koi-dark.gif and docs/koi-light.gif as a seamless loop.
// Usage: npm run build && npm i --no-save playwright-core && CHROME=/path/to/chrome node scripts/render-gifs.mjs [workdir]
// Needs ffmpeg on PATH. Output is deterministic: fixed seed, fixed 80 ms step, no pointer.
//
// Why it loops: the sim is chaotic (random spawn edges, random rests). We seed it, turn rests off, and replace
// each koi's lead point with a path of integer harmonics of one period P. Drive-time `s` (tail, fins, pad bob)
// advances exactly 10π per period, the smallest span where sin(4s), sin(5s), sin(1.4s) all close. The body
// follows the lead through contractive filters, so after a few warm-up periods frame N == frame 0.
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { extname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const WORK = resolve(process.argv[2] ?? "/tmp/koi-frames");
const STEP = 80; // ms per frame = GIF delay of 8 cs (12.5 fps)
const N = 250; // frames per loop → P = 20 s
const WARM = 4; // warm-up periods before recording
const W = 924;
const H = 510;
const LIGHT = { "#eef2f5": "#4b5663", "#cdd6dc": "#8a96a3" }; // body/fin recolored for light pages

const PAGE = `<body style="margin:0"><div id="p" style="width:${W}px;height:${H}px"></div>
<script type="importmap">{"imports":{"ascii-pond":"/node_modules/ascii-pond/dist/index.js"}}</script></body>`;
const mime = { ".js": "text/javascript", ".html": "text/html" };
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/") return void res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
    const body = await readFile(join(ROOT, req.url));
    res.writeHead(200, { "content-type": mime[extname(req.url)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROME });
for (const theme of ["dark", "light"]) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    window.requestAnimationFrame = (cb) => ((window.__raf = cb), 1);
    let a = 12345; // mulberry32: seeded spawn edges/positions
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  await page.goto(`${base}/`);
  await page.evaluate(
    async ({ base, light, STEP, N, WARM }) => {
      const pond = await import(`${base}/node_modules/ascii-pond/dist/index.js`);
      const { KoiSim } = await import(`${base}/dist/index.js`);
      let sim;
      pond.mountPond(document.getElementById("p"), {
        background: "transparent",
        interactive: false,
        scene: (c, r) => {
          sim = new KoiSim(c, r, c < 64 ? 0.5 : 1);
          if (light) {
            const cell = sim.cell.bind(sim);
            sim.cell = (x, y) => {
              const g = cell(x, y);
              return g && light[g.color] ? { ...g, color: light[g.color] } : g;
            };
          }
          return sim;
        },
      });
      while (!window.__raf) await new Promise((r) => setTimeout(r, 20));
      const P = N * STEP;
      // integer harmonics per koi: [x1, x2, y1, y2]
      const harm = [[2, 5, 1, 3], [2, 6, 3, 7]];
      let t = 0;
      const stepOnce = () => {
        // first step builds the koi; then pin them to the loop before every later step
        const cb = window.__raf;
        cb(1000 + t);
        t += STEP;
      };
      stepOnce();
      sim.koi.forEach((k) => {
        k.nextRest = Infinity;
        k.rest = 0;
      });
      sim.pond.steer = (target, x, y) => {
        const i = sim.koi.findIndex((k) => k.spine[0].x === x && k.spine[0].y === y);
        const k = sim.koi[i];
        const th = (2 * Math.PI * (t - STEP)) / P;
        const [a, b, c, d] = harm[i];
        k.s = k.ph + 5 * th; // 10π over one period
        const lead = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
        target.x = lead(k.cx + k.ax * (Math.sin(a * th + k.ph) + 0.33 * Math.sin(b * th + k.ph + 1.3)), 12, sim.PW - 12);
        target.y = lead(k.cy + k.ay * (Math.cos(c * th + k.ph) + 0.42 * Math.sin(d * th + k.ph + 0.5)), 12, sim.PH - 12);
        return false;
      };
      window.__step = stepOnce;
      window.__warm = () => {
        for (let i = 0; i < WARM * N; i += 1) stepOnce();
      };
    },
    { base, light: theme === "light" ? LIGHT : null, STEP, N, WARM },
  );
  await page.evaluate(() => window.__warm());
  const dir = join(WORK, theme);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const el = page.locator("canvas");
  for (let i = 0; i <= N; i += 1) {
    // frame N is the same instant as frame 0; kept as seam.png only for checking
    await el.screenshot({ path: join(dir, i === N ? "seam.png" : `f${String(i).padStart(4, "0")}.png`), omitBackground: true });
    await page.evaluate(() => window.__step());
  }
  await page.close();
  const out = join(ROOT, "docs", `koi-${theme}.gif`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", "1000/80", "-i", join(dir, "f%04d.png"), "-vf",
    "split[a][b];[a]palettegen=max_colors=16:reserve_transparent=1:stats_mode=diff[p];[b][p]paletteuse=alpha_threshold=128:dither=none:diff_mode=rectangle", "-loop", "0", out]);
  console.log("wrote", out);
}
await browser.close();
server.close();
