import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import dotenv from "dotenv";
import ipfs from "./ipfs.js";
import mammoth from "mammoth";
import axios from "axios";
import { ethers } from "ethers";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import CommonJS modules
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');
const FormData = require('form-data');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

// Configuration
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:5002';
const PORT = process.env.PORT || 5000;
const BLOCKCHAIN_RPC_URL = process.env.BLOCKCHAIN_RPC_URL || 'http://127.0.0.1:8545';
const DIGITAL_WILL_CONTRACT_ADDRESS = process.env.DIGITAL_WILL_CONTRACT_ADDRESS || '';
const DIGITAL_WILL_OWNER_PRIVATE_KEY = process.env.DIGITAL_WILL_OWNER_PRIVATE_KEY || '';
const WILL_DEFAULT_RELEASE_DELAY_SECONDS = Number(process.env.WILL_DEFAULT_RELEASE_DELAY_SECONDS || 24 * 60 * 60);
const WILL_DEATH_RELEASE_BUFFER_SECONDS = Number(process.env.WILL_DEATH_RELEASE_BUFFER_SECONDS || 30);
const WILL_AUTO_FUND_ETH = process.env.WILL_AUTO_FUND_ETH || '1';
const WILL_MIN_EXECUTION_FUND_ETH = process.env.WILL_MIN_EXECUTION_FUND_ETH || '1';
const REQUEST_LOG_LEVEL = (process.env.REQUEST_LOG_LEVEL || 'minimal').toLowerCase();

// Email configuration
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = Number(process.env.EMAIL_PORT || 587);
const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || (EMAIL_USER ? `TrustChain <${EMAIL_USER}>` : 'TrustChain <noreply@trustchain.io>');
const MAX_TIMER_DELAY_MS = 2147483647;
const INDIA_TIME_ZONE = 'Asia/Kolkata';
const SUPPORTED_WILL_CONDITIONS = new Set(['Time', 'Age', 'Death', 'Multiple']);

const DIGITAL_WILL_ABI = [
  'error WillAlreadyExists()',
  'error WillNotFound()',
  'error InvalidAddress()',
  'error InvalidInput()',
  'error NotWillOwner()',
  'error NotAuthorized()',
  'error WillRevoked()',
  'error WillAlreadyExecuted()',
  'error ConditionNotMet()',
  'error NoFundsAvailable()',
  'error TransferFailed()',
  'error InvalidShares()',
  'function createWill(string willId, address beneficiary, string cid, uint256 releaseTime)',
  'function setExecutor(string willId, address executor)',
  'function setBeneficiaries(string willId, address[] beneficiaries, uint16[] sharesBps)',
  'function fundWill(string willId) payable',
  'function executeWill(string willId)',
  'function revokeWill(string willId)',
  'function getWill(string willId) view returns (address owner, address executor, string cid, uint256 releaseTime, uint256 fundedAmount, uint16 totalShares, bool executed, bool revoked, uint256 beneficiaryCount)',
  'function getBeneficiaries(string willId) view returns (address[] beneficiaries, uint16[] sharesBps)'
];

// Initialize IPFS (will happen at server start)
let ipfsInstance = null;

const app = express();
app.use(cors());
app.use(express.json());

const willExecutionTimers = new Map();

function getIndiaDateParts(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: INDIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second
  };
}

function toIndiaIsoString(input = new Date()) {
  const p = getIndiaDateParts(input);
  if (!p) return '';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+05:30`;
}

function toIndiaDisplayString(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(date);
}

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Created uploads directory');
}

// Storage file paths
const cidStorageFile = path.join(__dirname, 'cid-storage.json');
const verificationRecordsFile = path.join(__dirname, 'verification-records.json');
const blockchainRecordsFile = path.join(__dirname, 'blockchain-records.json');
const blockchainRecordsArchiveFile = path.join(__dirname, 'blockchain-records-archive.json');
const deathClaimsFile = path.join(__dirname, 'death-claims.json');

function readJsonArraySafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    let content = fs.readFileSync(filePath, 'utf8');
    content = content.replace(/^\uFEFF/, '').trim();

    if (!content) {
      return [];
    }

    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(`[STORAGE] Invalid JSON in ${path.basename(filePath)}. Resetting file.`, error.message);
    fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
    return [];
  }
}

function writeJsonArraySafe(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Initialize storage files
function initializeStorage() {
  [cidStorageFile, verificationRecordsFile, blockchainRecordsFile, blockchainRecordsArchiveFile, deathClaimsFile].forEach(file => {
    if (!fs.existsSync(file)) {
      writeJsonArraySafe(file, []);
      console.log(`✓ Initialized: ${path.basename(file)}`);
      return;
    }

    // Normalize existing files so BOM/encoding artifacts don't break JSON.parse.
    const records = readJsonArraySafe(file);
    writeJsonArraySafe(file, records);
  });
}

initializeStorage();

async function cleanupStaleWillRecordsAgainstChain() {
  const records = readJsonArraySafe(blockchainRecordsFile);
  const latestWillRecords = new Map();

  records
    .filter((record) => record?.type === 'DIGITAL_WILL' && record?.willId)
    .forEach((record) => {
      latestWillRecords.set(record.willId, record);
    });

  if (latestWillRecords.size === 0) {
    return { removed: 0, staleWillIds: [] };
  }

  const willArchiveReasons = new Map();
  for (const [willId, record] of latestWillRecords.entries()) {
    if (record?.schedulerDisabled || /missing revert data/i.test(String(record?.schedulerError || ''))) {
      willArchiveReasons.set(willId, 'disabled legacy schedule record');
    }
  }

  let signerAndContract = null;
  try {
    signerAndContract = await getDigitalWillSignerAndContract();
  } catch {
    return { removed: 0, staleWillIds: [] };
  }

  const staleWillIds = new Set();
  const { contract } = signerAndContract;

  for (const willId of latestWillRecords.keys()) {
    try {
      await contract.getWill(willId);
    } catch (error) {
      const message = formatBlockchainError(error);
      if (/will not found/i.test(message)) {
        staleWillIds.add(willId);
        willArchiveReasons.set(willId, 'stale will from previous blockchain session');
      }
    }
  }

  const willIdsToArchive = new Set([...willArchiveReasons.keys()]);

  if (willIdsToArchive.size === 0) {
    return { removed: 0, staleWillIds: [] };
  }

  const archivedAt = toIndiaIsoString();
  const removedRecords = [];
  const keptRecords = [];

  for (const record of records) {
    const isStaleWillRecord =
      willIdsToArchive.has(record?.willId) &&
      (record?.type === 'DIGITAL_WILL' || record?.type === 'DIGITAL_WILL_EXECUTION');

    if (isStaleWillRecord) {
      removedRecords.push({
        ...record,
        archivedAt,
        archiveReason: willArchiveReasons.get(record?.willId) || 'record cleanup'
      });
      continue;
    }

    keptRecords.push(record);
  }

  if (removedRecords.length > 0) {
    const archiveRecords = readJsonArraySafe(blockchainRecordsArchiveFile);
    archiveRecords.push(...removedRecords);
    writeJsonArraySafe(blockchainRecordsArchiveFile, archiveRecords);
    writeJsonArraySafe(blockchainRecordsFile, keptRecords);
  }

  const deathClaims = readJsonArraySafe(deathClaimsFile);
  const updatedDeathClaims = deathClaims.map((claim) => {
    if (!willIdsToArchive.has(claim?.willId)) return claim;
    return {
      ...claim,
      status: 'STALE_CHAIN_SESSION',
      staleMarkedAt: archivedAt,
      staleReason: 'Will belongs to a previous blockchain session'
    };
  });
  writeJsonArraySafe(deathClaimsFile, updatedDeathClaims);

  return { removed: removedRecords.length, staleWillIds: Array.from(willIdsToArchive) };
}

function flattenEffectiveConditions(conditions) {
  if (!Array.isArray(conditions)) return [];

  const expanded = [];
  for (const condition of conditions) {
    if (!condition || !condition.type) continue;

    if (condition.type === 'Multiple') {
      const nested = Array.isArray(condition.conditions)
        ? condition.conditions
        : Array.isArray(condition?.value?.conditions)
          ? condition.value.conditions
          : Array.isArray(condition.value)
            ? condition.value
            : [];

      for (const subCondition of nested) {
        if (subCondition?.type) {
          expanded.push(subCondition);
        }
      }
      continue;
    }

    expanded.push(condition);
  }

  return expanded;
}

function hasDeathCondition(conditions) {
  return flattenEffectiveConditions(conditions).some((c) => c?.type === 'Death');
}

function createDeathClaimRecord({ willId, metadataCid, executorEmail, beneficiaries, nominees }) {
  const token = crypto.randomBytes(24).toString('hex');
  const claimId = `DTH-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  const claim = {
    claimId,
    token,
    willId,
    metadataCid,
    executorEmail,
    beneficiaries: Array.isArray(beneficiaries) ? beneficiaries : [],
    nominees: Array.isArray(nominees) ? nominees : [],
    status: 'PENDING_CERTIFICATE',
    certificateFileName: null,
    certificateFilePath: null,
    uploadedAt: null,
    approvedAt: null,
    createdAt: toIndiaIsoString()
  };

  const claims = readJsonArraySafe(deathClaimsFile);
  claims.push(claim);
  writeJsonArraySafe(deathClaimsFile, claims);
  return claim;
}

function getDeathClaimByToken(token) {
  if (!token) return null;
  const claims = readJsonArraySafe(deathClaimsFile);
  return claims.find((c) => c?.token === token) || null;
}

function updateDeathClaimByToken(token, updater) {
  const claims = readJsonArraySafe(deathClaimsFile);
  const index = claims.findIndex((c) => c?.token === token);
  if (index < 0) return null;

  const updated = updater(claims[index]);
  claims[index] = updated;
  writeJsonArraySafe(deathClaimsFile, claims);
  return updated;
}

// Function to save CID record
function saveCIDRecord(fileName, cid, documentId, score) {
  try {
    const records = readJsonArraySafe(cidStorageFile);

    // Add new record
    const newRecord = {
      timestamp: toIndiaIsoString(),
      date: toIndiaDisplayString(),
      documentId,
      fileName,
      cid,
      verificationScore: score,
      status: 'VERIFIED'
    };

    records.push(newRecord);

    // Save back to file with pretty formatting
    writeJsonArraySafe(cidStorageFile, records);
    console.log(`[CID STORAGE] ✓ Record saved: ${fileName} → ${cid}`);
    
    return true;
  } catch (error) {
    console.error('[CID STORAGE] ✗ Failed to save record:', error.message);
    return false;
  }
}

// serve uploads statically
app.use('/uploads', express.static(uploadsDir));

// Serve ML verification HTML UI (no auth required)
app.get('/verify.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'verify.html'));
});

// Redirect root to verify page
app.get('/', (req, res) => {
  res.redirect('/verify.html');
});

// ==========================================
// DOCUMENT TEXT EXTRACTION
// ==========================================

// Extract text from DOCX
async function extractTextFromDocx(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch (error) {
    throw new Error(`Failed to read DOCX: ${error.message}`);
  }
}

// Extract text from PDF
async function extractTextFromPdf(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: dataBuffer });
    const data = await parser.getText();
    await parser.destroy();
    return data.text || "";
  } catch (error) {
    throw new Error(`Failed to read PDF: ${error.message}`);
  }
}

// Main extraction function
async function extractDocumentText(filePath, filename) {
  const ext = filename.toLowerCase();
  
  if (ext.endsWith('.pdf')) {
    return await extractTextFromPdf(filePath);
  } else if (ext.endsWith('.docx')) {
    return await extractTextFromDocx(filePath);
  } else {
    throw new Error('Unsupported file type. Only PDF and DOCX are supported.');
  }
}

// ==========================================
// SHA-256 HASH GENERATION
// ==========================================



function generateSHA256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256');
  hash.update(fileBuffer);
  return hash.digest('hex');
}

// ==========================================
// BLOCKCHAIN STORAGE (SIMULATED)
// ==========================================

function storeOnBlockchain(documentData) {
  try {
    const records = readJsonArraySafe(blockchainRecordsFile);
    
    const txHash = '0x' + crypto.randomBytes(32).toString('hex');
    const blockNumber = Math.floor(Math.random() * 1000000) + 1000000;
    
    const blockchainRecord = {
      transactionHash: txHash,
      blockNumber,
      documentId: documentData.documentId,
      cid: documentData.cid,
      sha256Hash: '0x' + documentData.sha256Hash,
      owner: documentData.owner || '0x0000000000000000000000000000000000000000',
      timestamp: documentData.timestamp,
      storedAt: toIndiaIsoString(),
      gasUsed: '21000',
      status: 'confirmed'
    };
    
    records.push(blockchainRecord);
    writeJsonArraySafe(blockchainRecordsFile, records);
    
    console.log(`[BLOCKCHAIN] ✓ Stored: ${documentData.documentId} | TX: ${txHash}`);
    
    return {
      success: true,
      transactionHash: txHash,
      blockNumber,
      ...blockchainRecord
    };
  } catch (error) {
    console.error('[BLOCKCHAIN] ✗ Storage failed:', error.message);
    throw error;
  }
}

