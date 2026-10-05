import { createServer } from 'node:https';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.MCP_PORT ?? 8443);
const outputDir = resolve(process.env.MCP_OUTPUT_DIR ?? join(here, '../../outputs/dependency-briefings'));
const certDir = join(here, 'certs');
const FETCH_MS = 15000;

const str = { type: 'string' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const arr = { type: 'array' };
const shape = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });

const getJson = async (url, init) => {
  const response = await fetch(url, { ...init, headers: { accept: 'application/json', 'user-agent': 'threadline-e2e-mcp', ...init?.headers }, signal: AbortSignal.timeout(FETCH_MS) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`);
  return response.json();
};

const tools = {
  npm_package_info: {
    description: 'Read public npm registry metadata and last-week downloads for one package.',
    inputSchema: shape({ package: str }),
    outputSchema: shape({ name: str, latestVersion: str, description: str, license: str, maintainers: num, lastPublished: str, weeklyDownloads: num, repository: str }),
    run: async ({ package: name }) => {
      if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u.test(name)) throw new Error('invalid package name');
      const meta = await getJson(`https://registry.npmjs.org/${name.replace('/', '%2F')}`);
      const latest = meta['dist-tags']?.latest ?? '';
      const downloads = await getJson(`https://api.npmjs.org/downloads/point/last-week/${name}`).catch(() => ({ downloads: 0 }));
      const repository = typeof meta.repository === 'string' ? meta.repository : meta.repository?.url ?? '';
      return { name: meta.name, latestVersion: latest, description: String(meta.description ?? ''), license: typeof meta.license === 'string' ? meta.license : 'unknown', maintainers: (meta.maintainers ?? []).length, lastPublished: meta.time?.[latest] ?? '', weeklyDownloads: downloads.downloads ?? 0, repository };
    },
  },
  github_repo_stats: {
    description: 'Read public GitHub repository health signals from an owner/name pair.',
    inputSchema: shape({ repository: str }),
    outputSchema: shape({ fullName: str, stars: num, forks: num, openIssues: num, lastPush: str, archived: bool, license: str }),
    run: async ({ repository }) => {
      const match = /([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[#/?].*)?$/u.exec(repository.replace(/^git\+/u, ''));
      if (!match) throw new Error('repository must contain owner/name');
      const data = await getJson(`https://api.github.com/repos/${match[1]}/${match[2]}`);
      return { fullName: data.full_name, stars: data.stargazers_count, forks: data.forks_count, openIssues: data.open_issues_count, lastPush: data.pushed_at, archived: Boolean(data.archived), license: data.license?.spdx_id ?? 'none' };
    },
  },
  osv_advisories: {
    description: 'List known security advisories for an npm package from the public OSV database.',
    inputSchema: shape({ package: str }),
    outputSchema: shape({ package: str, advisoryCount: num, advisoryIds: arr, summaries: arr }),
    run: async ({ package: name }) => {
      const data = await getJson('https://api.osv.dev/v1/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ package: { name, ecosystem: 'npm' } }) });
      const vulns = data.vulns ?? [];
      return { package: name, advisoryCount: vulns.length, advisoryIds: vulns.slice(0, 10).map((item) => item.id), summaries: vulns.slice(0, 5).map((item) => String(item.summary ?? '').slice(0, 160)) };
    },
  },
  write_report: {
    description: 'Write the final markdown due-diligence briefing to a file on the server and return its path and checksum.',
    inputSchema: shape({ title: str, body: str }),
    outputSchema: shape({ path: str, bytes: num, sha256: str }),
    run: async ({ title, body }) => {
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 60) || 'briefing';
      const content = `# ${title}\n\n${body}\n`;
      await mkdir(outputDir, { recursive: true });
      const path = join(outputDir, `${slug}-${new Date().toISOString().replace(/[:.]/gu, '-')}.md`);
      await writeFile(path, content, 'utf8');
      return { path, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') };
    },
  },
};

const listing = () => Object.entries(tools).map(([name, tool]) => ({ name, description: tool.description, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema }));
const reply = (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };

const handle = async (message) => {
  const { id, method, params } = message;
  if (method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dependency-briefing-mcp', version: '1.0.0' } } };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: listing() } };
  if (method === 'tools/call') {
    const tool = tools[params?.name];
    if (!tool) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown tool' } };
    try {
      const structuredContent = await tool.run(params.arguments ?? {});
      console.log(JSON.stringify({ at: new Date().toISOString(), tool: params.name, ok: true }));
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent } };
    } catch (error) {
      console.log(JSON.stringify({ at: new Date().toISOString(), tool: params.name, ok: false, error: error.message }));
      return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: error.message }] } };
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } };
};

const [key, cert] = await Promise.all([readFile(join(certDir, 'key.pem')), readFile(join(certDir, 'cert.pem'))]);
createServer({ key, cert }, (request, response) => {
  if (request.url === '/health') return reply(response, 200, { ok: true });
  if (request.method !== 'POST' || request.url !== '/mcp') return reply(response, 404, { error: 'not found' });
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    let message;
    try { message = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(response, 400, { error: 'invalid json' }); }
    handle(message).then((result) => reply(response, 200, result)).catch((error) => reply(response, 500, { jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: error.message } }));
  });
}).listen(port, '127.0.0.1', () => console.log(`MCP server (no auth) on https://localhost:${port}/mcp, output ${outputDir}`));
