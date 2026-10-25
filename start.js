import { spawn, execSync } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_DIR = path.join(__dirname, 'server');
const CLIENT_DIR = path.join(__dirname, 'client');

// Terminal colors
const C_RESET = '\x1b[0m';
const C_CYAN = '\x1b[36m';
const C_MAGENTA = '\x1b[35m';
const C_GREEN = '\x1b[32m';
const C_YELLOW = '\x1b[33m';
const C_RED = '\x1b[31m';

const log = (prefix, color, message) => {
  console.log(`${color}${prefix}${C_RESET} ${message}`);
};

/**
 * Check if a TCP port is open
 */
function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * Ensure PostgreSQL is running on port 5432
 */
async function ensurePostgres() {
  const isRunning = await isPortOpen(5432);
  if (isRunning) {
    log('[freeroom]', C_GREEN, 'PostgreSQL is running on port 5432.');
    return;
  }

  log('[freeroom]', C_YELLOW, 'PostgreSQL not detected on port 5432. Starting...');
  try {
    execSync('net start postgresql-x64-18', { stdio: 'ignore' });
  } catch {
    const pgCtl = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_ctl.exe';
    const pgData = 'C:\\Program Files\\PostgreSQL\\18\\data';
    if (fs.existsSync(pgCtl)) {
      try {
        execSync(`"${pgCtl}" start -D "${pgData}"`, { stdio: 'ignore' });
      } catch {}
    }
  }

  // Poll for up to 8 seconds
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isPortOpen(5432)) {
      log('[freeroom]', C_GREEN, 'PostgreSQL started successfully.');
      return;
    }
  }
  log('[freeroom]', C_YELLOW, 'Warning: PostgreSQL could not be confirmed on port 5432.');
}

/**
 * Pipe process stream with colored prefix
 */
function pipeOutput(stream, prefix, color) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop(); // keep remainder
    for (const line of lines) {
      if (line.trim().length > 0) {
        log(prefix, color, line);
      }
    }
  });
  stream.on('end', () => {
    if (buffer.trim().length > 0) {
      log(prefix, color, buffer);
    }
  });
}

/**
 * Forcefully kill child process tree on Windows/Unix
 */
function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {}
}

/**
 * Kill any lingering processes on specific ports
 */
function freePorts(ports) {
  if (process.platform !== 'win32') return;
  for (const port of ports) {
    try {
      const out = execSync(`netstat -ano | findstr /C:":${port} "`, { encoding: 'utf8' });
      const lines = out.trim().split(/\r?\n/);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && pid !== String(process.pid)) {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        }
      }
    } catch {}
  }
}

let serverProc = null;
let clientProc = null;
let isShuttingDown = false;

function cleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('');
  log('[freeroom]', C_RED, 'Shutting down FreeRoom...');

  if (serverProc?.pid) killTree(serverProc.pid);
  if (clientProc?.pid) killTree(clientProc.pid);

  freePorts([5000, 5173]);
  log('[freeroom]', C_GREEN, 'All services stopped cleanly.');
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

async function main() {
  console.log('====================================================');
  console.log('          Starting FreeRoom Application');
  console.log('====================================================\n');

  // Ensure ports 5000 and 5173 are free from previous runs
  freePorts([5000, 5173]);

  // Check / start database
  await ensurePostgres();

  // Start Server
  log('[freeroom]', C_GREEN, 'Launching Backend (port 5000)...');
  serverProc = spawn('npm', ['run', 'dev'], {
    cwd: SERVER_DIR,
    shell: true,
  });
  pipeOutput(serverProc.stdout, '[server]', C_CYAN);
  pipeOutput(serverProc.stderr, '[server]', C_CYAN);

  serverProc.on('exit', (code) => {
    if (!isShuttingDown && code !== 0) {
      log('[server]', C_RED, `Backend exited with code ${code}`);
    }
  });

  // Start Client
  log('[freeroom]', C_GREEN, 'Launching Frontend (port 5173)...');
  clientProc = spawn('npm', ['run', 'dev'], {
    cwd: CLIENT_DIR,
    shell: true,
  });
  pipeOutput(clientProc.stdout, '[client]', C_MAGENTA);
  pipeOutput(clientProc.stderr, '[client]', C_MAGENTA);

  clientProc.on('exit', (code) => {
    if (!isShuttingDown && code !== 0) {
      log('[client]', C_RED, `Frontend exited with code ${code}`);
    }
  });

  console.log('\n----------------------------------------------------');
  log('[freeroom]', C_GREEN, 'Application is running!');
  log('[freeroom]', C_CYAN, 'Backend:  http://localhost:5000');
  log('[freeroom]', C_MAGENTA, 'Frontend: http://localhost:5173');
  log('[freeroom]', C_YELLOW, 'Press Ctrl+C at any time to stop everything.');
  console.log('----------------------------------------------------\n');

  // Auto-open browser after 2.5 seconds
  setTimeout(() => {
    if (!isShuttingDown && process.platform === 'win32') {
      try {
        execSync('start http://localhost:5173', { stdio: 'ignore' });
      } catch {}
    }
  }, 2500);
}

main().catch((err) => {
  log('[freeroom]', C_RED, `Fatal error: ${err.message}`);
  cleanup();
});