// ==========================================
// VERIFICATION RECORD STORAGE
// ==========================================

function saveVerificationRecord(record) {
  try {
    const records = readJsonArraySafe(verificationRecordsFile);
    records.push(record);
    writeJsonArraySafe(verificationRecordsFile, records);
    console.log(`[RECORD] ✓ Verification record saved: ${record.documentId}`);
    return true;
  } catch (error) {
    console.error('[RECORD] ✗ Failed to save:', error.message);
    return false;
  }
}

function parsePositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePositiveWeiOrEth(payload) {
  if (payload?.amountWei !== undefined && payload?.amountWei !== null && String(payload.amountWei).trim() !== '') {
    const value = String(payload.amountWei).trim();
    try {
      const amountWei = BigInt(value);
      return amountWei > 0n ? amountWei : null;
    } catch {
      return null;
    }
  }

  if (payload?.amountEth !== undefined && payload?.amountEth !== null && String(payload.amountEth).trim() !== '') {
    const value = String(payload.amountEth).trim();
    try {
      const amountWei = ethers.parseEther(value);
      return amountWei > 0n ? amountWei : null;
    } catch {
      return null;
    }
  }

  return null;
}

function deriveAutoFundAmountWei(payload) {
  const explicit = parsePositiveWeiOrEth(payload);
  if (explicit) return explicit;

  const fallback = String(WILL_AUTO_FUND_ETH || '').trim();
  if (!fallback) return 0n;

  try {
    const wei = ethers.parseEther(fallback);
    return wei > 0n ? wei : 0n;
  } catch {
    return 0n;
  }
}

function deriveMinimumExecutionFundWei() {
  const configured = String(WILL_MIN_EXECUTION_FUND_ETH || '').trim() || '1';
  try {
    const wei = ethers.parseEther(configured);
    return wei > 0n ? wei : 0n;
  } catch {
    return 0n;
  }
}

function normalizeWalletAddress(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return ethers.getAddress(trimmed);
  } catch {
    return null;
  }
}

function isValidEmail(value) {
  if (!value || typeof value !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function deriveReleaseTime(payload) {
  const effectiveConditions = flattenEffectiveConditions(payload?.conditions);
  const now = Math.floor(Date.now() / 1000);

  // Keep death-condition wills near-immediate, but add a safety buffer so createWill
  // does not revert when block timestamp advances between request handling and mining.
  if (hasDeathCondition(effectiveConditions)) {
    // Increased to 300s (5m) to be safe against clock skew on Sepolia
    return now + 300;
  }

  const direct = parsePositiveNumber(payload?.releaseTime);
  if (direct) return Math.floor(direct);

  const ageConditionReleaseTime = deriveAgeConditionReleaseTime(effectiveConditions);
  if (ageConditionReleaseTime) return ageConditionReleaseTime;

  return now + WILL_DEFAULT_RELEASE_DELAY_SECONDS;
}

function parseDobValue(rawDob) {
  const value = String(rawDob || '').trim();
  if (!value) return null;

  let match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3])
    };
  }

  match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    return {
      year: Number(match[3]),
      month: Number(match[2]),
      day: Number(match[1])
    };
  }

  return null;
}

function deriveAgeConditionReleaseTime(conditions) {
  const effectiveConditions = flattenEffectiveConditions(conditions);
  if (!Array.isArray(effectiveConditions) || effectiveConditions.length === 0) return null;

  const ageCondition = effectiveConditions.find((condition) => condition?.type === 'Age');
  if (!ageCondition) return null;

  const dob = ageCondition?.dob || ageCondition?.value?.dob;
  const targetAgeRaw = ageCondition?.targetAge || ageCondition?.value?.targetAge || ageCondition?.value;
  const targetAge = Number(targetAgeRaw);

  const dobParts = parseDobValue(dob);
  if (!dobParts || !Number.isFinite(targetAge) || targetAge <= 0) {
    return null;
  }

  const triggerYear = dobParts.year + Math.floor(targetAge);
  const triggerIso = `${String(triggerYear).padStart(4, '0')}-${String(dobParts.month).padStart(2, '0')}-${String(dobParts.day).padStart(2, '0')}T00:00:00+05:30`;
  const triggerMs = Date.parse(triggerIso);

  if (Number.isNaN(triggerMs)) {
    return null;
  }

  return Math.floor(triggerMs / 1000);
}

function validateAgeCondition(conditions) {
  const effectiveConditions = flattenEffectiveConditions(conditions);

  if (!Array.isArray(effectiveConditions) || effectiveConditions.length === 0) {
    return { hasAgeCondition: false, releaseTime: null, error: null };
  }

  const ageCondition = effectiveConditions.find((condition) => condition?.type === 'Age');
  if (!ageCondition) {
    return { hasAgeCondition: false, releaseTime: null, error: null };
  }

  const dob = ageCondition?.dob || ageCondition?.value?.dob;
  const currentAgeRaw = ageCondition?.currentAge || ageCondition?.value?.currentAge;
  const targetAgeRaw = ageCondition?.targetAge || ageCondition?.value?.targetAge || ageCondition?.value;

  const parsedDob = parseDobValue(dob);
  const currentAge = Number(currentAgeRaw);
  const targetAge = Number(targetAgeRaw);

  if (!parsedDob) {
    return { hasAgeCondition: true, releaseTime: null, error: 'Age condition requires a valid DOB (YYYY-MM-DD or DD-MM-YYYY).' };
  }

  if (!Number.isFinite(currentAge) || currentAge < 0) {
    return { hasAgeCondition: true, releaseTime: null, error: 'Age condition requires a valid present age.' };
  }

  if (!Number.isFinite(targetAge) || targetAge <= 0) {
    return { hasAgeCondition: true, releaseTime: null, error: 'Age condition requires a valid target age greater than 0.' };
  }

  if (targetAge <= currentAge) {
    return { hasAgeCondition: true, releaseTime: null, error: 'Target age must be greater than present age.' };
  }

  const releaseTime = deriveAgeConditionReleaseTime(effectiveConditions);
  if (!releaseTime) {
    return { hasAgeCondition: true, releaseTime: null, error: 'Could not derive release date from age condition.' };
  }

  return { hasAgeCondition: true, releaseTime, error: null };
}

function toSharesBps(beneficiaries) {
  const valid = beneficiaries
    .map((b) => {
      const sharePct = parsePositiveNumber(b?.share);
      const address = normalizeWalletAddress(b?.walletAddress || b?.address || b?.beneficiaryAddress);
      if (!sharePct || !address) return null;
      return { address, sharePct };
    })
    .filter(Boolean);

  if (valid.length === 0) {
    return { addresses: [], sharesBps: [] };
  }

  const raw = valid.map((b) => Math.round(b.sharePct * 100));
  const total = raw.reduce((sum, n) => sum + n, 0);

  if (total <= 0) {
    return { addresses: [], sharesBps: [] };
  }

  const adjusted = [...raw];
  adjusted[adjusted.length - 1] += 10000 - total;

  const positive = adjusted.every((n) => n > 0);
  const exact = adjusted.reduce((sum, n) => sum + n, 0) === 10000;
  if (!positive || !exact) {
    return { addresses: [], sharesBps: [] };
  }

  return {
    addresses: valid.map((b) => b.address),
    sharesBps: adjusted
  };
}

function formatBeneficiaries(addresses, sharesBps) {
  return addresses.map((address, index) => ({
    address,
    shareBps: Number(sharesBps[index]),
    sharePercent: Number(sharesBps[index]) / 100
  }));
}

function formatWillState(willId, willOnChain, beneficiaries) {
  return {
    willId,
    owner: willOnChain.owner,
    executor: willOnChain.executor,
    metadataCid: willOnChain.cid,
    releaseTime: Number(willOnChain.releaseTime),
    fundedAmountWei: String(willOnChain.fundedAmount),
    fundedAmountEth: ethers.formatEther(willOnChain.fundedAmount),
    totalSharesBps: Number(willOnChain.totalShares),
    beneficiaryCount: Number(willOnChain.beneficiaryCount),
    beneficiaries,
    executed: Boolean(willOnChain.executed),
    revoked: Boolean(willOnChain.revoked)
  };
}

async function getWillState(contract, willId) {
  const willOnChain = await contract.getWill(willId);
  const [addresses, sharesBps] = await contract.getBeneficiaries(willId);
  const beneficiaries = formatBeneficiaries(addresses, sharesBps);
  return formatWillState(willId, willOnChain, beneficiaries);
}

function formatBlockchainError(error) {
  const decodedCustomError = decodeDigitalWillCustomError(error);
  if (decodedCustomError) return decodedCustomError;

  const fallback = error?.shortMessage || error?.reason || error?.message || 'Blockchain transaction failed';
  if (/missing revert data/i.test(String(fallback))) {
    return 'Blockchain reverted without reason (often: will not found on current chain, not funded, already executed/revoked, or condition not met).';
  }
  return fallback;
}

function mapDigitalWillErrorName(errorName) {
  const map = {
    WillAlreadyExists: 'Will already exists',
    WillNotFound: 'Will not found on the current blockchain node',
    InvalidAddress: 'Invalid blockchain address',
    InvalidInput: 'Invalid input provided to contract',
    NotWillOwner: 'Only the will owner can perform this action',
    NotAuthorized: 'Caller is not authorized for this action',
    WillRevoked: 'Will has been revoked',
    WillAlreadyExecuted: 'Will is already executed',
    ConditionNotMet: 'Will condition/release time is not met yet',
    NoFundsAvailable: 'Will has no funds. Fund the will before execution',
    TransferFailed: 'Beneficiary transfer failed',
    InvalidShares: 'Beneficiary shares are invalid'
  };

  return map[errorName] || null;
}

function decodeDigitalWillCustomError(error) {
  try {
    const iface = new ethers.Interface(DIGITAL_WILL_ABI);
    const candidates = [
      error?.data,
      error?.error?.data,
      error?.info?.error?.data,
      error?.receipt?.revertReason,
      error?.revert?.data
    ].filter((value) => typeof value === 'string' && value.startsWith('0x'));

    for (const data of candidates) {
      try {
        const parsed = iface.parseError(data);
        if (parsed?.name) {
          return mapDigitalWillErrorName(parsed.name) || parsed.name;
        }
      } catch {
        // Keep trying other candidate error payloads.
      }
    }
  } catch {
    // If interface parsing fails, fall back to generic formatter.
  }

  const text = String(error?.message || error || '');
  const knownNames = [
    'WillAlreadyExists',
    'WillNotFound',
    'InvalidAddress',
    'InvalidInput',
    'NotWillOwner',
    'NotAuthorized',
    'WillRevoked',
    'WillAlreadyExecuted',
    'ConditionNotMet',
    'NoFundsAvailable',
    'TransferFailed',
    'InvalidShares'
  ];

  for (const name of knownNames) {
    if (text.includes(name)) {
      return mapDigitalWillErrorName(name);
    }
  }

  return null;
}

function isIgnorableRuntimeError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('datachannel is closed') ||
    message.includes('libdatachannel error while sending data channel message')
  );
}

async function persistWillMetadataOnIpfs(payload) {
  const filteredConditions = Array.isArray(payload.conditions)
    ? payload.conditions.filter((c) => c?.type && SUPPORTED_WILL_CONDITIONS.has(c.type))
    : [];

  const incomingWitnesses = Array.isArray(payload.witnesses) ? payload.witnesses : [];
  const fallbackWitnesses = [
    {
      name: String(payload.witness1Name || '').trim(),
      address: String(payload.witness1Address || '').trim(),
      signature: String(payload.witness1Signature || '').trim()
    },
    {
      name: String(payload.witness2Name || '').trim(),
      address: String(payload.witness2Address || '').trim(),
      signature: String(payload.witness2Signature || '').trim()
    }
  ].filter((w) => w.name || w.address || w.signature);

  const witnesses = (incomingWitnesses.length ? incomingWitnesses : fallbackWitnesses)
    .map((w) => ({
      name: String(w?.name || '').trim(),
      address: String(w?.address || '').trim(),
      signature: String(w?.signature || '').trim()
    }))
    .filter((w) => w.name || w.address || w.signature);

  const normalizedTestatorName = String(payload.testatorName || '').trim();

  const metadata = {
    version: '1.0',
    createdAt: toIndiaIsoString(),
    id: payload.id,
    name: payload.name,
    description: payload.description,
    testatorName: /^0x[a-fA-F0-9]{40}$/.test(normalizedTestatorName) ? '' : normalizedTestatorName,
    testatorGuardianName: String(payload.testatorGuardianName || '').trim(),
    testatorAge: String(payload.testatorAge || '').trim(),
    testatorAddress: String(payload.testatorAddress || '').trim(),
    religion: String(payload.religion || '').trim(),
    dob: String(payload.dob || '').trim(),
    place: String(payload.place || '').trim(),
    testatorSignature: String(payload.testatorSignature || '').trim(),
    witnesses,
    witness1Name: String(payload.witness1Name || '').trim(),
    witness1Address: String(payload.witness1Address || '').trim(),
    witness1Signature: String(payload.witness1Signature || '').trim(),
    witness2Name: String(payload.witness2Name || '').trim(),
    witness2Address: String(payload.witness2Address || '').trim(),
    witness2Signature: String(payload.witness2Signature || '').trim(),
    conditions: filteredConditions,
    owner: payload.owner,
    executor: payload.executor,
    executorEmail: payload.executorEmail,
    executorAddress: String(payload.executorAddress || payload.executorWalletAddress || '').trim(),
    beneficiaries: payload.beneficiaries || [],
    nominees: payload.nominees || [],
    assets: payload.assets || []
  };

  const data = Buffer.from(JSON.stringify(metadata, null, 2), 'utf8');
  const fileName = `will-${payload.id || Date.now()}.json`;
  const cid = await ipfs.addFile(data, fileName);
  return { cid, fileName, metadata };
}

