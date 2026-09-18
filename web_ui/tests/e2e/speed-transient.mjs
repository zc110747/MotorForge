#!/usr/bin/env node
/**
 * MotorForge headless UI verification: is the speed transient actually VISIBLE?
 *
 * The reported symptom was "真实速度显示不符合预期" - the real speed trace did not
 * look like what the controller was doing. Root cause: with the SPEED window
 * locked to 0..1100 rpm, a resistive load step only moves the shaft ~1-2 rad/s
 * (~10-19 rpm), i.e. ~1-2 % of the axis. The dip was there but a couple of
 * pixels tall on screen.
 *
 * This script drives the real UI (real clicks, real sliders), then measures the
 * trace directly from the canvas pixels and asserts that the new "偏差 Δ" range
 * turns that invisible wiggle into a full-height excursion. It also cross-checks
 * the on-screen numeric readout against the same expectation.
 *
 * Zero dependencies: Node >= 22 (built-in fetch/WebSocket) + Edge/Chrome.
 * Everything (sim server, static server, browser) is spawned here and torn
 * down again, so it is safe to run from a single command.
 *
 * Usage: node web_ui/tests/e2e/speed-transient.mjs [out.png]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import net from 'node:net';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, '..', '..');   // web_ui/
const REPO = path.resolve(WEB_ROOT, '..');         // repo root
const DIST = path.join(WEB_ROOT, 'dist');
const SIM_EXE = path.join(REPO, 'server', 'build', 'motorforge_server.exe');
const SIM_PORT = Number(process.env.SIM_PORT ?? 18098);
const WEB_PORT = Number(process.env.WEB_PORT ?? 4174);
const DEBUG_PORT = Number(process.env.DEBUG_PORT ?? 9346);
const WIDTH = 1680;
const HEIGHT = 1000;
const OUT = process.argv[2] ?? path.join(REPO, 'docs', 'images', 'speed-transient.png');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push([name, Boolean(ok), detail]);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name.padEnd(46)} ${detail}`);
}

/* ------------------------------------------------------------------ servers */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function serveDist() {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    let file = path.join(DIST, url === '/' ? 'index.html' : url);
    if (!existsSync(file) || !statSync(file).isFile()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(WEB_PORT, '127.0.0.1', () => resolve(server)));
}

async function waitPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.status) return true;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  return false;
}

