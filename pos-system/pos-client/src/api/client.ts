import axios from "axios";
import { getUnsyncedSales, markSynced, markSyncError, PendingSale } from "../db/localQueue";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000/api";

export const api = axios.create({ baseURL: API_BASE });

export function setAuthToken(token: string) {
  api.defaults.headers.common.Authorization = `Bearer ${token}`;
}

export async function login(email: string, password: string) {
  const { data } = await api.post("/auth/login", { email, password });
  return data;
}

export async function fetchProducts() {
  const { data } = await api.get("/products");
  return data;
}

/**
 * Pushes every unsynced local sale to the backend. Safe to call repeatedly
 * (e.g. every few seconds, or on a "back online" event) — already-synced
 * records are skipped.
 */
export async function syncPendingSales(): Promise<{ synced: number; failed: number }> {
  const pending = await getUnsyncedSales();
  let synced = 0;
  let failed = 0;

  for (const sale of pending) {
    try {
      await api.post("/sales/checkout", sale.payload);
      await markSynced(sale.localId);
      synced++;
    } catch (err: any) {
      await markSyncError(sale.localId, err?.message ?? "sync failed");
      failed++;
    }
  }
  return { synced, failed };
}

export function startSyncLoop(intervalMs = 8000) {
  const tick = () => syncPendingSales().catch(() => {});
  const interval = setInterval(tick, intervalMs);
  window.addEventListener("online", tick);
  return () => {
    clearInterval(interval);
    window.removeEventListener("online", tick);
  };
}