async function getDigitalWillSignerAndContract() {
  if (!DIGITAL_WILL_CONTRACT_ADDRESS || !DIGITAL_WILL_OWNER_PRIVATE_KEY) {
    throw new Error(
      'Missing DIGITAL_WILL_CONTRACT_ADDRESS or DIGITAL_WILL_OWNER_PRIVATE_KEY in backend environment'
    );
  }

  if (!ethers.isAddress(DIGITAL_WILL_CONTRACT_ADDRESS)) {
    throw new Error('DIGITAL_WILL_CONTRACT_ADDRESS is not a valid wallet/contract address');
  }

  // Auto-detect network is more resilient than hardcoding chainId
  const provider = new ethers.JsonRpcProvider(BLOCKCHAIN_RPC_URL);
  const wallet = new ethers.Wallet(DIGITAL_WILL_OWNER_PRIVATE_KEY, provider);

  const [code, balance] = await Promise.all([
    provider.getCode(DIGITAL_WILL_CONTRACT_ADDRESS),
    provider.getBalance(wallet.address)
  ]);

  if (!code || code === '0x') {
    throw new Error(`No deployed contract found at ${DIGITAL_WILL_CONTRACT_ADDRESS} on ${BLOCKCHAIN_RPC_URL}`);
  }

  const contract = new ethers.Contract(DIGITAL_WILL_CONTRACT_ADDRESS, DIGITAL_WILL_ABI, wallet);

  return { provider, wallet, contract, balance };
}

async function sendContractTx(contractCall, provider, fromAddress, nonceRef) {
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (typeof nonceRef.value !== 'number') {
        nonceRef.value = await provider.getTransactionCount(fromAddress, 'pending');
      }

      const tx = await contractCall(nonceRef.value);
      nonceRef.value += 1;
      return await tx.wait();
    } catch (error) {
      lastError = error;
      const code = error?.code;
      const maybeNonce = code === 'NONCE_EXPIRED' || code === 'REPLACEMENT_UNDERPRICED';
      if (!maybeNonce || attempt === 1) {
        throw error;
      }
      nonceRef.value = await provider.getTransactionCount(fromAddress, 'pending');
    }
  }

  throw lastError;
}

function saveWillChainRecord(record) {
  const records = readJsonArraySafe(blockchainRecordsFile);
  records.push(record);
  writeJsonArraySafe(blockchainRecordsFile, records);
}

function disableWillScheduleInRecords(willId, reason) {
  const records = readJsonArraySafe(blockchainRecordsFile);
  let changed = false;

  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i];
    if (record?.type === 'DIGITAL_WILL' && record?.willId === willId) {
      records[i] = {
        ...record,
        schedulerDisabled: true,
        schedulerDisabledAt: toIndiaIsoString(),
        schedulerError: reason
      };
      changed = true;
      break;
    }
  }

  if (changed) {
    writeJsonArraySafe(blockchainRecordsFile, records);
  }
}

// ==========================================
// EMAIL NOTIFICATION HELPERS
// ==========================================

function createEmailTransporter() {
  if (!EMAIL_USER || !EMAIL_PASS) return null;
  return nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_PORT === 465,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });
}

function buildConditionSummary(conditions) {
  const effectiveConditions = flattenEffectiveConditions(conditions);
  if (!Array.isArray(effectiveConditions) || effectiveConditions.length === 0) return 'Condition met';
  return effectiveConditions
    .filter(c => c.type)
    .map(c => {
      if (c.type === 'Time')       return `Time-based (after ${c.value})`;
      if (c.type === 'Age') {
        const dob = c?.dob || c?.value?.dob || 'N/A';
        const targetAge = c?.targetAge || c?.value?.targetAge || c?.value || 'N/A';
        const releaseTime = deriveAgeConditionReleaseTime([c]);
        const when = releaseTime ? toIndiaDisplayString(new Date(releaseTime * 1000)) : 'computed date unavailable';
        return `Age-based (DOB ${dob}, at age ${targetAge}, on ${when})`;
      }
      if (c.type === 'Death')      return 'Death verification';
      return c.type;
    })
    .join(', ');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderConditionRows(conditions) {
  const effectiveConditions = flattenEffectiveConditions(conditions);
  if (!Array.isArray(effectiveConditions) || effectiveConditions.length === 0) {
    return '<tr><td colspan="2">No conditions provided</td></tr>';
  }

  return effectiveConditions
    .map((condition, index) => {
      const type = escapeHtml(condition?.type || 'N/A');
      const value = escapeHtml(condition?.value || 'N/A');
      return `<tr><td>Condition ${index + 1}</td><td>${type} - ${value}</td></tr>`;
    })
    .join('');
}

function renderBeneficiaryRows(beneficiaries) {
  if (!Array.isArray(beneficiaries) || beneficiaries.length === 0) {
    return '<tr><td colspan="2">No beneficiaries provided</td></tr>';
  }

  return beneficiaries
    .map((b, index) => {
      const name = escapeHtml(b?.name || 'N/A');
      const email = escapeHtml(b?.email || 'N/A');
      const share = escapeHtml(b?.share ?? 'N/A');
      const walletAddress = escapeHtml(b?.walletAddress || b?.address || 'N/A');
      return `<tr><td>Beneficiary ${index + 1}</td><td>${name} | ${email} | Share: ${share}% | Wallet: ${walletAddress}</td></tr>`;
    })
    .join('');
}

function renderAssetRows(assets) {
  if (!Array.isArray(assets) || assets.length === 0) {
    return '<tr><td colspan="2">No assets provided</td></tr>';
  }

  return assets
    .map((asset, index) => {
      const type = escapeHtml(asset?.type || 'N/A');
      const description = escapeHtml(asset?.description || asset?.name || 'N/A');
      const value = escapeHtml(asset?.value || 'N/A');
      return `<tr><td>Asset ${index + 1}</td><td>${type} | ${description} | Value: ${value}</td></tr>`;
    })
    .join('');
}

function renderNomineeRows(nominees) {
  if (!Array.isArray(nominees) || nominees.length === 0) {
    return '<tr><td colspan="2">No nominees provided</td></tr>';
  }

  return nominees
    .map((n, index) => {
      const name = escapeHtml(n?.name || 'N/A');
      const email = escapeHtml(n?.email || 'N/A');
      const relation = escapeHtml(n?.relation || 'N/A');
      const walletAddress = escapeHtml(n?.walletAddress || 'N/A');
      return `<tr><td>Nominee ${index + 1}</td><td>${name} | ${email} | Relation: ${relation} | Wallet: ${walletAddress}</td></tr>`;
    })
    .join('');
}

function fillOrBlank(value) {
  const text = String(value ?? '').trim();
  return text || '______________________';
}

function toDateFragment(input) {
  const date = input ? new Date(input) : new Date();
  if (Number.isNaN(date.getTime())) {
    return { day: '____', month: '________', year: '20__' };
  }
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIME_ZONE,
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).formatToParts(date);

  const day = parts.find((p) => p.type === 'day')?.value || '____';
  const month = parts.find((p) => p.type === 'month')?.value || '________';
  const year = parts.find((p) => p.type === 'year')?.value || '20__';
  return { day, month, year };
}

function buildExecutionConditionForWill(conditions) {
  const effectiveConditions = flattenEffectiveConditions(conditions);
  if (!effectiveConditions.length) return 'Condition met';

  return effectiveConditions.map((condition) => {
    if (condition?.type === 'Time') {
      return `Time-Based (${condition?.value || 'N/A'})`;
    }

    if (condition?.type === 'Age') {
      const dob = condition?.dob || condition?.value?.dob || 'N/A';
      const targetAge = condition?.targetAge || condition?.value?.targetAge || condition?.value || 'N/A';
      return `Age-Based (DOB: ${dob}, Target Age: ${targetAge})`;
    }

    if (condition?.type === 'Death') {
      return 'Death Verification';
    }

    return String(condition?.type || 'Condition');
  }).join(' / ');
}
function normalizeName(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/^0x[a-fA-F0-9]{40}$/.test(text)) return '';
  return text;
}

function valueOrBlank(value, { preventWalletAsName = false } = {}) {
  const text = preventWalletAsName
    ? normalizeName(value)
    : String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || '______________________';
}

function listExecutionRecipients(willMetadata) {
  const beneficiaries = Array.isArray(willMetadata?.beneficiaries) ? willMetadata.beneficiaries : [];
  const nominees = Array.isArray(willMetadata?.nominees) ? willMetadata.nominees : [];
  const raw = [
    ...beneficiaries.map((b) => String(b?.email || '').trim()),
    ...nominees.map((n) => String(n?.email || '').trim()),
    String(willMetadata?.executorEmail || '').trim()
  ].filter(Boolean);

  const valid = [...new Set(raw)].filter((email) => isValidEmail(email));
  return {
    valid,
    skipped: Math.max(raw.length - valid.length, 0)
  };
}

