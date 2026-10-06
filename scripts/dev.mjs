import { spawn } from 'node:child_process';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(npm, ['run', 'api'], { stdio: 'inherit' }),
  spawn(npm, ['exec', 'vite'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', code => stop(code ?? 1));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
