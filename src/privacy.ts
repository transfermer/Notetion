/**
 * Removing private data from this device.
 *
 * Notes live in three client-side places besides memory: the Service Worker's
 * CacheStorage, and IndexedDB (offline cache + queued writes). All of them must
 * be wiped on logout, otherwise the next person using the browser can read them.
 */
import { clearAllLocalStores } from "./db";

/** Drop every CacheStorage cache (page side + ask the active Service Worker to do the same). */
export async function wipeCaches(): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_CACHES" });
  } catch {
    /* best effort */
  }
}

/** Full wipe for logout: caches + IndexedDB. */
export async function wipeLocalData(): Promise<void> {
  await Promise.allSettled([wipeCaches(), clearAllLocalStores()]);
}