async function generateTrustChainPdfBuffer(willMetadata, txHash) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const lineGap = 4.2;
    const leftX = doc.page.margins.left;
    const resetX = () => {
      doc.x = leftX;
    };
    const ensureSpace = (min = 90) => {
      if (doc.y > doc.page.height - doc.page.margins.bottom - min) {
        doc.addPage();
      }
      resetX();
    };
    const section = (title) => {
      ensureSpace();
      resetX();
      doc.moveDown(0.45);
      doc.font('Times-Bold').fontSize(12).text(title, leftX, doc.y, { lineGap, align: 'left' });
      doc.font('Times-Roman').fontSize(11.5);
      doc.moveDown(0.12);
    };
    const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const para = (text) => {
      ensureSpace();
      resetX();
      doc.font('Times-Roman').fontSize(11.5).text(cleanText(text), leftX, doc.y, { align: 'left', lineGap });
      doc.moveDown(0.1);
    };
    const richPara = (segments) => {
      ensureSpace();
      resetX();
      const x = leftX;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      segments.forEach((segment, index) => {
        const text = String(segment?.text ?? '');
        doc
          .font(segment?.bold ? 'Times-Bold' : 'Times-Roman')
          .fontSize(11)
          .text(
            text,
            index === 0 ? x : undefined,
            index === 0 ? doc.y : undefined,
            {
              continued: index < segments.length - 1,
              lineGap,
              width,
              align: 'left',
              underline: Boolean(segment?.underline)
            }
          );
      });

      doc.font('Times-Roman').fontSize(11);
      doc.moveDown(0.1);
    };
    const field = (label, value, indent = 0) => {
      ensureSpace();
      resetX();
      const x = leftX + indent;
      doc.font('Times-Roman').fontSize(11.5).text(`${label}: `, x, doc.y, { continued: true, lineGap });
      doc.font('Times-Bold').fontSize(11).text(valueOrBlank(value), { lineGap, underline: true });
      doc.font('Times-Roman').fontSize(11.5);
    };

    const createdDate = toDateFragment(willMetadata?.createdAt);
    const executionDate = toDateFragment(new Date());
    const conditions = flattenEffectiveConditions(willMetadata?.conditions || []);
    const beneficiaries = Array.isArray(willMetadata?.beneficiaries) ? willMetadata.beneficiaries : [];
    const assets = Array.isArray(willMetadata?.assets) ? willMetadata.assets : [];
    const witnessesFromArray = Array.isArray(willMetadata?.witnesses) ? willMetadata.witnesses : [];
    const legacyWitnesses = [
      {
        name: willMetadata?.witness1Name,
        address: willMetadata?.witness1Address,
        signature: willMetadata?.witness1Signature
      },
      {
        name: willMetadata?.witness2Name,
        address: willMetadata?.witness2Address,
        signature: willMetadata?.witness2Signature
      }
    ].filter((w) => String(w?.name || '').trim() || String(w?.address || '').trim() || String(w?.signature || '').trim());
    const witnesses = (witnessesFromArray.length ? witnessesFromArray : legacyWitnesses)
      .map((w) => ({
        name: String(w?.name || '').trim(),
        address: String(w?.address || '').trim(),
        signature: String(w?.signature || '').trim()
      }));
    const place = valueOrBlank(willMetadata?.place || willMetadata?.city);

    doc.font('Times-Bold').fontSize(17).text('DIGITAL WILL', { align: 'center', lineGap });
    doc.moveDown(0.45);

    para(
      `I, Shri/Smt ${valueOrBlank(willMetadata?.testatorName, { preventWalletAsName: true })}, son/daughter/wife of Shri ${valueOrBlank(willMetadata?.testatorGuardianName || willMetadata?.guardianName)}, aged ${valueOrBlank(willMetadata?.testatorAge || willMetadata?.age)} years, resident of ${valueOrBlank(willMetadata?.testatorAddress || willMetadata?.address)}, by religion ${valueOrBlank(willMetadata?.religion)}, born on ${valueOrBlank(willMetadata?.dob || willMetadata?.dateOfBirth)}, do hereby revoke all my previous Wills and Codicils and declare this to be my last Will and Testament made on this ${createdDate.day} day of ${createdDate.month}, ${createdDate.year}.`
    );
    para('I declare that I am in sound mind and good health and that this Will is made by me of my own free will and volition, without any coercion, undue influence, or pressure from any person.');

    section('1. WILL DETAILS');
    field('Will Name', willMetadata?.name || willMetadata?.willName);
    field('Execution Condition', buildExecutionConditionForWill(willMetadata?.conditions || []));
    para('(Time-Based / Age-Based / Death Verification / Multiple Conditions)');

    section('2. APPOINTMENT OF EXECUTOR');
    para(
      `I hereby appoint Shri/Smt ${valueOrBlank(willMetadata?.executor, { preventWalletAsName: true })} (Email: ${valueOrBlank(willMetadata?.executorEmail)}), as the Executor of this Will, who shall be responsible for managing and distributing my assets as per my instructions.`
    );
    field('Blockchain Wallet Address of Executor', willMetadata?.executorAddress || willMetadata?.executorWalletAddress);
    para('In case the above executor is unable or unwilling to act, an alternate executor may be appointed as per legal provisions.');

    section('3. BENEFICIARIES');
    para('I hereby declare the following beneficiaries who shall receive my assets:');
    if (!beneficiaries.length) {
      para('No beneficiaries available in will data.');
    } else {
      beneficiaries.forEach((b, i) => {
        resetX();
        doc.font('Times-Bold').fontSize(12).text(`Beneficiary ${i + 1}`, leftX, doc.y, { lineGap });
        doc.font('Times-Roman').fontSize(11);
        field('Name', b?.name, 16);
        field('Email', b?.email, 16);
        field('Share (%)', b?.share, 16);
        field('Wallet Address', b?.walletAddress || b?.address, 16);
        doc.moveDown(0.2);
      });
    }
    para('(Additional beneficiaries may be added similarly)');

    section('4. ASSET DETAILS');
    para('I declare that I am the sole and absolute owner of the following assets:');
    if (!assets.length) {
      para('No assets available in will data.');
    } else {
      assets.forEach((asset, i) => {
        resetX();
        doc.font('Times-Bold').fontSize(12).text(`Asset ${i + 1}`, leftX, doc.y, { lineGap });
        doc.font('Times-Roman').fontSize(11);
        field('Type', asset?.type, 16);
        field('Description', asset?.description, 16);
        field('Estimated Value', asset?.value, 16);
        doc.moveDown(0.2);
      });
    }
    para('(All assets added through the system are included as part of this Will)');

    section('5. DISTRIBUTION OF ASSETS');
    para('All the above-mentioned assets shall be distributed among the beneficiaries as per their defined share percentages.');
    para('The Executor shall ensure that:');
    para('- Assets are distributed fairly according to the defined shares');
    para('- Blockchain-based assets are transferred using the provided wallet addresses');
    para('- Legal compliance is maintained during execution');

    section('6. EXECUTION CONDITIONS');
    para('This Will shall come into effect based on the following condition:');
    if (!conditions.length) {
      para('- Condition data unavailable');
    } else {
      conditions.forEach((c, i) => {
        const conditionType = valueOrBlank(c?.type);
        let conditionValue = valueOrBlank(c?.value);

        if (c?.type === 'Age') {
          conditionValue = `DOB: ${valueOrBlank(c?.dob || c?.value?.dob)}, Target Age: ${valueOrBlank(c?.targetAge || c?.value?.targetAge || c?.value)}`;
        }

        if (c?.type === 'Death') {
          conditionValue = 'Verified death certificate approval';
        }

        para(`- Condition ${i + 1}: ${conditionType} - ${conditionValue}`);
      });
    }
    para('(Example: Upon death verification / On a specific date / When beneficiary reaches a certain age / Multiple conditions)');

    section('7. DECLARATION OF OWNERSHIP');
    para('All assets listed in this Will are self-acquired and owned by me. No other person has any right, claim, or interest in these assets.');

    section('8. DIGITAL ACCESS & AUTHORIZATION');
    para('I authorize the Executor to access and manage my digital and financial assets, including blockchain-based assets, using the credentials and permissions provided securely.');

    section('9. SIGNATURE');
    para(`IN WITNESS WHEREOF, I have hereunto set my hand on this ${executionDate.day} day of ${executionDate.month}, ${executionDate.year} at ${place}.`);
    field('Signature of Testator', willMetadata?.testatorSignature, 0);

    section('10. WITNESSES');
    para('We hereby attest that the Testator has signed this Will in our presence and has declared it as their last Will. The Testator is of sound mind and has executed this document voluntarily.');
    if (!witnesses.length) {
      resetX();
      doc.font('Times-Bold').fontSize(12).text('Witness 1', leftX, doc.y, { lineGap });
      doc.font('Times-Roman').fontSize(11);
      field('Name', '', 16);
      field('Address', '', 16);
      field('Signature', '', 16);
    } else {
      witnesses.forEach((witness, index) => {
        resetX();
        doc.font('Times-Bold').fontSize(12).text(`Witness ${index + 1}`, leftX, doc.y, { lineGap });
        doc.font('Times-Roman').fontSize(11);
        field('Name', witness?.name, 16);
        field('Address', witness?.address, 16);
        field('Signature', witness?.signature, 16);
        doc.moveDown(0.2);
      });
    }
    doc.moveDown(0.4);
    field('Blockchain TX', txHash);
    doc.moveDown(0.5);
    resetX();
    doc.font('Times-Bold').fontSize(12).text('END OF DIGITAL WILL', leftX, doc.y, { lineGap });

    doc.end();
  });
}

async function sendExecutedWillEmailsWithAttachment(willMetadata, txHash) {
  const transporter = createEmailTransporter();
  const recipients = listExecutionRecipients(willMetadata);
  const uniqueRecipients = recipients.valid;
  const skipped = recipients.skipped;

  if (!transporter) {
    const reason = 'SMTP not configured. Set EMAIL_USER and EMAIL_PASS for real email delivery.';
    console.warn(`[EMAIL] ${reason}`);
    return { sent: 0, failed: 0, skipped: skipped + uniqueRecipients.length, error: reason };
  }

  if (!uniqueRecipients.length) {
    console.warn('[EMAIL] No valid recipients found for executed will email.');
    return { sent: 0, failed: 0, skipped };
  }

  console.log(`[EMAIL] Sending executed will PDF to: ${uniqueRecipients.join(', ')}`);
  const pdfBuffer = await generateTrustChainPdfBuffer(willMetadata, txHash);
  const willId = willMetadata?.id || 'Will';

  let sent = 0;
  let failed = 0;

  await Promise.allSettled(uniqueRecipients.map(async (email) => {
    try {
      await transporter.sendMail({
        from: EMAIL_FROM,
        to: email,
        subject: `TrustChain: Digital Will Executed (${willId})`,
        text: `Digital Will execution completed. Please find the attached TrustChain.pdf.\n\nWill ID: ${willId}\nBlockchain TX: ${txHash || 'N/A'}`,
        html: `<p>Digital Will execution completed.</p><p>Please find the attached <strong>TrustChain.pdf</strong>.</p><p>Will ID: <strong>${escapeHtml(willId)}</strong><br/>Blockchain TX: <strong>${escapeHtml(txHash || 'N/A')}</strong></p>`,
        attachments: [
          {
            filename: 'TrustChain.pdf',
            content: pdfBuffer,
            contentType: 'application/pdf'
          }
        ]
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`[EMAIL] Failed to send executed will PDF to ${email}:`, err.message);
    }
  }));

  return { sent, failed, skipped };
}

async function sendWillCreatedEmail(willMetadata) {
  const transporter = createEmailTransporter();
  if (!transporter) return;

  const executorEmail = isValidEmail(willMetadata.executorEmail) ? willMetadata.executorEmail.trim() : null;
  if (!executorEmail) return;

  const html = `
    <h2>TrustChain: You have been appointed as an Executor</h2>
    <p>A new Digital Will has been created and you have been appointed as the Executor.</p>
    <p>Will Name: <strong>${escapeHtml(willMetadata.name || 'Untitled Will')}</strong></p>
    <p>Will ID: <strong>${escapeHtml(willMetadata.id || 'N/A')}</strong></p>
    <p>Execution Condition: <strong>${escapeHtml(buildExecutionConditionForWill(willMetadata.conditions))}</strong></p>
    <p>This will is currently stored on the blockchain and will execute automatically once the conditions are met.</p>
    <br/>
    <p>Thank you for using TrustChain.</p>
  `;

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: executorEmail,
    subject: `TrustChain: Executor Appointment for ${willMetadata.name || 'Digital Will'}`,
    html
  });
  console.log(`[EMAIL] ✓ Executor appointment notification sent to: ${executorEmail}`);
}

async function sendDeathConditionCreatedEmails(willMetadata, uploadUrl, claimId) {
  const transporter = createEmailTransporter();
  if (!transporter) return;

  const recipients = [
    ...((willMetadata.beneficiaries || []).map((b) => b?.email).filter(Boolean)),
    ...((willMetadata.nominees || []).map((n) => n?.email).filter(Boolean)),
    isValidEmail(willMetadata.executorEmail) ? willMetadata.executorEmail : null
  ].filter(Boolean);

  const uniqueRecipients = [...new Set(recipients)];
  if (!uniqueRecipients.length) return;

  const html = `
    <h2>TrustChain Death-Condition Will Created</h2>
    <p>Will ID: <strong>${escapeHtml(willMetadata.id || 'N/A')}</strong></p>
    <p>A death-condition will has been created. To release this will, please upload a death certificate and submit for executor approval.</p>
    <p>Claim ID: <strong>${escapeHtml(claimId)}</strong></p>
    <p><a href="${escapeHtml(uploadUrl)}">Upload Death Certificate</a></p>
    <p>Reply to this mail with death certificate if needed, or use the secure upload link above.</p>
  `;

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: uniqueRecipients.join(','),
    subject: `TrustChain: Death-condition will created (${willMetadata.id || 'Will'})`,
    html
  });
}

async function sendExecutorApprovalEmail(
  willMetadata,
  approveUrl,
  claimId,
  claimToken,
  certificateFileName,
  certificateFilePath,
  certificatePublicUrl
) {
  const transporter = createEmailTransporter();
  const executorEmail = isValidEmail(willMetadata?.executorEmail) ? willMetadata.executorEmail.trim() : '';
  if (!transporter || !executorEmail) return;

  const html = `
    <h2>TrustChain Death Certificate Received</h2>
    <p>Will ID: <strong>${escapeHtml(willMetadata.id || 'N/A')}</strong></p>
    <p>Claim ID: <strong>${escapeHtml(claimId)}</strong></p>
    <p>Claim Token: <strong>${escapeHtml(claimToken || 'N/A')}</strong></p>
    <p>Certificate file: <strong>${escapeHtml(certificateFileName || 'Uploaded file')}</strong></p>
    ${certificatePublicUrl ? `<p>View uploaded certificate: <a href="${escapeHtml(certificatePublicUrl)}">Open Certificate</a></p>` : ''}
    <p>Please review and approve release:</p>
    <p>
      <a href="${escapeHtml(approveUrl)}" style="display:inline-block;padding:10px 16px;background:#1f7a36;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
        Release Will
      </a>
    </p>
  `;

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: executorEmail,
    subject: `TrustChain: Approval needed for will ${willMetadata.id || ''}`,
    html,
    attachments: certificateFilePath
      ? [{ filename: certificateFileName || 'death-certificate', path: certificateFilePath }]
      : []
  });
}

