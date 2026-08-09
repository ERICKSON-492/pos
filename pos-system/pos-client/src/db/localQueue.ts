/**
 * Offline-first local queue. Every sale is written here FIRST, then a
 * background sync loop pushes it to the backend when connectivity allows.
 * This means a cashier can keep ringing up sales through a network outage
 * without anything blocking or getting lost.
 */

const DB_NAME = "pos-offline";
const STORE = "pending-sales";

export interface PendingSale {
  localId: string; // generated client-side, stable across retries
  payload: {
    items: { productId: string; qty: number }[];
    paymentMethod: "MPESA" | "CARD" | "CASH";
    phoneNumber?: string;
  };
  createdAt: number;
  synced: boolean;
  syncError?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "localId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueSale(sale: PendingSale) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(sale);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getUnsyncedSales(): Promise<PendingSale[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as PendingSale[]).filter((s) => !s.synced));
    req.onerror = () => reject(req.error);
  });
}

export async function markSynced(localId: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.get(localId);
    req.onsuccess = () => {
      const record = req.result as PendingSale;
      if (record) {
        record.synced = true;
        store.put(record);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function markSyncError(localId: string, error: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.get(localId);
    req.onsuccess = () => {
      const record = req.result as PendingSale;
      if (record) {
        record.syncError = error;
        store.put(record);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
