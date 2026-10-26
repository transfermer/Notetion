/**
 * IndexedDB wrapper for Notetion offline cache.
 * Stores notes, folders, tags, and pending writes for offline editing.
 */

const DB_NAME = 'notetion';
const DB_VERSION = 1;

export interface OfflineNote {
  id: string;
  account_id: string;
  folder_id: string | null;
  title: string;
  content: string;
  version: number;
  favorite: number;
  pinned: number;
  archived: number;
  deleted_at: number | null;
  purge_at: number | null;
  created_at: number;
  updated_at: number;
  /** If true, this note has local changes not yet synced. */
  dirty: boolean;
}

export interface OfflineFolder {
  id: string;
  account_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
  dirty: boolean;
}

export interface PendingWrite {
  id: string;
  type: 'note' | 'folder' | 'file';
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body: unknown;
  created_at: number;
  attempts: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      // Notes store.
      if (!db.objectStoreNames.contains('notes')) {
        const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
        noteStore.createIndex('account_id', 'account_id', { unique: false });
        noteStore.createIndex('updated_at', 'updated_at', { unique: false });
        noteStore.createIndex('dirty', 'dirty', { unique: false });
      }
      // Folders store.
      if (!db.objectStoreNames.contains('folders')) {
        const folderStore = db.createObjectStore('folders', { keyPath: 'id' });
        folderStore.createIndex('account_id', 'account_id', { unique: false });
        folderStore.createIndex('dirty', 'dirty', { unique: false });
      }
      // Pending writes queue.
      if (!db.objectStoreNames.contains('pending_writes')) {
        const pendingStore = db.createObjectStore('pending_writes', { keyPath: 'id' });
        pendingStore.createIndex('created_at', 'created_at', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    if (result instanceof IDBRequest) {
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    } else {
      resolve(result);
    }
    tx.oncomplete = () => {};
    tx.onerror = () => reject(tx.error);
  });
}

// Notes.
export async function cacheNote(note: OfflineNote): Promise<void> {
  await withStore('notes', 'readwrite', (store) => store.put(note));
}

export async function getCachedNote(id: string): Promise<OfflineNote | undefined> {
  return await withStore('notes', 'readonly', (store) => store.get(id));
}

export async function getAllCachedNotes(accountId: string): Promise<OfflineNote[]> {
  return await withStore('notes', 'readonly', (store) => {
    const index = store.index('account_id');
    return new Promise((resolve, reject) => {
      const request = index.getAll(accountId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

export async function getDirtyNotes(): Promise<OfflineNote[]> {
  return await withStore('notes', 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const all = request.result as OfflineNote[];
        resolve(all.filter((n) => n.dirty));
      };
      request.onerror = () => reject(request.error);
    });
  });
}

export async function clearCachedNotes(accountId: string): Promise<void> {
  await withStore('notes', 'readwrite', (store) => {
    return new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          if (cursor.value.account_id === accountId) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  });
}

// Folders.
export async function cacheFolder(folder: OfflineFolder): Promise<void> {
  await withStore('folders', 'readwrite', (store) => store.put(folder));
}

export async function getAllCachedFolders(accountId: string): Promise<OfflineFolder[]> {
  return await withStore('folders', 'readonly', (store) => {
    const index = store.index('account_id');
    return new Promise((resolve, reject) => {
      const request = index.getAll(accountId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

export async function clearCachedFolders(accountId: string): Promise<void> {
  await withStore('folders', 'readwrite', (store) => {
    return new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          if (cursor.value.account_id === accountId) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  });
}

// Pending writes.
export async function enqueueWrite(write: Omit<PendingWrite, 'id' | 'created_at' | 'attempts'>): Promise<void> {
  const pending: PendingWrite = {
    ...write,
    id: crypto.randomUUID(),
    created_at: Date.now(),
    attempts: 0,
  };
  await withStore('pending_writes', 'readwrite', (store) => store.put(pending));
}

export async function getPendingWrites(): Promise<PendingWrite[]> {
  return await withStore('pending_writes', 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

export async function removePendingWrite(id: string): Promise<void> {
  await withStore('pending_writes', 'readwrite', (store) => store.delete(id));
}

export async function incrementPendingAttempts(id: string): Promise<void> {
  const write = await withStore('pending_writes', 'readwrite', (store) => store.get(id));
  if (write) {
    write.attempts += 1;
    await withStore('pending_writes', 'readwrite', (store) => store.put(write));
  }
}

/** Remove every locally cached note/folder and queued write (used on logout). */
export async function clearAllLocalStores(): Promise<void> {
  for (const name of ["notes", "folders", "pending_writes"]) {
    await withStore(name, "readwrite", (store) => store.clear());
  }
}

export async function clearAllPendingWrites(): Promise<void> {
  await withStore('pending_writes', 'readwrite', (store) => store.clear());
}