async function sendFinalWillDataEmails(willMetadata, txHash) {
  return sendExecutedWillEmailsWithAttachment(willMetadata, txHash);
}

async function sendBeneficiaryNotificationEmails(willMetadata, txHash) {
  return sendExecutedWillEmailsWithAttachment(willMetadata, txHash);
}

function clearScheduledWillExecution(willId) {
  const timer = willExecutionTimers.get(willId);
  if (timer) {
    clearTimeout(timer);
    willExecutionTimers.delete(willId);
  }
}

function scheduleWillExecution(willId, releaseTimeSeconds) {
  clearScheduledWillExecution(willId);

  const targetAtMs = Number(releaseTimeSeconds) * 1000;
  if (!Number.isFinite(targetAtMs)) {
    console.warn(`[SCHEDULER] Invalid releaseTime for ${willId}. Skipping schedule.`);
    return;
  }

  const scheduleNext = () => {
    const delayMs = targetAtMs - Date.now();

    if (delayMs <= 0) {
      const timer = setTimeout(async () => {
        willExecutionTimers.delete(willId);
        await handleScheduledWillExecution(willId);
      }, 0);
      willExecutionTimers.set(willId, timer);
      return;
    }

    if (delayMs > MAX_TIMER_DELAY_MS) {
      const timer = setTimeout(() => {
        willExecutionTimers.delete(willId);
        scheduleNext();
      }, MAX_TIMER_DELAY_MS);
      willExecutionTimers.set(willId, timer);
      return;
    }

    const timer = setTimeout(async () => {
      willExecutionTimers.delete(willId);
      await handleScheduledWillExecution(willId);
    }, delayMs);
    willExecutionTimers.set(willId, timer);
  };

  scheduleNext();
  const scheduledAt = toIndiaIsoString(new Date(targetAtMs));
  console.log(`[SCHEDULER] Scheduled will ${willId} for ${scheduledAt}`);
}

function recoverWillSchedulesFromRecords() {
  const records = readJsonArraySafe(blockchainRecordsFile);
  const latestByWillId = new Map();

  records
    .filter(record => record.type === 'DIGITAL_WILL' && record.willId && !record.schedulerDisabled)
    .forEach(record => {
      latestByWillId.set(record.willId, record);
    });

  for (const record of latestByWillId.values()) {
    if (record.releaseTime) {
      scheduleWillExecution(record.willId, Number(record.releaseTime));
    }
  }

  console.log(`[SCHEDULER] Restored schedules for ${latestByWillId.size} will(s)`);
}

async function recoverWillSchedulesFromRecordsSafe() {
  const records = readJsonArraySafe(blockchainRecordsFile);
  const latestByWillId = new Map();

  records
    .filter(record => record.type === 'DIGITAL_WILL' && record.willId && !record.schedulerDisabled)
    .forEach(record => {
      latestByWillId.set(record.willId, record);
    });

  let scheduled = 0;
  let disabledAsStale = 0;

  let signerAndContract = null;
  try {
    signerAndContract = await getDigitalWillSignerAndContract();
  } catch (error) {
    console.warn('[SCHEDULER] Blockchain unavailable during schedule recovery. Deferring schedule validation.');
    recoverWillSchedulesFromRecords();
    return;
  }

  const { contract } = signerAndContract;

  for (const record of latestByWillId.values()) {
    if (!record.releaseTime) {
      continue;
    }

    try {
      await contract.getWill(record.willId);
      scheduleWillExecution(record.willId, Number(record.releaseTime));
      scheduled += 1;
    } catch (error) {
      const message = formatBlockchainError(error);
      if (/will not found/i.test(message)) {
        disableWillScheduleInRecords(record.willId, 'stale will from previous chain session');
        disabledAsStale += 1;
        continue;
      }

      // Unknown issue: keep schedule so it can retry later.
      scheduleWillExecution(record.willId, Number(record.releaseTime));
      scheduled += 1;
    }
  }

  console.log(`[SCHEDULER] Restored schedules for ${scheduled} will(s)`);
  if (disabledAsStale > 0) {
    console.warn(`[SCHEDULER] Disabled ${disabledAsStale} stale schedule(s) from old blockchain sessions`);
  }
}

