// Development: compiles the main process, starts Vite for the window (hot reload), then launches Electron on it.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';

execSync('npx tsc -p tsconfig.node.json', { stdio: 'inherit' });
const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`[dev] window served at ${url}`);

const app = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
app.on('exit', async (code) => { await server.close(); process.exit(code ?? 0); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.kill(sig));
