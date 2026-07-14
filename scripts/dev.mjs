/* Zero-dependency replacement for `concurrently`: runs the API server and the
   Vite client dev server in one terminal, prefixing each output line. Works
   with or without npm workspaces (each process runs in its own package dir),
   on macOS and Windows. Ctrl-C stops both. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const useColor = process.stdout.isTTY;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

const specs = [
  { name: 'server', color: '34', cwd: path.join(ROOT, 'server') },
  { name: 'client', color: '33', cwd: path.join(ROOT, 'client') },
];

const children = [];
let exiting = false;

function shutdown(code) {
  if (exiting) return;
  exiting = true;
  for (const c of children) c.kill();
  process.exitCode = code;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

for (const s of specs) {
  const child = spawn('npm', ['run', 'dev'], {
    cwd: s.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32', // npm is npm.cmd on Windows
  });
  children.push(child);

  const label = paint(s.color, `[${s.name}]`);
  const forward = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) out.write(`${label} ${line}\n`);
    });
    stream.on('end', () => { if (buf) out.write(`${label} ${buf}\n`); });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  child.on('exit', (code) => {
    if (!exiting) {
      console.log(`${label} exited with code ${code ?? 0} — stopping the other process.`);
      shutdown(code ?? 0);
    }
  });
}