async function getBlockchainStatus() {
  try {
    const provider = new ethers.JsonRpcProvider(BLOCKCHAIN_RPC_URL);
    await provider.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

async function executeWillAndNotify(willId, trigger = 'manual') {
  const { provider, wallet, contract } = await getDigitalWillSignerAndContract();
  let currentWillState;
  try {
    currentWillState = await getWillState(contract, willId);
  } catch (error) {
    const message = formatBlockchainError(error);
    if (/will not found/i.test(message)) {
      return { status: 'SKIPPED', reason: message, willId };
    }
    throw error;
  }

  console.log(`[EXECUTE] Will state fetched for ${willId}. Executed: ${currentWillState.executed}, Funded: ${currentWillState.fundedAmountEth} ETH`);

  let willMetadata = null;
  if (currentWillState.metadataCid && ipfsInstance) {
    try {
      const metadataBuffer = await ipfs.getFile(currentWillState.metadataCid);
      willMetadata = JSON.parse(metadataBuffer.toString('utf8'));
    } catch {
      willMetadata = null;
    }
  }

  const deathConditionSelected = hasDeathCondition(willMetadata?.conditions || []);
  if (deathConditionSelected && trigger !== 'death-approval') {
    return { status: 'SKIPPED', reason: 'Death claim approval required', will: currentWillState };
  }

  if (currentWillState.revoked) {
    return { status: 'SKIPPED', reason: 'Will is revoked', will: currentWillState };
  }

  if (currentWillState.executed) {
    return { status: 'SKIPPED', reason: 'Will is already executed', will: currentWillState };
  }

  try {
    const fundedAmountWei = BigInt(currentWillState.fundedAmountWei || '0');
    if (fundedAmountWei <= 0n) {
      return { status: 'SKIPPED', reason: 'Will has no funds. Fund the will before execution.', will: currentWillState };
    }
  } catch {
    return { status: 'SKIPPED', reason: 'Could not read will funded amount', will: currentWillState };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Number(currentWillState.releaseTime) > now && trigger !== 'death-approval') {
    return { status: 'SKIPPED', reason: 'Release time not reached yet', will: currentWillState };
  }

  const nonceRef = {
    value: await provider.getTransactionCount(wallet.address, 'pending')
  };

  const minimumExecutionFundWei = deriveMinimumExecutionFundWei();
  let autoTopUpTxHash = null;
  let autoTopUpAmountWei = 0n;

  let fundedAmountWei = BigInt(currentWillState.fundedAmountWei || '0');
  if (minimumExecutionFundWei > 0n && fundedAmountWei < minimumExecutionFundWei) {
    const deficitWei = minimumExecutionFundWei - fundedAmountWei;
    const topUpReceipt = await sendContractTx(
      (nonce) => contract.fundWill(willId, { value: deficitWei, nonce }),
      provider,
      wallet.address,
      nonceRef
    );

    autoTopUpTxHash = topUpReceipt.hash;
    autoTopUpAmountWei = deficitWei;
    currentWillState = await getWillState(contract, willId);
    fundedAmountWei = BigInt(currentWillState.fundedAmountWei || '0');
  }

  if (fundedAmountWei <= 0n) {
    return { status: 'SKIPPED', reason: 'Will has no funds. Fund the will before execution.', will: currentWillState };
  }

  console.log(`[EXECUTE] Sending executeWill transaction for ${willId} to Sepolia...`);
  const receipt = await sendContractTx(
    (nonce) => contract.executeWill(willId, { nonce, gasLimit: 500000 }),
    provider,
    wallet.address,
    nonceRef
  );
  console.log(`[EXECUTE] ✓ executeWill SUCCESS. Transaction Hash: ${receipt.hash}`);

  const executedWillState = await getWillState(contract, willId);

  let emailResult = { sent: 0, failed: 0, skipped: 0 };
  if (executedWillState.metadataCid && ipfsInstance) {
    try {
      const metadata = willMetadata || JSON.parse((await ipfs.getFile(executedWillState.metadataCid)).toString('utf8'));
      if (hasDeathCondition(metadata?.conditions || [])) {
        emailResult = await sendFinalWillDataEmails(metadata, receipt.hash);
      } else {
        emailResult = await sendBeneficiaryNotificationEmails(metadata, receipt.hash);
      }
    } catch (emailErr) {
      console.error('[EXECUTE] Email notification error (non-fatal):', emailErr.message);
      emailResult = { sent: 0, failed: 0, skipped: 0, error: emailErr.message };
    }
  }

  saveWillChainRecord({
    type: 'DIGITAL_WILL_EXECUTION',
    timestamp: toIndiaIsoString(),
    trigger,
    willId,
    contractAddress: DIGITAL_WILL_CONTRACT_ADDRESS,
    transactionHash: receipt.hash,
    autoTopUpTxHash,
    autoTopUpAmountWei: String(autoTopUpAmountWei),
    autoTopUpAmountEth: autoTopUpAmountWei > 0n ? ethers.formatEther(autoTopUpAmountWei) : '0.0',
    releaseTime: executedWillState.releaseTime,
    executed: executedWillState.executed,
    revoked: executedWillState.revoked,
    email: emailResult
  });

  return {
    status: 'EXECUTED',
    txHash: receipt.hash,
    funding: {
      minimumExecutionFundEth: String(WILL_MIN_EXECUTION_FUND_ETH || '1'),
      autoTopUpTxHash,
      autoTopUpAmountWei: String(autoTopUpAmountWei),
      autoTopUpAmountEth: autoTopUpAmountWei > 0n ? ethers.formatEther(autoTopUpAmountWei) : '0.0'
    },
    will: executedWillState,
    email: emailResult
  };
}

async function handleScheduledWillExecution(willId) {
  console.log(`[SCHEDULER] Triggering execution for ${willId}...`);
  try {
    const execution = await executeWillAndNotify(willId, 'scheduled');
    if (execution.status === 'EXECUTED') {
      console.log(`[SCHEDULER] ✓ Will ${willId} executed automatically. TX: ${execution.txHash}`);
      return;
    }

    if (execution.status === 'SKIPPED' && execution.reason === 'Release time not reached yet') {
      console.log(`[SCHEDULER] Will ${willId} execution deferred: release time is in the future.`);
      scheduleWillExecution(willId, execution.will.releaseTime);
      return;
    }

    console.log(`[SCHEDULER] Will ${willId} skipped: ${execution.reason}`);
  } catch (error) {
    const message = formatBlockchainError(error);
    const isPermanent = /missing revert data|willnotfound|no deployed contract|could not coalesce|execution reverted/i.test(message);

    if (isPermanent) {
      disableWillScheduleInRecords(willId, message);
      console.warn(`[SCHEDULER] Disabled schedule for ${willId}: ${message}`);
      return;
    }

    console.error(`[SCHEDULER] Auto execution failed for ${willId}:`, message);
  }
}

// Normalize text (EXACT same as ML code)
function normalizeText(text) {
  text = text.replace(/–/g, "-");
  text = text.replace(/—/g, "-");
  text = text.split(/\s+/).join(" ");
  return text.trim();
}

// Verify document against dataset
function verifyDocument(uploadedText) {
  // Read certificate dataset
  const datasetPath = path.join(__dirname, 'certificate_dataset.csv');
  
  if (!fs.existsSync(datasetPath)) {
    return { isValid: false, score: 0, error: 'Dataset not found' };
  }

  const csvContent = fs.readFileSync(datasetPath, 'utf-8');
  const lines = csvContent.split('\n').slice(1); // Skip header
  
  // Parse CSV and filter real certificates (label = 1)
  const realCertificates = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Split by comma, but handle commas in the document text
    const parts = line.split(',');
    if (parts.length >= 4) {
      const label = parseInt(parts[parts.length - 1].trim());
      const date = parts[parts.length - 2].trim();
      const id = parts[parts.length - 3].trim();
      
      if (label === 1 && id && date) {
        realCertificates.push({ id, date });
      }
    }
  }

  const normalizedText = normalizeText(uploadedText);

  // Extract ID and date patterns (EXACT same regex as ML)
  const idMatches = normalizedText.match(/ID-\d{6}/g);
  const dateMatches = normalizedText.match(/\d{1,2}\s+\w+\s+\d{4}/g);

  if (!idMatches || idMatches.length !== 1) {
    return { isValid: false, score: 20 };
  }

  if (!dateMatches || dateMatches.length !== 1) {
    return { isValid: false, score: 20 };
  }

  const extractedId = idMatches[0];
  const extractedDate = dateMatches[0];

  // Check if ID exists in real certificates
  const idRows = realCertificates.filter(cert => cert.id === extractedId);
  
  if (idRows.length === 0) {
    return { isValid: false, score: 30 };
  }

  // Check if date also matches
  const fullMatch = idRows.find(cert => cert.date === extractedDate);

  if (!fullMatch) {
    return { isValid: false, score: 40 };
  }

  return { isValid: true, score: 100 };
}

// -------------------------------
// MULTER CONFIGURATION
// -------------------------------

// multer disk storage to keep filenames
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    // Allow PDF and DOCX only
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Only PDF and DOCX files are allowed.`));
    }
  }
});

const deathCertificateUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Upload PDF, DOCX, JPG, or PNG death certificate.'));
    }
  }
});

// ==========================================
// COMPLETE VERIFICATION FLOW ENDPOINT
// ==========================================

app.post("/verify", upload.single("document"), async (req, res) => {
  const startTime = Date.now();
  let file = null;
  let result = null;
  
  try {
    if (!req.file) {
      console.error("No file received in /verify request");
      return res.status(400).json({
        status: "ERROR",
        message: "No file uploaded. Make sure to send the file with field name 'document'.",
        error: "MISSING_FILE"
      });
    }

    file = req.file;
    const fileName = file.originalname;
    const filePath = file.path;
    const fileSizeKB = (file.size / 1024).toFixed(1);

    console.log("\n" + "=".repeat(60));
    console.log("📄 NEW VERIFICATION REQUEST");
    console.log("=".repeat(60));
    console.log(`File: ${fileName} (${fileSizeKB} KB)`);
    console.log(`Type: ${file.mimetype}`);
    console.log("=".repeat(60));

    // Generate document ID and timestamp
    const documentId = `DOC-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const timestamp = toIndiaIsoString();
    
    result = {
      documentId,
      fileName,
      fileSize: fileSizeKB + " KB",
      uploadTime: timestamp,
      processingTime: null,
      status: null,
      flow: []
    };

    // ===========================================
    // STEP 1: EXTRACT DOCUMENT TEXT
    // ===========================================
    
    console.log("\n[STEP 1/7] 📖 Extracting document text...");
    result.flow.push({ step: 1, name: "Extract Document Text", status: "processing" });

    let extractedText;
    try {
      extractedText = await extractDocumentText(filePath, fileName);
      result.flow[0].status = "completed";
      result.flow[0].textLength = extractedText.length;
      console.log(`✓ Text extracted: ${extractedText.length} characters`);
    } catch (error) {
      result.flow[0].status = "failed";
      result.flow[0].error = error.message;
      fs.unlinkSync(filePath);
      throw error;
    }

    // ===========================================
    // STEP 2: SEND TO ML MODEL
    // ===========================================
    
    console.log("\n[STEP 2/7] 🚀 Sending to ML service...");
    result.flow.push({ step: 2, name: "Send to ML Model", status: "processing" });

    let mlResponse;
    try {
      // Prepare form data for ML service
      const formData = new FormData();
      formData.append('document', fs.createReadStream(filePath), fileName);
      formData.append('text', extractedText);
      
      // Call ML service
      mlResponse = await axios.post(
        `${ML_SERVICE_URL}/verify-document`,
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 30000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity
        }
      );
      
      result.flow[1].status = "completed";
      console.log(`✓ ML service responded`);
    } catch (error) {
      // Fallback to local verification if ML service is unavailable
      console.warn(`⚠ ML service unavailable, using fallback verification`);
      const verification = verifyDocument(extractedText);
      mlResponse = {
        data: {
          verification: {
            isReal: verification.isValid,
            confidence: verification.score + "%",
            classification: verification.isValid ? 'REAL' : 'FAKE',
            method: 'Local Dataset'
          }
        }
      };
      result.flow[1].status = "completed";
      result.flow[1].fallback = true;
    }

    // ===========================================
    // STEP 3: ML CLASSIFICATION
    // ===========================================
    
    console.log("\n[STEP 3/7] 🤖 ML Classification...");
    result.flow.push({ step: 3, name: "ML Classification", status: "processing" });

    const verification = mlResponse.data.verification;
    const isReal = verification.isReal === true;
    const confidence = verification.confidence;
    
    result.flow[2].status = "completed";
    result.flow[2].classification = verification.classification;
    result.flow[2].confidence = confidence;
    result.verification = verification;
    
    console.log(`✓ Classification: ${verification.classification}`);
    console.log(`  Confidence: ${confidence}`);

    // ===========================================
    // IF FAKE - REJECT DOCUMENT
    // ===========================================
    
    if (!isReal) {
      console.log("\n[STEP 4/7] ❌ Document REJECTED");
      
      result.flow.push({
        step: 4,
        name: "Document Rejected",
        status: "rejected",
        reason: "Failed ML authenticity verification"
      });
      
      result.status = "REJECTED";
      result.message = "Document failed authenticity verification";
      result.processingTime = `${Date.now() - startTime}ms`;
      
      fs.unlinkSync(filePath);
      saveVerificationRecord(result);
      
      console.log("=".repeat(60) + "\n");
      return res.status(200).json(result);
    }

    // ===========================================
    // DOCUMENT IS REAL - CONTINUE PROCESSING
    // ===========================================
    
    console.log("\n[STEP 4/7] ✅ Document VERIFIED (Real)");
    result.flow.push({ step: 4, name: "Document Verified as Real", status: "completed" });

    // ===========================================
    // STEP 5: GENERATE SHA-256 HASH
    // ===========================================
    
    console.log("\n[STEP 5/7] 🔐 Generating SHA-256 hash...");
    result.flow.push({ step: 5, name: "Generate SHA-256 Hash", status: "processing" });

    let sha256Hash;
    try {
      sha256Hash = generateSHA256(filePath);
      result.flow[4].status = "completed";
      result.flow[4].hash = sha256Hash;
      result.sha256Hash = sha256Hash;
      console.log(`✓ SHA-256: ${sha256Hash}`);
    } catch (error) {
      result.flow[4].status = "failed";
      result.flow[4].error = error.message;
      throw error;
    }

    // ===========================================
    // STEP 6: UPLOAD TO IPFS
    // ===========================================
    
    console.log("\n[STEP 6/7] 📦 Uploading to IPFS...");
    result.flow.push({ step: 6, name: "Upload to IPFS", status: "processing" });

    let ipfsCID = null;
    try {
      const fileBuffer = fs.readFileSync(filePath);
      
      // Use Helia IPFS addFile function
      ipfsCID = await ipfs.addFile(fileBuffer, fileName);
      
      result.flow[5].status = "completed";
      result.flow[5].cid = ipfsCID;
      result.ipfs = {
        uploaded: true,
        cid: ipfsCID,
        message: "Document stored on IPFS successfully"
      };
      
      console.log(`✓ IPFS CID: ${ipfsCID}`);
      
      // Save CID record
      saveCIDRecord(fileName, ipfsCID, documentId, confidence);
    } catch (error) {
      console.error(`✗ IPFS Upload failed: ${error.message}`);
      result.flow[5].status = "failed";
      result.flow[5].error = error.message;
      result.ipfs = {
        uploaded: false,
        error: error.message
      };
    }

    // ===========================================
    // STEP 7: STORE ON BLOCKCHAIN
    // ===========================================
    
    console.log("\n[STEP 7/7] ⛓️  Storing on blockchain...");
    result.flow.push({ step: 7, name: "Store on Blockchain", status: "processing" });

    try {
      // Per product flow, store the uploaded file name as owner identifier.
      const owner = fileName;
      
      const blockchainResult = storeOnBlockchain({
        documentId,
        cid: ipfsCID,
        sha256Hash,
        owner,
        timestamp
      });
      
      result.flow[6].status = "completed";
      result.flow[6].transactionHash = blockchainResult.transactionHash;
      result.flow[6].blockNumber = blockchainResult.blockNumber;
      
      result.blockchain = {
        stored: true,
        transactionHash: blockchainResult.transactionHash,
        blockNumber: blockchainResult.blockNumber,
        documentId,
        cid: ipfsCID,
        sha256Hash: '0x' + sha256Hash,
        owner,
        timestamp
      };
      
      console.log(`✓ Blockchain TX: ${blockchainResult.transactionHash}`);
      console.log(`  Block: ${blockchainResult.blockNumber}`);
    } catch (error) {
      console.error(`✗ Blockchain storage failed: ${error.message}`);
      result.flow[6].status = "failed";
      result.flow[6].error = error.message;
      result.blockchain = {
        stored: false,
        error: error.message
      };
    }

    // ===========================================
    //FINAL: VERIFICATION RECORD CREATED
    // ===========================================
    
    console.log("\n[COMPLETE] 📝 Creating verification record...");
    result.flow.push({ step: 8, name: "Verification Record Created", status: "completed" });

    result.status = "VERIFIED";
    result.message = "Document successfully verified and stored";
    result.processingTime = `${Date.now() - startTime}ms`;

    // Save verification record
    saveVerificationRecord(result);

    // Clean up temporary file
    fs.unlinkSync(filePath);

    console.log("\n" + "=".repeat(60));
    console.log("✅ VERIFICATION COMPLETE");
    console.log(`   Document ID: ${documentId}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Processing Time: ${result.processingTime}`);
    console.log("=".repeat(60) + "\n");

    return res.status(200).json(result);

  } catch (error) {
    console.error("\n❌ VERIFICATION FAILED:", error.message);
    console.log("=".repeat(60) + "\n");

    // Clean up temporary file if it exists
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    return res.status(500).json({
      status: "ERROR",
      message: error.message,
      documentId: result?.documentId,
      fileName: result?.fileName,
      flow: result?.flow || []
    });
  }
});

// simple API key middleware (protects endpoints)
app.use((req, res, next) => {
    // Skip API key check for public endpoints
    const publicPaths = ['/health', '/verify', '/api/verification-records', '/api/blockchain-records', '/cid-records', '/favicon.ico'];
  const isPublicPath = publicPaths.includes(req.path) || req.path.startsWith('/api/ipfs/') || req.path.startsWith('/death-claim/');
    
    if (isPublicPath) {
      if (req.path === '/favicon.ico') {
        return res.status(204).end();
      }
      return next();
    }
  
  const key = req.headers["x-api-key"];
  const expectedKey = process.env.API_KEY;

  const shouldLogVerbose = REQUEST_LOG_LEVEL === 'verbose';
  const shouldLogMinimal = REQUEST_LOG_LEVEL === 'minimal' && req.method !== 'GET';
  if (shouldLogVerbose || shouldLogMinimal) {
    console.log(`[${toIndiaIsoString()}] ${req.method} ${req.path}`);
  }
  if (shouldLogVerbose) {
    console.log("  Headers:", {
      apiKey: key ? key.substring(0, 5) + '...' : 'missing',
      contentType: req.headers['content-type']
    });
  }

  if (expectedKey && key !== expectedKey) {
    console.warn("  ✗ Invalid API Key");
    return res.status(401).json({ message: "Invalid API Key" });
  }
  if (shouldLogVerbose) {
    console.log("  ✓ API Key valid");
  }
  next();
});

// Upload endpoint for storing files - expects form field 'file'
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename, path: `/uploads/${req.file.filename}` });
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    console.error("Multer error:", error.code, error.message);
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File is too large (max 50MB)' });
    }
    return res.status(400).json({ error: `Upload error: ${error.message}` });
  } else if (error) {
    console.error("Upload error:", error.message);
    return res.status(400).json({ error: error.message || 'Upload failed' });
  }
  next();
});

// List uploaded files
app.get('/files', (req, res) => {
  const dir = path.join(__dirname, 'uploads');
  fs.readdir(dir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Unable to read uploads' });
    const items = files.map(f => ({ filename: f, url: `/uploads/${f}` }));
    res.json(items);
  });
});

// ==========================================
// API ENDPOINTS FOR RECORDS
// ==========================================

