/**
 * Browser-side persistence (IndexedDB): projects are saved automatically and
 * survive a page reload. Nothing ever leaves the browser.
 */

import type { Project } from './model';

const DB_NAME = 'gribouillot';
const DB_VERSION = 1;

export interface ProjectSummary {
  id: string;
  name: string;
  mapName: string;
  updatedAt: number;
  layerCount: number;
}

interface ProjectRecord {
  id: string;
  updatedAt: number;
  project: Project;
}

interface FileRecord {
  key: string; // `${projectId}/${name}`
  projectId: string;
  name: string;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('files')) {
          const files = d.createObjectStore('files', { keyPath: 'key' });
          files.createIndex('projectId', 'projectId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: 'projects' | 'files', mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await db()).transaction(name, mode).objectStore(name);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = (await done((await store('projects', 'readonly')).getAll())) as ProjectRecord[];
  return all
    .map((r) => ({
      id: r.id,
      name: r.project.name,
      mapName: r.project.mapName,
      updatedAt: r.updatedAt,
      layerCount: r.project.layers.length,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProject(project: Project): Promise<void> {
  const rec: ProjectRecord = { id: project.id, updatedAt: Date.now(), project };
  await done((await store('projects', 'readwrite')).put(rec));
}

export async function loadProject(id: string): Promise<Project | null> {
  const rec = (await done((await store('projects', 'readonly')).get(id))) as ProjectRecord | undefined;
  return rec?.project ?? null;
}

export async function putFile(projectId: string, name: string, blob: Blob): Promise<void> {
  const rec: FileRecord = { key: `${projectId}/${name}`, projectId, name, blob };
  await done((await store('files', 'readwrite')).put(rec));
}

export async function getFile(projectId: string, name: string): Promise<Blob | null> {
  const rec = (await done((await store('files', 'readonly')).get(`${projectId}/${name}`))) as FileRecord | undefined;
  return rec?.blob ?? null;
}

export async function listFiles(projectId: string): Promise<string[]> {
  const idx = (await store('files', 'readonly')).index('projectId');
  const keys = (await done(idx.getAllKeys(projectId))) as string[];
  return keys.map((k) => k.slice(projectId.length + 1));
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'files'], 'readwrite');
  tx.objectStore('projects').delete(id);
  const idx = tx.objectStore('files').index('projectId');
  const keys = (await done(idx.getAllKeys(id))) as IDBValidKey[];
  for (const k of keys) tx.objectStore('files').delete(k);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Ask the browser not to evict our data when storage runs low. */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not supported: data is still kept, just not guaranteed */
  }
}

const LAST_KEY = 'gribouillot.lastProject';

export function lastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function setLastProjectId(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    /* private mode */
  }
}
