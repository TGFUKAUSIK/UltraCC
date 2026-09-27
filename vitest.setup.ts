import 'fake-indexeddb/auto';

// Ensure the window object (happy-dom global) exposes the fake IndexedDB so
// src/lib/db/vtopDatabase.ts behaves like in a real browser.
if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
  (window as any).indexedDB = indexedDB;
  (window as any).IDBKeyRange = IDBKeyRange;
}