// Get CID records
app.get('/cid-records', (req, res) => {
  try {
    const records = readJsonArraySafe(cidStorageFile);
    res.json({ success: true, count: records.length, records });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get verification records
app.get('/api/verification-records', (req, res) => {
  try {
    const records = readJsonArraySafe(verificationRecordsFile);
    res.json({ success: true, count: records.length, records });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get blockchain records
app.get('/api/blockchain-records', (req, res) => {
  try {
    const records = readJsonArraySafe(blockchainRecordsFile);
    res.json({ success: true, count: records.length, records });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Preview IPFS file (inline display with text extraction for Office docs)
app.get('/api/ipfs/preview/:cid', async (req, res) => {
  try {
    const { cid } = req.params;
    
    if (!cid) {
      return res.status(400).json({ success: false, error: 'CID is required' });
    }
    
    // Get file from IPFS
    const fileBuffer = await ipfs.getFile(cid);
    
    // Find the original filename from CID storage
    const cidRecords = readJsonArraySafe(cidStorageFile);
    const record = cidRecords.find(r => r.cid === cid);
    const fileName = record?.fileName || 'document';
    const ext = path.extname(fileName).toLowerCase();
    
    // For PDFs, serve directly for inline viewing
    if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(fileBuffer);
    }
    
    // For DOCX files, extract text and return as HTML for preview
    if (ext === '.docx') {
      try {
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        const htmlContent = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { 
                font-family: Arial, sans-serif; 
                padding: 40px; 
                line-height: 1.6;
                max-width: 800px;
                margin: 0 auto;
                background: white;
              }
              pre { 
                white-space: pre-wrap; 
                word-wrap: break-word; 
              }
            </style>
          </head>
          <body>
            <h2>📄 ${fileName}</h2>
            <hr>
            <pre>${result.value}</pre>
          </body>
          </html>
        `;
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.send(htmlContent);
      } catch (error) {
        console.error('Error extracting DOCX text:', error);
        // Fallback to download if extraction fails
      }
    }
    
    // For images, serve with appropriate content type
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) {
      const contentTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml'
      };
      res.setHeader('Content-Type', contentTypes[ext] || 'image/png');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(fileBuffer);
    }
    
    // For text files, serve as plain text
    if (['.txt', '.md', '.json', '.xml', '.csv'].includes(ext)) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(fileBuffer);
    }
    
    // Default: serve as HTML with file info
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            padding: 40px; 
            text-align: center;
          }
          .info { 
            background: #f0f0f0; 
            padding: 20px; 
            border-radius: 8px; 
            display: inline-block;
          }
        </style>
      </head>
      <body>
        <div class="info">
          <h2>📁 ${fileName}</h2>
          <p>File size: ${(fileBuffer.length / 1024).toFixed(2)} KB</p>
          <p>CID: ${cid}</p>
          <p><a href="/api/ipfs/download/${cid}" download="${fileName}">Download File</a></p>
        </div>
      </body>
      </html>
    `;
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(htmlContent);
    
  } catch (error) {
    console.error(`❌ Failed to preview IPFS file ${req.params.cid}:`, error.message);
    res.status(404).json({ success: false, error: 'File not found in IPFS' });
  }
});

// Download IPFS file (force download)
app.get('/api/ipfs/download/:cid', async (req, res) => {
  try {
    const { cid } = req.params;
    
    if (!cid) {
      return res.status(400).json({ success: false, error: 'CID is required' });
    }
    
    // Get file from IPFS
    const fileBuffer = await ipfs.getFile(cid);
    
    // Find the original filename from CID storage
    const cidRecords = readJsonArraySafe(cidStorageFile);
    const record = cidRecords.find(r => r.cid === cid);
    const fileName = record?.fileName || `file-${cid}`;
    
    // Set headers for download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Send file
    res.send(fileBuffer);
  } catch (error) {
    console.error(`❌ Failed to download IPFS file ${req.params.cid}:`, error.message);
    res.status(404).json({ success: false, error: 'File not found in IPFS' });
  }
});

// Legacy endpoint (redirects to preview)
app.get('/api/ipfs/:cid', async (req, res) => {
  res.redirect(`/api/ipfs/preview/${req.params.cid}`);
});

// Health check
app.get('/health', async (req, res) => {
  let mlServiceStatus = false;
  try {
    await axios.get(`${ML_SERVICE_URL}/health`, { timeout: 3000 });
    mlServiceStatus = true;
  } catch {}
  
  const ipfsStatus = Boolean(ipfsInstance?.heliaNode);
  const blockchainStatus = await getBlockchainStatus();
  
  res.json({
    service: "TrustChain Backend",
    status: "running",
    timestamp: toIndiaIsoString(),
    components: {
      mlService: mlServiceStatus,
      ipfs: ipfsStatus,
      blockchain: blockchainStatus
    }
  });
});

// DASHBOARD DATA (DUMMY)
app.get("/dashboard", (req, res) => {
  res.json({
    documentsUploaded: 5,
    documentsVerified: 3,
    willsCreated: 2,
    pendingWills: 1
  });
});

// CREATE WILL (ON-CHAIN)
app.post('/create-will', async (req, res) => {
  try {
    const payload = req.body || {};
    const willId = String(payload.id || `WILL-${Date.now()}`);

    const incomingConditions = Array.isArray(payload.conditions) ? payload.conditions.filter((c) => c?.type) : [];
    const effectiveConditions = flattenEffectiveConditions(incomingConditions);
    const deathConditionSelected = hasDeathCondition(effectiveConditions);
    const unsupportedCondition = incomingConditions.find((c) => !SUPPORTED_WILL_CONDITIONS.has(c.type));
    const unsupportedEffectiveCondition = effectiveConditions.find((c) => !SUPPORTED_WILL_CONDITIONS.has(c.type));
    if (unsupportedCondition) {
      return res.status(400).json({
        status: 'ERROR',
        message: `Unsupported condition type: ${unsupportedCondition.type}. Allowed: Time, Age, Death, Multiple.`
      });
    }

    if (unsupportedEffectiveCondition) {
      return res.status(400).json({
        status: 'ERROR',
        message: `Unsupported nested condition type: ${unsupportedEffectiveCondition.type}. Allowed nested types: Time, Age, Death.`
      });
    }

    if (incomingConditions.length) {
      payload.conditions = incomingConditions;
    }

    if (deathConditionSelected) {
      const nominees = Array.isArray(payload.nominees) ? payload.nominees : [];
      if (!nominees.length) {
        return res.status(400).json({
          status: 'ERROR',
          message: 'At least one nominee is required for Death condition.'
        });
      }

      const invalidNominee = nominees.find((n) => {
        const email = String(n?.email || '').trim();
        const wallet = String(n?.walletAddress || '').trim();
        return !String(n?.name || '').trim() || !isValidEmail(email) || (wallet && !normalizeWalletAddress(wallet));
      });

      if (invalidNominee) {
        return res.status(400).json({
          status: 'ERROR',
          message: 'Each nominee must include valid name and email. Wallet is optional but must be valid if provided.'
        });
      }
    }

    const ageConditionValidation = validateAgeCondition(effectiveConditions);
    if (ageConditionValidation.error) {
      return res.status(400).json({
        status: 'ERROR',
        message: ageConditionValidation.error
      });
    }

    const releaseTime = deriveReleaseTime(payload);
    const now = Math.floor(Date.now() / 1000);

    if (releaseTime <= now) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'releaseTime must be a future unix timestamp'
      });
    }

    const beneficiaryData = toSharesBps(Array.isArray(payload.beneficiaries) ? payload.beneficiaries : []);
    if (beneficiaryData.addresses.length === 0) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'At least one valid beneficiary with walletAddress and share is required, and total shares must equal 100%'
      });
    }

    const executorAddress = normalizeWalletAddress(
      payload.executorAddress || payload.executorWalletAddress || payload.executor?.address
    );
    if (!executorAddress) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'A valid executorAddress is required'
      });
    }

    const executorEmail = String(payload.executorEmail || '').trim();
    if (!isValidEmail(executorEmail)) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'A valid executorEmail is required'
      });
    }

    const witnessesInput = Array.isArray(payload.witnesses)
      ? payload.witnesses
      : [
          {
            name: payload.witness1Name,
            address: payload.witness1Address,
            signature: payload.witness1Signature
          },
          {
            name: payload.witness2Name,
            address: payload.witness2Address,
            signature: payload.witness2Signature
          }
        ];

    const witnesses = witnessesInput
      .map((w) => ({
        name: String(w?.name || '').trim(),
        address: String(w?.address || '').trim(),
        signature: String(w?.signature || '').trim()
      }))
      .filter((w) => w.name || w.address || w.signature);

    if (!witnesses.length) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'At least one witness is required.'
      });
    }

    const invalidWitness = witnesses.find((w) => !w.name || !w.address || !w.signature);
    if (invalidWitness) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Each witness must include name, address, and signature.'
      });
    }

    const { cid, metadata } = await persistWillMetadataOnIpfs({
      ...payload,
      witnesses,
      id: willId
    });

    const { provider, wallet, contract, balance } = await getDigitalWillSignerAndContract();
    
    // Proactive balance check to prevent "could not coalesce" errors from failed gas estimation
    const autoFundAmountWei = deriveAutoFundAmountWei(payload);
    const minRequiredWei = autoFundAmountWei + ethers.parseEther('0.005'); // buffer for gas
    
    if (balance < minRequiredWei) {
      return res.status(400).json({
        status: 'ERROR',
        message: `Insufficient testnet ETH balance. Needed at least ${ethers.formatEther(minRequiredWei)} ETH but only have ${ethers.formatEther(balance)} ETH.`
      });
    }

    const nonceRef = {
      value: await provider.getTransactionCount(wallet.address, 'pending')
    };

    const primaryBeneficiary = beneficiaryData.addresses[0];

    // Hardcode gasLimit for Sepolia to bypass estimation failures ("could not coalesce" source)
    const gasLimit = 500000;

    const createReceipt = await sendContractTx(
      (nonce) => contract.createWill(willId, primaryBeneficiary, cid, releaseTime, { nonce, gasLimit }),
      provider,
      wallet.address,
      nonceRef
    );

    let setExecutorTxHash = null;
    const setExecutorReceipt = await sendContractTx(
      (nonce) => contract.setExecutor(willId, executorAddress, { nonce, gasLimit }),
      provider,
      wallet.address,
      nonceRef
    );
    setExecutorTxHash = setExecutorReceipt.hash;

    let setBeneficiariesTxHash = null;
    if (beneficiaryData.addresses.length > 1) {
      const setBeneficiariesReceipt = await sendContractTx(
        (nonce) => contract.setBeneficiaries(
          willId,
          beneficiaryData.addresses,
          beneficiaryData.sharesBps,
          { nonce, gasLimit }
        ),
        provider,
        wallet.address,
        nonceRef
      );
      setBeneficiariesTxHash = setBeneficiariesReceipt.hash;
    }

    let fundWillTxHash = null;
    if (autoFundAmountWei > 0n) {
      const fundWillReceipt = await sendContractTx(
        (nonce) => contract.fundWill(willId, { value: autoFundAmountWei, nonce, gasLimit }),
        provider,
        wallet.address,
        nonceRef
      );
      fundWillTxHash = fundWillReceipt.hash;
    }

    const willState = await getWillState(contract, willId);

    const chainRecord = {
      type: 'DIGITAL_WILL',
      timestamp: toIndiaIsoString(),
      willId,
      contractAddress: DIGITAL_WILL_CONTRACT_ADDRESS,
      networkRpc: BLOCKCHAIN_RPC_URL,
      ownerAddress: wallet.address,
      metadataCid: cid,
      primaryTransactionHash: createReceipt.hash,
      setExecutorTransactionHash: setExecutorTxHash,
      setBeneficiariesTransactionHash: setBeneficiariesTxHash,
      fundWillTransactionHash: fundWillTxHash,
      releaseTime: willState.releaseTime,
      executed: willState.executed,
      revoked: willState.revoked,
      beneficiaryCount: willState.beneficiaryCount,
      fundedAmountWei: willState.fundedAmountWei
    };

    saveWillChainRecord(chainRecord);

    const deathConditionSelectedForWorkflow = hasDeathCondition(payload?.conditions);
    let deathWorkflow = null;

    if (deathConditionSelectedForWorkflow) {
      const claim = createDeathClaimRecord({
        willId,
        metadataCid: cid,
        executorEmail: executorEmail,
        beneficiaries: payload?.beneficiaries,
        nominees: payload?.nominees
      });

      const host = req.get('host') || `localhost:${PORT}`;
      const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
      const uploadUrl = `${protocol}://${host}/death-claim/upload?token=${claim.token}`;

      try {
        await sendDeathConditionCreatedEmails(metadata, uploadUrl, claim.claimId);
      } catch (mailError) {
        console.error('[DEATH] Initial death-condition email failed:', mailError.message);
      }

      deathWorkflow = {
        enabled: true,
        claimId: claim.claimId,
        certificateUploadUrl: uploadUrl,
        status: claim.status
      };
    } else {
      try {
        await sendWillCreatedEmail(metadata);
      } catch (mailError) {
        console.error('[EMAIL] Will created notification failed:', mailError.message);
      }
      scheduleWillExecution(willId, willState.releaseTime);
    }

    const warnings = [];
    if (!EMAIL_USER || !EMAIL_PASS) {
      warnings.push('SMTP is not configured. Set EMAIL_USER and EMAIL_PASS to enable real beneficiary emails.');
    }
    if (autoFundAmountWei <= 0n) {
      warnings.push('Auto-funding is disabled. Will execution will fail unless /will/:willId/fund is called before release time.');
    }

    return res.json({
      status: 'SUCCESS',
      message: 'Digital will created and recorded on blockchain',
      willId,
      contractAddress: DIGITAL_WILL_CONTRACT_ADDRESS,
      ownerAddress: wallet.address,
      metadataCid: cid,
      blockchain: {
        createWillTxHash: createReceipt.hash,
        setExecutorTxHash,
        setBeneficiariesTxHash,
        fundWillTxHash,
        ...willState
      },
      scheduled: {
        autoExecution: !deathConditionSelectedForWorkflow,
        releaseTime: willState.releaseTime,
        releaseAtIso: toIndiaIsoString(new Date(Number(willState.releaseTime) * 1000))
      },
      deathWorkflow,
      funding: {
        autoFundEnabled: autoFundAmountWei > 0n,
        fundedAmountWei: String(autoFundAmountWei),
        fundedAmountEth: ethers.formatEther(autoFundAmountWei)
      },
      warnings
    });
  } catch (error) {
    console.error('CRITICAL: Create will on-chain error caught in route:');
    console.error('- Message:', error.message);
    console.error('- Code:', error.code);
    console.error('- Data:', error.data);
    console.error('- Error Detail:', JSON.stringify(error, null, 2));
    
    return res.status(500).json({
      status: 'ERROR',
      message: formatBlockchainError(error)
    });
  }
});

