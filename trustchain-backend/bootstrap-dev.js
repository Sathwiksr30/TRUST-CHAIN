import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const blockchainDir = path.join(repoRoot, 'blockchain');
const envPath = path.join(__dirname, '.env');

const RPC_URL = 'http://127.0.0.1:8545';
const LOCALHOSTS = new Set(['127.0.0.1', 'localhost']);

let hardhatNodeProcess = null;
let shuttingDown = false;

dotenv.config({ path: envPath });

function isLocalRpc(rpcUrl) {
  try {
    const parsed = new URL(rpcUrl);
    return LOCALHOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpcRequest(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
  });

  if (!response.ok) {
    throw new Error(`RPC request failed with status ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || `RPC ${method} failed`);
  }

  return payload.result;
}

async function isRpcReady() {
  try {
    await rpcRequest('eth_chainId');
    return true;
  } catch {
    return false;
  }
}

function startHardhatNode() {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(['hardhat', 'node'], blockchainDir, ['ignore', 'pipe', 'pipe']);

    hardhatNodeProcess = child;
    let settled = false;

    const finishResolve = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    const finishReject = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    const onData = async (chunk) => {
      const text = String(chunk);
      process.stdout.write(`[hardhat] ${text}`);

      if (text.includes('Started HTTP and WebSocket JSON-RPC server') || text.includes('WARNING: Funds sent on live network')) {
        child.stdout.off('data', onData);
        child.stderr.off('data', onErr);
        for (let attempt = 0; attempt < 30; attempt += 1) {
          if (await isRpcReady()) {
            finishResolve();
            return;
          }
          await wait(500);
        }
        finishReject(new Error('Hardhat node started but RPC did not become ready in time'));
      }
    };

    const onErr = async (chunk) => {
      const text = String(chunk);
      process.stderr.write(`[hardhat] ${text}`);

      // Another process may already be binding 8545; if RPC is healthy, continue.
      if (text.includes('EADDRINUSE')) {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (await isRpcReady()) {
            console.log('[bootstrap] RPC already available on 8545. Reusing existing node.');
            finishResolve();
            return;
          }
          await wait(500);
        }
        finishReject(new Error('Port 8545 is in use but no JSON-RPC service became available'));
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onErr);

    child.on('exit', (code) => {
      if (!shuttingDown && code !== 0) {
        finishReject(new Error(`Hardhat node exited unexpectedly with code ${code}`));
      }
    });
  });
}

function spawnCommand(args, cwd, stdio) {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', `npx ${args.join(' ')}`], {
      cwd,
      env: process.env,
      stdio
    });
  }

  return spawn('npx', args, {
    cwd,
    env: process.env,
    stdio
  });
}

function updateEnvValue(key, value) {
  const line = `${key}=${value}`;
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  if (new RegExp(`^${key}=.*$`, 'm').test(content)) {
    content = content.replace(new RegExp(`^${key}=.*$`, 'm'), line);
  } else {
    content = `${content.trim()}\n${line}\n`.trimStart();
  }

  fs.writeFileSync(envPath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
  process.env[key] = value;
}

async function deployContract() {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(['hardhat', 'run', 'scripts/deploy.js', '--network', 'localhost'], blockchainDir, ['ignore', 'pipe', 'pipe']);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(`[deploy] ${text}`);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(`[deploy] ${text}`);
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Contract deployment failed with code ${code}\n${stderr}`));
        return;
      }

      const match = stdout.match(/DigitalWill deployed to:\s*(0x[a-fA-F0-9]{40})/);
      if (!match) {
        reject(new Error('Could not parse deployed contract address from deploy script output'));
        return;
      }

      resolve(match[1]);
    });
  });
}

async function ensureLocalBlockchainReady() {
  if (await isRpcReady()) {
    console.log('[bootstrap] Local blockchain RPC already running.');
    return;
  }

  console.log('[bootstrap] Starting local Hardhat node...');
  await startHardhatNode();
  console.log('[bootstrap] Local Hardhat node is ready.');
}

async function ensureContractDeployment() {
  const configuredAddress = process.env.DIGITAL_WILL_CONTRACT_ADDRESS || '';
  if (ethers.isAddress(configuredAddress)) {
    const provider = new ethers.JsonRpcProvider(RPC_URL, 31337, { staticNetwork: true });
    const code = await provider.getCode(configuredAddress);
    if (code && code !== '0x') {
      console.log(`[bootstrap] Reusing deployed contract at ${configuredAddress}`);
      return configuredAddress;
    }
  }

  console.log('[bootstrap] Deploying DigitalWill contract...');
  const address = await deployContract();
  updateEnvValue('DIGITAL_WILL_CONTRACT_ADDRESS', address);
  console.log(`[bootstrap] Contract deployed and .env updated: ${address}`);
  return address;
}

async function bootstrap() {
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL || RPC_URL;
  if (!isLocalRpc(rpcUrl)) {
    console.log('[bootstrap] Non-local blockchain RPC configured. Starting backend without local blockchain bootstrap.');
    await import('./server.js');
    return;
  }

  await ensureLocalBlockchainReady();
  await ensureContractDeployment();
  await import('./server.js');
}

function shutdownHardhatNode() {
  if (!hardhatNodeProcess || hardhatNodeProcess.killed) {
    return;
  }

  try {
    hardhatNodeProcess.kill('SIGINT');
  } catch {}
}

process.on('SIGINT', () => {
  shuttingDown = true;
  shutdownHardhatNode();
});

process.on('SIGTERM', () => {
  shuttingDown = true;
  shutdownHardhatNode();
});

bootstrap().catch((error) => {
  console.error('[bootstrap] Failed to start local stack:', error);
  shuttingDown = true;
  shutdownHardhatNode();
  process.exit(1);
});
