import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

let heliaNode = null;
let fs = null;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fallbackDir = path.join(__dirname, 'ipfs-fallback-storage');

function ensureFallbackDir() {
  if (!fsSync.existsSync(fallbackDir)) {
    fsSync.mkdirSync(fallbackDir, { recursive: true });
  }
}

function isFallbackCid(cid) {
  return typeof cid === 'string' && cid.startsWith('local-');
}

function fallbackPathForCid(cid) {
  return path.join(fallbackDir, `${cid}.bin`);
}

async function addFileToFallback(fileBuffer) {
  ensureFallbackDir();
  const digest = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  const cid = `local-${digest}`;
  const filePath = fallbackPathForCid(cid);
  if (!fsSync.existsSync(filePath)) {
    fsSync.writeFileSync(filePath, fileBuffer);
  }
  return cid;
}

async function getFileFromFallback(cid) {
  const filePath = fallbackPathForCid(cid);
  if (!fsSync.existsSync(filePath)) {
    throw new Error(`Fallback file not found for CID: ${cid}`);
  }
  return fsSync.readFileSync(filePath);
}

// Initialize Helia (modern IPFS implementation in pure JavaScript)
export async function initIPFS() {
  try {
    console.log('🚀 Starting Helia IPFS node...');

    // Use stable transports only to avoid node-datachannel WebRTC crashes in local dev.
    const libp2p = await createLibp2p({
      transports: [tcp(), webSockets()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      services: {
        identify: identify()
      }
    });

    // Create Helia node (pure JS IPFS)
    heliaNode = await createHelia({ libp2p });
    fs = unixfs(heliaNode);

    heliaNode.libp2p.addEventListener('connection:close', (event) => {
      const reason = event?.detail?.error?.message || event?.detail?.error || '';
      if (String(reason).toLowerCase().includes('datachannel is closed')) {
        console.warn('⚠️  Ignored closed WebRTC data channel event from libp2p peer');
      }
    });
    
    console.log('✅ Helia IPFS node started successfully');
    console.log(`   Peer ID: ${heliaNode.libp2p.peerId.toString()}`);
    console.log(`   📦 Files stored locally - accessible via backend API`);
    
    return { heliaNode, fs };
  } catch (error) {
    console.error('❌ Helia initialization failed:', error.message);
    console.log('⚠️  Continuing without IPFS...');
    return null;
  }
}

// Stop Helia node
export async function stopIPFS() {
  if (heliaNode) {
    console.log('⏹️  Stopping Helia IPFS node...');
    try {
      await heliaNode.stop();
    } catch (error) {
      console.warn('⚠️  Error while stopping Helia node:', error.message);
    }
    console.log('✅ Helia node stopped');
  }
}

// Add file to IPFS
export async function addFile(fileBuffer, fileName) {
  // Always store a redundant local copy for persistence across restarts
  const fallbackCid = await addFileToFallback(fileBuffer);
  
  if (!fs) {
    return fallbackCid;
  }
  
  try {
    const cid = await fs.addBytes(fileBuffer);
    const cidStr = cid.toString();
    
    // Save mapping so we can find it by IPFS CID in the fallback as well
    const mappingPath = path.join(fallbackDir, `${cidStr}.ipfs_map`);
    fsSync.writeFileSync(mappingPath, fallbackCid);
    
    return cidStr;
  } catch (error) {
    console.warn('⚠️  IPFS addBytes failed (falling back to local):', error.message);
    return fallbackCid;
  }
}

// Get file from IPFS
export async function getFile(cid) {
  if (!cid) throw new Error('CID is required');
  
  // 1. Check direct local fallback first
  if (isFallbackCid(cid)) {
    return getFileFromFallback(cid);
  }

  // 2. Check if it's an IPFS CID that we have a local mapping for
  const mappingPath = path.join(fallbackDir, `${cid}.ipfs_map`);
  if (fsSync.existsSync(mappingPath)) {
    const fallbackCid = fsSync.readFileSync(mappingPath, 'utf8').trim();
    try {
      return await getFileFromFallback(fallbackCid);
    } catch {}
  }

  // 3. Try to get from Helia network if available
  if (!fs) {
    throw new Error('IPFS not initialized and CID not found in local fallback storage');
  }
  
  try {
    // Add a timeout to prevent hanging the server on missing records
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const chunks = [];
    try {
      for await (const chunk of fs.cat(cid, { signal: controller.signal })) {
        chunks.push(chunk);
      }
    } finally {
      clearTimeout(timeout);
    }
    
    return Buffer.concat(chunks);
  } catch (error) {
    const isTimeout = error.name === 'AbortError' || error.message?.includes('aborted');
    console.error(`❌ IPFS getFile failed for ${cid}:`, isTimeout ? 'Timeout (10s)' : error.message);
    
    throw error;
  }
}

// Get IPFS instances
export function getIPFS() {
  return { heliaNode, fs };
}

export default {
  init: initIPFS,
  stop: stopIPFS,
  addFile,
  getFile,
  get: getIPFS
};