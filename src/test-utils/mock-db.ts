import { vi } from "vitest";

/**
 * Reset the db.ts module-level `dbPromise` singleton by re-importing.
 * Each call isolates IndexedDB state between tests.
 */
export async function resetDatabase() {
  // Delete the database to start fresh
  const { DB_NAME } = await import("@/core/constants");
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

/**
 * Reset db module cache so openDb() creates a new connection.
 */
export async function resetDbModule() {
  vi.resetModules();
}
