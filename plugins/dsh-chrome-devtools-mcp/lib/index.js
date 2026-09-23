import path from 'node:path'
import { fileURLToPath } from 'node:url'
const dshRoot = path.resolve(path.dirname(process.execPath), '..')
const mcpClientUrl = new URL('file://' + dshRoot + '/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js')
const { apply: applyMcpClient, inject } = await import(mcpClientUrl)

export const name = 'dsh-chrome-devtools-mcp'
export { inject }
const here = path.dirname(fileURLToPath(import.meta.url))
const defaultNpx = path.join(path.dirname(process.execPath), 'npx')
function config() {
  const version = process.env.DSH_CHROME_DEVTOOLS_MCP_VERSION || '1.9.0'
  const browserUrl = process.env.DSH_CHROME_DEVTOOLS_BROWSER_URL
  const userDataDir = process.env.DSH_CHROME_DEVTOOLS_USER_DATA_DIR || path.join(process.env.HOME || '', '.config', 'google-chrome')
  const profileDirectory = process.env.DSH_CHROME_DEVTOOLS_PROFILE_DIRECTORY || 'Profile 2'
  const args = ['-y', 'chrome-devtools-mcp@' + version, '--no-usage-statistics', '--no-performance-crux']
  if (browserUrl) args.push('--browser-url=' + browserUrl)
  else { args.push('--userDataDir=' + userDataDir, '--chromeArg=--profile-directory=' + profileDirectory) }
  // Extra raw Chrome flags via DSH_CHROME_DEVTOOLS_CHROME_ARGS (whitespace-separated,
  // single flag only, no values with spaces). Each becomes its own --chromeArg=.
  for (const extra of (process.env.DSH_CHROME_DEVTOOLS_CHROME_ARGS || '').split(/\s+/).filter(Boolean)) args.push('--chromeArg=' + extra)
  return { transport: 'stdio', serverName: 'chrome-devtools', command: process.env.DSH_CHROME_DEVTOOLS_MCP_COMMAND || defaultNpx, args, cwd: process.env.DSH_CHROME_DEVTOOLS_MCP_CWD || path.resolve(here, '..'), env: {}, toolCallTimeoutMs: 120000, failOnStartupError: false, reconnect: { enabled: true, initialDelayMs: 1000, maxDelayMs: 30000, maxAttempts: 5 } }
}
export async function apply(ctx) { return applyMcpClient(ctx, config()) }
