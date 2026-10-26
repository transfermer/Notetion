/**
 * Offline sync engine for Notetion.
 * Manages the pending write queue and syncs with the server when online.
 */

import type { Note, Folder } from './api';
import {
  getPendingWrites,
  removePendingWrite,
  incrementPendingAttempts,
  cacheNote,
  cacheFolder,
  type OfflineNote,
  type OfflineFolder,
} from './db';

export interface SyncState {
  syncing: boolean;
  lastSyncAt: number | null;
  pendingCount: number;
  error: string | null;
}

let syncState: SyncState = {
  syncing: false,
  lastSyncAt: null,
  pendingCount: 0,
  error: null,
};

const listeners = new Set<(state: SyncState) => void>();

export function onSyncStateChange(fn: (state: SyncState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => fn(syncState));
}

export function getSyncState(): SyncState {
  return syncState;
}

/**
 * Enqueue a write operation for later sync.
 * Called when offline or when optimistic update is needed.
 */
export async function enqueueNoteWrite(
  method: 'POST' | 'PATCH' | 'DELETE',
  noteId: string | null,
  body: unknown,
): Promise<void> {
  const path = noteId ? `/api/notes/${noteId}` : '/api/notes';
  await import('./db').then(({ enqueueWrite }) =>
    enqueueWrite({ type: 'note', method, path, body }),
  );
  syncState.pendingCount = (await getPendingWrites()).length;
  emit();
  // Try to sync immediately if online.
  if (navigator.onLine) {
    void syncPendingWrites();
  }
}

export async function enqueueFolderWrite(
  method: 'POST' | 'PATCH' | 'DELETE',
  folderId: string | null,
  body: unknown,
): Promise<void> {
  const path = folderId ? `/api/folders/${folderId}` : '/api/folders';
  await import('./db').then(({ enqueueWrite }) =>
    enqueueWrite({ type: 'folder', method, path, body }),
  );
  syncState.pendingCount = (await getPendingWrites()).length;
  emit();
  if (navigator.onLine) {
    void syncPendingWrites();
  }
}

/**
 * Sync all pending writes with the server.
 */
export async function syncPendingWrites(): Promise<void> {
  if (syncState.syncing || !navigator.onLine) return;

  syncState.syncing = true;
  syncState.error = null;
  emit();

  try {
    const writes = await getPendingWrites();
    let synced = 0;

    for (const write of writes) {
      try {
        let response: Response;
        const headers: Record<string, string> = {};
        if (write.body) {
          headers['Content-Type'] = 'application/json';
        }

        if (write.method === 'POST') {
          response = await fetch(write.path, {
            method: 'POST',
            headers,
            body: write.body ? JSON.stringify(write.body) : undefined,
            credentials: 'same-origin',
          });
        } else if (write.method === 'PATCH') {
          response = await fetch(write.path, {
            method: 'PATCH',
            headers,
            body: write.body ? JSON.stringify(write.body) : undefined,
            credentials: 'same-origin',
          });
        } else if (write.method === 'DELETE') {
          response = await fetch(write.path, {
            method: 'DELETE',
            credentials: 'same-origin',
          });
        } else {
          continue;
        }

        if (response.ok) {
          await removePendingWrite(write.id);
          synced++;
        } else {
          // If conflict (409), mark as failed but don't retry.
          if (response.status === 409) {
            await removePendingWrite(write.id);
            console.warn('[sync] Conflict detected, dropping write', write);
          } else {
            await incrementPendingAttempts(write.id);
            console.warn('[sync] Write failed', response.status, write);
          }
        }
      } catch (err) {
        console.error('[sync] Write error', err);
        await incrementPendingAttempts(write.id);
      }
    }

    syncState.lastSyncAt = Date.now();
    syncState.pendingCount = (await getPendingWrites()).length;
  } catch (err) {
    syncState.error = err instanceof Error ? err.message : String(err);
  } finally {
    syncState.syncing = false;
    emit();
  }
}

/**
 * Cache a note locally for offline access.
 */
export async function cacheNoteLocally(note: Note, accountId: string): Promise<void> {
  const offline: OfflineNote = {
    ...note,
    account_id: accountId,
    dirty: false,
  };
  await cacheNote(offline);
}

/**
 * Cache a folder locally for offline access.
 */
export async function cacheFolderLocally(folder: Folder, accountId: string): Promise<void> {
  const offline: OfflineFolder = {
    ...folder,
    account_id: accountId,
    dirty: false,
  };
  await cacheFolder(offline);
}

// Listen for online/offline events.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[sync] Online, syncing...');
    void syncPendingWrites();
  });

  window.addEventListener('offline', () => {
    console.log('[sync] Offline');
    syncState.error = 'Offline';
    emit();
  });
}
