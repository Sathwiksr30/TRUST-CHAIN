import axios from 'axios';
import { toIndiaIsoString } from './timezone';

const STORAGE_KEY = 'trustchain_documents';

function isWill(doc) {
  return String(doc?.type || '').toLowerCase() === 'will';
}

function normalizeWillStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'executed' || normalized === 'success') return 'Successful';
  if (normalized === 'successful') return 'Successful';
  if (normalized === 'revoked') return 'Revoked';
  return 'Pending';
}

function statusFromChain(willState) {
  if (willState?.revoked) return 'Revoked';
  if (willState?.executed) return 'Successful';
  return 'Pending';
}

export async function syncWillStatuses(apiBase, currentUser) {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  let changed = false;

  const updated = await Promise.all(stored.map(async (doc) => {
    if (!isWill(doc)) return doc;
    if (currentUser && doc.owner !== currentUser) return doc;

    const normalizedStatus = normalizeWillStatus(doc.status);
    if (normalizedStatus !== doc.status) {
      changed = true;
      doc = { ...doc, status: normalizedStatus };
    }

    if (!doc.id || normalizedStatus !== 'Pending') {
      return doc;
    }

    try {
      const response = await axios.get(`${apiBase}/will/${encodeURIComponent(doc.id)}`, {
        headers: { 'x-api-key': 'trustchain_dummy_key' }
      });

      const willState = response.data?.will;
      if (!willState) return doc;

      const nextStatus = statusFromChain(willState);
      if (nextStatus === normalizedStatus) {
        return {
          ...doc,
          blockchain: {
            ...(doc.blockchain || {}),
            ...willState
          }
        };
      }

      changed = true;
      return {
        ...doc,
        status: nextStatus,
        blockchain: {
          ...(doc.blockchain || {}),
          ...willState
        },
        lastSyncedAt: toIndiaIsoString()
      };
    } catch {
      return doc;
    }
  }));

  if (changed) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }

  return updated;
}

export function getStoredDocuments() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}