app.get('/death-claim/upload', (req, res) => {
  const token = String(req.query?.token || '').trim();
  const claim = getDeathClaimByToken(token);
  if (!claim) {
    return res.status(404).send('<h3>Invalid or expired death-claim link.</h3>');
  }

  const html = `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>TrustChain Death Certificate Upload</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 16px; }
        .card { border: 1px solid #ddd; border-radius: 10px; padding: 24px; }
        label { display:block; margin: 12px 0 6px; font-weight: 600; }
        button { margin-top: 16px; padding: 10px 16px; border: none; border-radius: 6px; background: #2f6fed; color: #fff; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>Death Certificate Upload</h2>
        <p>Claim ID: <strong>${escapeHtml(claim.claimId)}</strong></p>
        <p>Upload the death certificate and click Submit. This will notify the executor for approval.</p>
        <form action="/death-claim/upload" method="post" enctype="multipart/form-data">
          <input type="hidden" name="token" value="${escapeHtml(token)}" />
          <label for="deathCertificate">Death Certificate (PDF/DOCX/JPG/PNG)</label>
          <input id="deathCertificate" name="deathCertificate" type="file" required />
          <button type="submit">Submit Death Certificate</button>
        </form>
      </div>
    </body>
  </html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});

app.post('/death-claim/upload', deathCertificateUpload.single('deathCertificate'), async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const claim = getDeathClaimByToken(token);
    if (!claim) {
      return res.status(404).send('<h3>Invalid or expired death-claim link.</h3>');
    }

    if (!req.file) {
      return res.status(400).send('<h3>No file uploaded. Please attach a certificate and submit again.</h3>');
    }

    const updatedClaim = updateDeathClaimByToken(token, (existing) => ({
      ...existing,
      status: 'PENDING_EXECUTOR_APPROVAL',
      certificateFileName: req.file.originalname,
      certificateFilePath: req.file.path,
      uploadedAt: toIndiaIsoString()
    }));

    if (updatedClaim?.metadataCid && ipfsInstance) {
      try {
        const metadata = JSON.parse((await ipfs.getFile(updatedClaim.metadataCid)).toString('utf8'));
        const host = req.get('host') || `localhost:${PORT}`;
        const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
        const approveUrl = `${protocol}://${host}/death-claim/approve?token=${token}`;
        const certificatePublicUrl = `${protocol}://${host}/uploads/${encodeURIComponent(req.file.filename)}`;
        await sendExecutorApprovalEmail(
          metadata,
          approveUrl,
          updatedClaim.claimId,
          token,
          req.file.originalname,
          req.file.path,
          certificatePublicUrl
        );
      } catch (mailErr) {
        console.error('[DEATH] Executor approval email failed:', mailErr.message);
      }
    }

    return res.send(`
      <h3>Certificate uploaded successfully.</h3>
      <p>Status: <strong>Waiting for executor approval</strong></p>
      <p>Claim ID: <strong>${escapeHtml(updatedClaim?.claimId || 'N/A')}</strong></p>
      <p>Token: <strong>${escapeHtml(token)}</strong></p>
      <p>The executor has received an email with certificate details and a <strong>Release Will</strong> button.</p>
    `);
  } catch (error) {
    return res.status(500).send(`<h3>Upload failed: ${escapeHtml(error.message)}</h3>`);
  }
});

app.get('/death-claim/approve', async (req, res) => {
  try {
    const token = String(req.query?.token || '').trim();
    const claim = getDeathClaimByToken(token);
    if (!claim) {
      return res.status(404).send('<h3>Invalid approval link.</h3>');
    }

    if (claim.status === 'APPROVED') {
      return res.send('<h3>This death claim has already been approved.</h3>');
    }

    if (claim.status !== 'PENDING_EXECUTOR_APPROVAL') {
      return res.status(400).send('<h3>Death certificate is not uploaded yet or still processing. Upload certificate first, then approve release.</h3>');
    }

    let execution = await executeWillAndNotify(claim.willId, 'death-approval');

    if (execution.status === 'SKIPPED' && execution.reason === 'Release time not reached yet') {
      const releaseTime = Number(execution?.will?.releaseTime || 0);
      const now = Math.floor(Date.now() / 1000);
      const waitSeconds = Math.max(0, releaseTime - now);

      if (waitSeconds <= 15) {
        await new Promise((resolve) => setTimeout(resolve, (waitSeconds + 1) * 1000));
        execution = await executeWillAndNotify(claim.willId, 'death-approval');
      }
    }

    if (execution.status !== 'EXECUTED') {
      return res.status(400).send(`<h3>Approval could not execute will: ${escapeHtml(execution.reason || 'Unknown reason')}</h3>`);
    }

    updateDeathClaimByToken(token, (existing) => ({
      ...existing,
      status: 'APPROVED',
      approvedAt: toIndiaIsoString(),
      executionTxHash: execution.txHash
    }));

    return res.send('<h3>Will approved and released successfully. Final data emails have been sent.</h3>');
  } catch (error) {
    return res.status(500).send(`<h3>Approval failed: ${escapeHtml(formatBlockchainError(error))}</h3>`);
  }
});

app.get('/will/:willId', async (req, res) => {
  try {
    const willId = String(req.params.willId || '').trim();
    if (!willId) {
      return res.status(400).json({ status: 'ERROR', message: 'willId is required' });
    }

    const { contract } = await getDigitalWillSignerAndContract();
    const willState = await getWillState(contract, willId);
    return res.json({ status: 'SUCCESS', will: willState });
  } catch (error) {
    return res.status(500).json({ status: 'ERROR', message: formatBlockchainError(error) });
  }
});

app.post('/will/:willId/fund', async (req, res) => {
  try {
    const willId = String(req.params.willId || '').trim();
    const amountWei = parsePositiveWeiOrEth(req.body || {});
    if (!willId) {
      return res.status(400).json({ status: 'ERROR', message: 'willId is required' });
    }
    if (!amountWei) {
      return res.status(400).json({ status: 'ERROR', message: 'amountEth or amountWei must be provided and greater than 0' });
    }

    const { provider, wallet, contract } = await getDigitalWillSignerAndContract();
    const nonceRef = {
      value: await provider.getTransactionCount(wallet.address, 'pending')
    };

    const receipt = await sendContractTx(
      (nonce) => contract.fundWill(willId, { value: amountWei, nonce }),
      provider,
      wallet.address,
      nonceRef
    );

    const willState = await getWillState(contract, willId);
    return res.json({
      status: 'SUCCESS',
      message: 'Will funded successfully',
      txHash: receipt.hash,
      fundedAmountWei: String(amountWei),
      fundedAmountEth: ethers.formatEther(amountWei),
      will: willState
    });
  } catch (error) {
    return res.status(500).json({ status: 'ERROR', message: formatBlockchainError(error) });
  }
});

app.post('/will/:willId/execute', async (req, res) => {
  try {
    const willId = String(req.params.willId || '').trim();
    if (!willId) {
      return res.status(400).json({ status: 'ERROR', message: 'willId is required' });
    }

    clearScheduledWillExecution(willId);
    const execution = await executeWillAndNotify(willId, 'manual');

    if (execution.status === 'SKIPPED') {
      if (execution.reason === 'Release time not reached yet') {
        scheduleWillExecution(willId, execution.will.releaseTime);
      }
      return res.status(400).json({
        status: 'ERROR',
        message: execution.reason,
        will: execution.will
      });
    }

    return res.json({
      status: 'SUCCESS',
      message: 'Will executed successfully',
      txHash: execution.txHash,
      will: execution.will,
      email: execution.email
    });
  } catch (error) {
    return res.status(500).json({ status: 'ERROR', message: formatBlockchainError(error) });
  }
});

app.post('/will/:willId/revoke', async (req, res) => {
  try {
    const willId = String(req.params.willId || '').trim();
    if (!willId) {
      return res.status(400).json({ status: 'ERROR', message: 'willId is required' });
    }

    clearScheduledWillExecution(willId);

    const { provider, wallet, contract } = await getDigitalWillSignerAndContract();
    const nonceRef = {
      value: await provider.getTransactionCount(wallet.address, 'pending')
    };

    const receipt = await sendContractTx(
      (nonce) => contract.revokeWill(willId, { nonce }),
      provider,
      wallet.address,
      nonceRef
    );

    const willState = await getWillState(contract, willId);
    return res.json({
      status: 'SUCCESS',
      message: 'Will revoked successfully',
      txHash: receipt.hash,
      will: willState
    });
  } catch (error) {
    return res.status(500).json({ status: 'ERROR', message: formatBlockchainError(error) });
  }
});

const server = app.listen(PORT, async () => {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 TrustChain Backend Server Started");
  console.log("=".repeat(60));
  console.log(`✓ Server: http://localhost:${PORT}`);
  console.log(`✓ ML Service: ${ML_SERVICE_URL}`);
  
  // Initialize IPFS after server starts
  ipfsInstance = await ipfs.init();
  if (ipfsInstance) {
    console.log(`✓ IPFS: Running (Helia)`);
  } else {
    console.log(`⚠  IPFS: Unavailable (using fallback)`);
  }

  const cleanupSummary = await cleanupStaleWillRecordsAgainstChain();
  if (cleanupSummary.removed > 0) {
    console.log(`[CLEANUP] Archived and removed ${cleanupSummary.removed} stale record(s) from previous blockchain session(s)`);
  }

  await recoverWillSchedulesFromRecordsSafe();
  
  let blockchainStatus = 'Ready';
  try {
    const { wallet, balance } = await getDigitalWillSignerAndContract();
    blockchainStatus = `Ready (Wallet: ${wallet.address}, Balance: ${ethers.formatEther(balance)} ETH)`;
  } catch (error) {
    blockchainStatus = `Error (${error.message})`;
  }

  console.log(`✓ Blockchain: ${blockchainStatus}`);
  console.log(`✓ Uploads: ${uploadsDir}`);
  console.log("=".repeat(60));
  console.log("\n📋 API Endpoints:");
  console.log(`  POST   /verify - Complete Verification Flow`);
  console.log(`  GET    /health - Health Check`);
  console.log(`  GET    /cid-records - CID Storage Records`);
  console.log(`  GET    /api/verification-records - Verification Records`);
  console.log(`  GET    /api/blockchain-records - Blockchain Records`);
  console.log(`  POST   /create-will - Create Digital Will On-Chain`);
  console.log(`  GET    /will/:willId - Will Status`);
  console.log(`  POST   /will/:willId/fund - Fund Will`);
  console.log(`  POST   /will/:willId/execute - Execute Will`);
  console.log(`  POST   /will/:willId/revoke - Revoke Will`);
  console.log(`  POST   /upload - Upload Files`);
  console.log(`  GET    /files - List Files`);
  console.log("\n🔄 Verification Flow:");
  console.log(`  1. Extract Document Text (PDF/DOCX)`);
  console.log(`  2. Send to ML Model`);
  console.log(`  3. ML Classification (Real/Fake)`);
  console.log(`  4. Generate SHA-256 Hash`);
  console.log(`  5. Upload to IPFS`);
  console.log(`  6. Store on Blockchain`);
  console.log(`  7. Create Verification Record`);
  console.log("\n" + "=".repeat(60));
  console.log("✅ Ready to receive requests!");
  console.log("=".repeat(60) + "\n");
});

// Cleanup: Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await ipfs.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await ipfs.stop();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  if (isIgnorableRuntimeError(error)) {
    console.warn(`[RUNTIME] Ignored non-fatal exception: ${error.message}`);
    return;
  }

  console.error('[RUNTIME] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  if (isIgnorableRuntimeError(reason)) {
    const msg = reason?.message || String(reason);
    console.warn(`[RUNTIME] Ignored non-fatal rejection: ${msg}`);
    return;
  }

  console.error('[RUNTIME] Unhandled rejection:', reason);
  process.exit(1);
});
