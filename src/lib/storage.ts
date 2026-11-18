import { openDB } from 'idb';
import type { ArchiveData } from './types';

const database = () => openDB('claude-local-archive', 1, {
  upgrade(db) { db.createObjectStore('archive'); },
});

export async function loadArchive(): Promise<ArchiveData | undefined> {
  const db = await database();
  try { return await db.get('archive', 'data'); } finally { db.close(); }
}

export async function saveArchive(archive: ArchiveData): Promise<void> {
  const db = await database();
  try { await db.put('archive', archive, 'data'); } finally { db.close(); }
}
