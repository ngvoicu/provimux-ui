// provimux-ui browser check (.github/provimux/SYNC.md, "Promotion"), run by the "smoke"
// job of provimux-ui-release.yml after release-check.sh, before the "promote" job makes
// a release the latest. Node.js 22+ and Chrome or Chromium; no npm package.
//
//   node smoke.mjs <management.html> [<version>]
//
// Serves the file at http://127.0.0.1:<port>/management.html next to a small stub of the
// management API (every /v8/management/... request gets 401, as with a wrong key), opens
// it in headless Chrome over the DevTools protocol and checks:
//   - the login page renders: the title "Provimux by providers.dev", a password field
//     and a submit button in a form;
//   - signing in with a throwaway key reaches the stub's /v8/management/ with that key
//     as a bearer token, and the page stays on the login page with an error shown;
//   - nothing leaves the stub, for the WHOLE browser process (every page, worker and
//     WebSocket, and the browser's own traffic): Chrome runs with the stub as its only
//     proxy (--proxy-server, loopback not bypassed, every host name unresolvable except
//     the stub, WebRTC kept off non-proxied UDP); the stub serves only requests for its
//     own origin and refuses and counts every other request, CONNECT tunnel and upgrade;
//     any such attempt fails the check. The page's own requests seen over the DevTools
//     protocol must stay on the stub too (data: and blob: URLs are inline);
//   - no uncaught exception;
//   - with <version>: the page carries it.
// Prints each result; every failure is an ::error line; exit 1 if any check failed.
// Env: CHROME, the browser: chrome-headless-shell (the workflow installs a pinned build
// with @puppeteer/browsers). Not full Chrome: its own Google services (sign-in, network
// time, optimization hints) call out at start and would count as blocked attempts.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [file, version] = process.argv.slice(2);
if (!file) {
  console.error('usage: node smoke.mjs <management.html> [<version>]');
  process.exit(2);
}
const page = readFileSync(file);
const KEY = 'provimux-smoke-key';
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) failures.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the stub, which is also the browser's only proxy ---
const served = [];
const blocked = [];
let origin = '';
// path REQ: the path of a request for the stub (direct, or through the proxy in absolute
// form for the stub's own origin), or null for anything else.
const pathOf = (req) => {
  if (req.url.startsWith('/')) return req.url;
  if (origin && req.url.startsWith(`${origin}/`)) return req.url.slice(origin.length);
  return null;
};
const server = createServer((req, res) => {
  const path = pathOf(req);
  if (path === null) {
    blocked.push(`${req.method} ${req.url}`);
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('blocked by the smoke check');
    return;
  }
  req.url = path;
  served.push({ method: req.method, url: req.url, auth: req.headers.authorization || '' });
  if (req.url === '/management.html' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page);
  } else if (req.url.startsWith('/v8/management/') || req.url.startsWith('/v0/management/')) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{"error":"invalid management key"}');
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});
// Tunnels (https, wss, anything over CONNECT) and upgrades (WebSocket) go nowhere.
server.on('clientError', (err, socket) => socket.destroy());
server.on('connect', (req, socket) => {
  socket.on('error', () => {});
  blocked.push(`CONNECT ${req.url}`);
  socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
});
server.on('upgrade', (req, socket) => {
  socket.on('error', () => {});
  blocked.push(`UPGRADE ${req.url}`);
  socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
origin = `http://127.0.0.1:${server.address().port}`;

// --- the browser ---
const candidates = [process.env.CHROME, 'chrome-headless-shell'].filter(Boolean);
const profile = mkdtempSync(join(tmpdir(), 'provimux-smoke-'));
const args = [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--disable-extensions',
  '--disable-domain-reliability',
  '--disable-client-side-phishing-detection',
  // Chrome's own services, which would call Google: network time, sign-in, component
  // extensions, hints. Whatever still calls out is blocked and fails the check.
  '--disable-features=NetworkTimeServiceQuerying,OptimizationHints,MediaRouter,Translate,AutofillServerCommunication,CertificateTransparencyComponentUpdater,InterestFeedContentSuggestions',
  '--disable-default-apps',
  '--disable-component-extensions-with-background-pages',
  '--bwsi',
  '--disable-search-engine-choice-screen',
  '--metrics-recording-only',
  '--no-pings',
  '--no-sandbox',
  // All traffic of the browser through the stub; nothing bypasses it, not even loopback.
  `--proxy-server=${origin}`,
  '--proxy-bypass-list=<-loopback>',
  '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  'about:blank',
];
let chrome;
let wsUrl;
for (const bin of candidates) {
  if (bin.startsWith('/') && !existsSync(bin)) continue;
  try {
    chrome = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    wsUrl = await new Promise((resolve, reject) => {
      let err = '';
      const t = setTimeout(() => reject(new Error('no DevTools URL within 20s')), 20000);
      chrome.on('error', (e) => { clearTimeout(t); reject(e); });
      chrome.stderr.on('data', (d) => {
        err += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
        if (m) { clearTimeout(t); resolve(m[1]); }
      });
    });
    console.log(`browser: ${bin}`);
    break;
  } catch {
    chrome?.kill('SIGKILL');
    chrome = undefined;
  }
}
const done = (code) => {
  chrome?.kill('SIGKILL');
  server.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may hold it */ }
  process.exit(code);
};
if (!wsUrl) {
  console.log(`::error title=browser check::no chrome-headless-shell could be started (${candidates.join(', ')})`);
  done(1);
}

// --- the DevTools protocol: one page target ---
const port = new URL(wsUrl).port;
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('cannot connect to the page')); });
let seq = 0;
const pending = new Map();
const requests = [];
const exceptions = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Network.requestWillBeSent') {
    requests.push(msg.params.request.url);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    exceptions.push(d.exception?.description?.split('\n')[0] || d.text);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