// The simulation server speaks WebSocket only, so a plain HTTP GET is answered
// with a closed socket instead of a status line. Probe it with a raw TCP
// connect instead of fetch.
function waitTcp(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const sock = net.connect({ host: '127.0.0.1', port }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

/* --------------------------------------------------------------- cdP helper */

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
    socket.addEventListener('message', (event) => {
      const m = JSON.parse(event.data);
      if (m.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(m.params?.exceptionDetails?.text ?? 'exception');
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
        this.consoleErrors.push((m.params.args ?? []).map((a) => a.value ?? a.description).join(' '));
      }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page eval failed: ${JSON.stringify(r.exceptionDetails)}`);
    return r.result?.value;
  }
}

/* --------------------------------------------------------- page-side helpers */

// Injected into the page once; the UI is driven through its real controls.
const HELPERS = `(() => {
  window.__mf = window.__mf || {};
  window.__mf.panel = (t) => Array.from(document.querySelectorAll('.panel'))
    .find((p) => (p.querySelector('.panel-title')?.textContent || '').includes(t));
  window.__mf.btn = (t, label) => Array.from(window.__mf.panel(t).querySelectorAll('button'))
    .find((b) => b.textContent.trim() === label);
  window.__mf.setInput = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // count / vertical extent of the light-blue trace inside the tall speed scope
  window.__mf.trace = () => {
    const c = document.querySelector('.scope-tall canvas');
    if (!c) return null;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    const d = ctx.getImageData(0, 0, w, h).data;
    let minY = Infinity, maxY = -Infinity, n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (Math.abs(d[i] - 56) < 45 && Math.abs(d[i + 1] - 189) < 45 && Math.abs(d[i + 2] - 248) < 45) {
          n++; if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    return { w, h, span: n ? maxY - minY : 0, pixels: n };
  };
  window.__mf.readout = () => {
    const box = document.querySelector('.scope-tall .pid-live');
    if (!box) return null;
    return Array.from(box.querySelectorAll('b')).map((b) => b.textContent.trim());
  };
  return true;
})()`;

async function main() {
  if (!existsSync(SIM_EXE)) throw new Error(`missing ${SIM_EXE}; run server/build.bat first`);
  if (!existsSync(path.join(DIST, 'index.html'))) {
    throw new Error(`missing web_ui/dist; run "npm run build" in web_ui first`);
  }

  const sim = spawn(SIM_EXE, ['--port', String(SIM_PORT)], {
    cwd: path.join(REPO, 'server'), stdio: 'ignore',
  });
  const web = await serveDist();
  const browserPath = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].find((p) => existsSync(p));
  if (!browserPath) throw new Error('no Edge/Chrome found');

  let child, socket;
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'motorforge-e2e-'));
  try {
    if (!(await waitTcp(SIM_PORT))) throw new Error('simulation server did not start');
    console.log(`sim  server : ws://127.0.0.1:${SIM_PORT}/ws`);
    console.log(`web  server : http://127.0.0.1:${WEB_PORT}/`);
    console.log(`browser     : ${browserPath}\n`);

    child = spawn(browserPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--no-first-run', '--no-default-browser-check',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', `--window-size=${WIDTH},${HEIGHT}`,
      `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${DEBUG_PORT}`,
      `http://127.0.0.1:${WEB_PORT}/`,
    ], { stdio: 'ignore' });

    let page = null;
    for (let i = 0; i < 120 && !page; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
        page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      } catch { /* retry */ }
      if (!page) await sleep(250);
    }
    if (!page) throw new Error('devtools endpoint never came up');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      socket.addEventListener('open', res, { once: true });
      socket.addEventListener('error', () => rej(new Error('CDP websocket failed')), { once: true });
    });
    const cdp = new Cdp(socket);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
    });

    // --- wait for the app shell, then for the WebSocket to actually connect ---
    let shell = false;
    for (let i = 0; i < 80 && !shell; i++) {
      shell = await cdp.evaluate(`Boolean(document.querySelector('.topbar') && document.querySelector('.scope-tall canvas'))`);
      if (!shell) await sleep(250);
    }
    check('A1 app shell rendered', shell, 'topbar + speed scope present');

    let open = false;
    for (let i = 0; i < 80 && !open; i++) {
      open = await cdp.evaluate(`Boolean(document.querySelector('.conn-dot.open'))`);
      if (!open) await sleep(250);
    }
    const host = await cdp.evaluate(`document.querySelector('.conn input.host').value`);
    check('A2 WebSocket connected from the page', open,
      `conn-dot = open, host default "${host}" (derived from window.location.hostname)`);

    await cdp.evaluate(HELPERS);

    // --- drive the real UI: reset -> standard PI preset -> 100 rad/s -> start ---
    await cdp.evaluate(`(() => {
      const ctrl = window.__mf.panel('仿真控制');
      window.__mf.btn('仿真控制', 'Reset').click();
      return true;
    })()`);
    await sleep(400);
    await cdp.evaluate(`(() => {
      window.__mf.btn('速度环 PID', '标准 PI').click();
      return true;
    })()`);
    await sleep(300);
    const gains = await cdp.evaluate(`(() => {
      const p = window.__mf.panel('速度环 PID');
      const i = p.querySelectorAll('input[type=number]');
      return [i[0].value, i[1].value, i[3].value];
    })()`);
    check('A3 PID preset applied (Kp/Ki/torque limit)', gains[0] === '0.05' && gains[1] === '0.5' && Number(gains[2]) > 0.1,
      `Kp=${gains[0]} Ki=${gains[1]} limit=${gains[2]} N*m`);

    await cdp.evaluate(`(() => {
      const ctrl = window.__mf.panel('仿真控制');
      window.__mf.setInput(ctrl.querySelector('.target-row input'), 100);
      window.__mf.btn('仿真控制', 'Start').click();
      return true;
    })()`);

    let actual = 0;
    for (let i = 0; i < 120; i++) {
      actual = await cdp.evaluate(`Number(document.querySelector('.top-readout .v').textContent.replace(/[^0-9.\\-]/g, ''))`);
      if (actual >= 99) break;
      await sleep(300);
    }
    check('A4 headless run reaches the 100 rad/s setpoint', actual >= 99,
      `ACTUAL SPEED readout = ${actual} rad/s`);

    // Flush the spin-up ramp out of the ~12 s sample buffer FIRST, so the
    // global range and the deviation range are compared on the same steady
    // data. Without this the 0 -> 100 rad/s ramp dominates both traces and the
    // comparison proves nothing (the first revision of this script made exactly
    // that mistake and reported an 88 % span for a settled trace).
    console.log('  waiting 16 s so the spin-up ramp leaves the sample buffer ...');
    await sleep(16000);

    // baseline: measure the trace height in the default (global) range
    const pxGlobalBefore = await cdp.evaluate(`window.__mf.trace()`);

    // --- the disturbance: 0.1 N*m resistive load, enabled from the LOAD panel ---
    await cdp.evaluate(`(() => {
      const load = window.__mf.panel('负载控制');
      window.__mf.setInput(load.querySelector('input[type=range]'), 0.1);
      return true;
    })()`);
    await sleep(300);
    await cdp.evaluate(`(() => {
      const load = window.__mf.panel('负载控制');
      const b = Array.from(load.querySelectorAll('button')).find((x) => x.textContent.includes('应用负载'));
      b.click();
      return true;
    })()`);
    await sleep(3600);

    const readout = await cdp.evaluate(`window.__mf.readout()`);
    const devDip = Number(readout[1]);
    const devTail = Number(readout[4]);
    const devRecover = readout[3];
    check('A5 on-screen transient readout reports a real dip',
      devDip <= -5 && devDip >= -40,
      `Δ dip = ${devDip} rpm (${(devDip / 9.5493).toFixed(2)} rad/s)`);
    check('A6 ...and reports recovery to the setpoint', Math.abs(devTail) <= 3 && devRecover !== '未回归',
      `tail mean = ${devTail} rpm, adjustment = ${devRecover}`);

    const pxGlobalAfter = await cdp.evaluate(`window.__mf.trace()`);

    // --- switch the SPEED window to the deviation range and re-measure ---
    await cdp.evaluate(`(() => {
      const seg = document.querySelector('.scope-tall .scope-head .seg');
      const b = Array.from(seg.querySelectorAll('button')).find((x) => x.textContent.trim() === '偏差');
      b.click();
      return true;
    })()`);
    await sleep(900);
    const pxDev = await cdp.evaluate(`window.__mf.trace()`);

    const h = pxGlobalAfter?.h ?? HEIGHT;
    console.log(`\n  trace pixels (canvas ${pxGlobalAfter?.w}x${h}):`);
    console.log(`    global range, settled  : span ${pxGlobalBefore?.span}px`);
    console.log(`    global range, with load: span ${pxGlobalAfter?.span}px`);
    console.log(`    deviation range        : span ${pxDev?.span}px`);
    check('A7 global range cannot show the dip (< 3% of height)',
      pxGlobalAfter.span <= 0.03 * h,
      `span ${pxGlobalAfter.span}px of ${h}px = ${((pxGlobalAfter.span / h) * 100).toFixed(1)}%`);
    check('A8 deviation range makes the dip clearly visible', pxDev.span >= 4 * Math.max(1, pxGlobalAfter.span),
      `span ${pxDev.span}px = ${((pxDev.span / h) * 100).toFixed(1)}% of height (${(pxDev.span / Math.max(1, pxGlobalAfter.span)).toFixed(1)}x the global span)`);

    mkdirSync(path.dirname(OUT), { recursive: true });
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log(`\n  screenshot: ${OUT}`);

    check('A9 no page errors during the run', cdp.consoleErrors.length === 0,
      cdp.consoleErrors.length ? cdp.consoleErrors.slice(0, 3).join(' | ') : 'console clean');
  } finally {
    try { socket?.close(); } catch { /* ignore */ }
    try { child?.kill(); } catch { /* ignore */ }
    try { web.close(); } catch { /* ignore */ }
    try { sim.kill(); } catch { /* ignore */ }
    await sleep(500);
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  const passed = results.filter(([, ok]) => ok).length;
  console.log(`\n===== UI RESULT: ${passed}/${results.length} PASS =====`);
  for (const [name, ok, detail] of results) if (!ok) console.log(`  FAILED: ${name} (${detail})`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(`[ui] error: ${e.message}`);
  process.exit(1);
});
