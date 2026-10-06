import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { defineTool } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';

export const name = 'dsh-morpheusx-research';
export const inject = ['tools'];

export const Config = Schema.object({
  cdpEndpoint: Schema.string().default(''),
  candidatePorts: Schema.array(Schema.number()).default([9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230]),
  outputDirectory: Schema.string().default('morpheusx-results'),
  maxPages: Schema.number().default(3),
  resultsPerPage: Schema.number().default(10),
  maxConcurrency: Schema.number().default(6),
  maxSourceCharacters: Schema.number().default(30000),
  maxReturnedCharacters: Schema.number().default(50000),
  blockedDomains: Schema.array(Schema.string()).default(['instagram.com', 'facebook.com']),
  pageLoadTimeoutMs: Schema.number().default(35000),
});

const MEDIA_TYPES = new Set(['image', 'media', 'font', 'manifest', 'texttrack']);
const GOOGLE_CHALLENGE = /unusual traffic|not a robot|captcha|\/sorry\//i;

function normalizeUrl(raw) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.toString();
  } catch {
    return null;
  }
}

function isBlocked(url, blockedDomains) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  return blockedDomains.some((domain) => {
    const suffix = domain.toLowerCase().replace(/^www\./, '').replace(/^\./, '');
    return host === suffix || host.endsWith(`.${suffix}`);
  });
}

function localBase(endpoint) {
  const url = new URL(endpoint);
  const host = url.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error('CDP endpoint must use localhost (127.0.0.1, localhost, or ::1).');
  }
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('CDP endpoint must be a local origin such as http://127.0.0.1:9222.');
  }
  return `${url.protocol}//${url.host}`;
}

function processCdpCandidates() {
  let rows = [];
  try {
    if (process.platform === 'win32') {
      const raw = execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | Where-Object { $_.Name -match "^(chrome|chromium|msedge)(\.exe)?$" } | Select-Object -Property Name,CommandLine | ConvertTo-Json -Compress',
      ], { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const parsed = JSON.parse(raw || '[]');
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } else {
      const raw = execFileSync('ps', ['-axo', 'command='], {
        encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
      });
      rows = raw.split(/\r?\n/).map((CommandLine) => ({ CommandLine }));
    }
  } catch {
    return [];
  }

  const found = [];
  for (const row of rows) {
    const command = row.CommandLine || '';
    if (!/(?:chrome|chromium|msedge|thorium)/i.test(`${row.Name || ''} ${command}`)) continue;
    const address = command.match(/--remote-debugging-address(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/i);
    const host = (address?.[1] || address?.[2] || address?.[3] || '127.0.0.1').toLowerCase();
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) continue;
    const port = command.match(/--remote-debugging-port(?:=|\s+)(?:"(\d+)"|'(\d+)'|(\d+))/i);
    if (port) {
      const value = Number(port[1] || port[2] || port[3]);
      if (value > 0 && value < 65536) found.push(`http://${host.includes(':') ? `[${host}]` : host}:${value}`);
    }
    if (port && Number(port[1] || port[2] || port[3]) === 0) {
      const profile = command.match(/--user-data-dir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/i);
      const profilePath = profile?.[1] || profile?.[2] || profile?.[3];
      if (profilePath) {
        try {
          const activePortFile = path.join(profilePath, 'DevToolsActivePort');
          const portValue = Number(readFileSync(activePortFile, 'utf8').split(/\r?\n/)[0]);
          if (portValue > 0 && portValue < 65536) found.push(`http://${host.includes(':') ? `[${host}]` : host}:${portValue}`);
        } catch { /* The browser may not expose a dynamic port file. */ }
      }
    }
  }
  return found;
}

async function endpointResponds(base) {
  try {
    const response = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(1400) });
    if (!response.ok) return false;
    const metadata = await response.json();
    return typeof metadata.webSocketDebuggerUrl === 'string' && /chrome|chromium|edge/i.test(metadata.Browser || '');
  } catch {
    return false;
  }
}

async function discoverCdp(config) {
  const candidates = [];
  if (config.cdpEndpoint.trim()) candidates.push(localBase(config.cdpEndpoint.trim()));
  candidates.push(...processCdpCandidates());
  for (const port of config.candidatePorts) {
    if (Number.isInteger(port) && port > 0 && port < 65536) candidates.push(`http://127.0.0.1:${port}`);
  }
  const unique = [...new Set(candidates)];
  for (const endpoint of unique) {
    if (await endpointResponds(endpoint)) return endpoint;
  }
  throw new Error('No live local Chrome/Chromium CDP endpoint was found. Keep a CDP-enabled browser open, or set cdpEndpoint to its localhost URL. This plugin never launches or installs a browser.');
}

async function attach(config) {
  const endpoint = await discoverCdp(config);
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 8000 });
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close();
    throw new Error(`Connected to ${endpoint}, but Chrome did not expose a browser context.`);
  }
  return { browser, context, endpoint };
}

async function extractRenderedText(page) {
  return page.evaluate(() => {
    const title = document.title || '';
    const root = document.querySelector('main, article') || document.body;
    const clone = root?.cloneNode(true);
    if (!clone) return { title, text: '' };
    clone.querySelectorAll('script,style,noscript,template,svg,nav,header,footer,aside,form').forEach((el) => el.remove());
    const text = (clone.innerText || clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    return { title, text };
  });
}

async function openWorkPage(context, config) {
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    if (MEDIA_TYPES.has(route.request().resourceType())) return route.abort();
    return route.continue();
  });
  page.setDefaultNavigationTimeout(config.pageLoadTimeoutMs);
  return page;
}