// waitFor EXPRESSION SECONDS: true once EXPRESSION is truthy.
const waitFor = async (expression, seconds) => {
  for (let i = 0; i < seconds * 4; i++) {
    if (await evaluate(expression).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
};

try {
  await send('Network.enable');
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `${origin}/management.html` });

  const form = `(() => { const f = document.querySelector('form');
    return !!(f && f.querySelector('input[type="password"]') && f.querySelector('button[type="submit"]')); })()`;
  check(await waitFor(form, 30), 'the login page renders: a form with a password field and a submit button');
  check((await evaluate('document.title')) === 'Provimux by providers.dev', `the title is "Provimux by providers.dev" (${await evaluate('document.title')})`);
  if (version) {
    check(page.includes(`"${version}"`) || page.includes(`\`${version}\``), `the page carries its version ${version}`);
  }

  // Sign in with a throwaway key: a React-controlled input takes the value through the
  // native setter and an input event.
  await evaluate(`(() => { const i = document.querySelector('form input[type="password"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(KEY)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form button[type="submit"]').click(); return true; })()`);
  const reached = async () => served.some((s) => s.url.startsWith('/v8/management/') && s.auth === `Bearer ${KEY}`);
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) { ok = await reached(); if (!ok) await sleep(250); }
  check(ok, 'signing in reaches the stub management API (/v8/management/) with the key as a bearer token');
  await sleep(2000);
  check(await waitFor(form, 5), 'after the stub refuses the key the login page is still shown');
  const shown = await evaluate(`(() => { const r = document.querySelector('[role="alert"]');
    return !!(r && r.textContent.trim()); })()`);
  check(shown, 'the refused sign-in shows an error');

  // Everything the page asked for, including after the sign-in.
  await sleep(1000);
  const outside = requests.filter((u) => !u.startsWith(`${origin}/`) && !u.startsWith('data:') && !u.startsWith('blob:'));
  check(outside.length === 0, `no request leaves 127.0.0.1 (${requests.length} requests${outside.length ? `; outside: ${[...new Set(outside)].slice(0, 5).join(' ')}` : ''})`);
  check(blocked.length === 0, `the browser tried nothing outside the stub (${blocked.length} blocked attempts${blocked.length ? `: ${[...new Set(blocked)].slice(0, 8).join(' ')}` : ''})`);
  check(exceptions.length === 0, `no uncaught exception${exceptions.length ? ` (${exceptions.slice(0, 3).join('; ')})` : ''}`);
  console.log(`stub requests: ${served.map((s) => `${s.method} ${s.url}`).join(', ')}`);
} catch (e) {
  check(false, `the browser check ran to its end (${e.message})`);
}
for (const f of failures) console.log(`::error title=browser check::${f}`);
ws.close();
done(failures.length ? 1 : 0);