async function searchGoogle(context, query, pageNumber, config) {
  const page = await openWorkPage(context, config);
  try {
    const start = (pageNumber - 1) * config.resultsPerPage;
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&start=${start}&num=${config.resultsPerPage}&filter=0`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 6000);
    if (GOOGLE_CHALLENGE.test(`${page.url()}\n${body}`)) {
      throw new Error('Google displayed a CAPTCHA or anti-automation challenge. Solve it in the visible Chrome window, then retry the search.');
    }
    const rows = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => ({
      href: anchor.href,
      title: (anchor.innerText || anchor.textContent || '').replace(/\s+/g, ' ').trim(),
    })));
    const unique = new Map();
    for (const row of rows) {
      let href = row.href;
      try {
        const parsed = new URL(href);
        if (parsed.pathname === '/url') href = parsed.searchParams.get('q') || href;
      } catch { /* Ignore malformed result links below. */ }
      const normalized = normalizeUrl(href);
      if (!normalized || !row.title || /(^|\.)google\./i.test(new URL(normalized).hostname)) continue;
      if (!unique.has(normalized)) unique.set(normalized, row.title);
    }
    return [...unique.entries()].map(([url, title]) => ({ url, title }));
  } finally {
    await page.close().catch(() => {});
  }
}

async function fetchSource(context, url, config) {
  const page = await openWorkPage(context, config);
  const result = { url, title: '', domain: new URL(url).hostname, status: 'FAILED', content: '', error: '' };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    const extracted = await extractRenderedText(page);
    if (!extracted.text) throw new Error('Page contained no readable text.');
    result.title = extracted.title;
    result.content = extracted.text.slice(0, config.maxSourceCharacters);
    result.url = normalizeUrl(page.url()) || url;
    result.domain = new URL(result.url).hostname;
    result.status = 'SUCCESS';
  } catch (error) {
    result.error = `${error?.name || 'Error'}: ${error?.message || String(error)}`;
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function safeQueryName(query) {
  return query.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 100) || 'query';
}

async function writeResults(config, query, endpoint, sources) {
  const root = path.resolve(config.outputDirectory);
  const directory = path.join(root, safeQueryName(query));
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(directory, { recursive: true });
  const lines = [
    '# MorpheusX Research Results', '', `Query: ${query}`, `Generated: ${new Date().toISOString()}`,
    `CDP endpoint: ${endpoint}`, `Sources: ${sources.length}`, '',
  ];
  for (const [index, source] of sources.entries()) {
    lines.push(`## Source ${index + 1}: ${source.title || source.url}`, '', `URL: ${source.url}`, `Domain: ${source.domain}`, `Status: ${source.status}`, '');
    lines.push(source.status === 'SUCCESS' ? source.content : `Error: ${source.error}`, '', '---', '');
  }
  const resultsPath = path.join(directory, 'results.md');
  await writeFile(resultsPath, lines.join('\n'), 'utf8');
  await writeFile(path.join(directory, 'sources.json'), JSON.stringify(sources, null, 2), 'utf8');
  return resultsPath;
}

async function runResearch(args, config) {
  const { browser, context, endpoint } = await attach(config);
  try {
    const pages = Math.min(Math.max(1, args.pages ?? config.maxPages), 10);
    const discovered = new Map();
    for (let page = 1; page <= pages; page++) {
      const rows = await searchGoogle(context, args.query, page, config);
      for (const row of rows) {
        if (!isBlocked(row.url, config.blockedDomains) && !discovered.has(row.url)) discovered.set(row.url, row.title);
      }
    }
    const entries = [...discovered.entries()].slice(0, Math.max(1, pages * config.resultsPerPage));
    const fetched = await mapLimit(entries, Math.max(1, Math.min(config.maxConcurrency, 12)), async ([url, title]) => {
      const source = await fetchSource(context, url, config);
      if (!source.title) source.title = title;
      return source;
    });
    const resultsPath = await writeResults(config, args.query, endpoint, fetched);
    let budget = config.maxReturnedCharacters;
    const readable = fetched.map((source) => {
      if (source.status !== 'SUCCESS') return { title: source.title, url: source.url, status: source.status, error: source.error };
      const content = source.content.slice(0, Math.max(0, budget));
      budget -= content.length;
      return { title: source.title, url: source.url, status: source.status, content };
    });
    const successful = fetched.filter((source) => source.status === 'SUCCESS').length;
    return {
      query: args.query,
      cdpEndpoint: endpoint,
      discovered: entries.length,
      successful,
      failed: fetched.length - successful,
      savedResults: resultsPath,
      sources: readable,
    };
  } finally {
    // Only disconnect from CDP; do not close the user's Chrome process, context, or pre-existing tabs.
    await browser.close().catch(() => {});
  }
}

export function apply(ctx, config) {
  ctx.tools.register(defineTool({
    name: 'morpheusx_research',
    description: 'Search the web in the user’s existing CDP-enabled Chrome, read source pages in temporary tabs, and save the complete results in the configured output folder. Does not start Chrome or close existing tabs.',
    parameters: {
      query: { type: 'string', required: true, description: 'A focused web search query.' },
      pages: { type: 'number', required: false, description: 'Search pages to read, from 1 to 10.' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      if (!args.query?.trim()) throw new Error('query must not be empty.');
      return runResearch({ ...args, query: args.query.trim() }, config);
    },
  }));
}

