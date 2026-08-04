import {strFromU8, strToU8, unzip, zip} from "fflate";
import type {
  CanvasImageAssetSnapshot,
  CanvasNodeSnapshot,
  CanvasSnapshot,
} from "../../canvas";
import type {StoredResultImage} from "../../domain/models";
import {
  loadStoredResultImages,
  replaceStoredResultImages,
} from "../history";
import {
  loadAllCanvasDocuments,
  replaceAllCanvasDocuments,
  type StoredCanvasDocument,
} from "../canvas-storage";

const BACKUP_DB_NAME = "gugle-ai-backups";
const BACKUP_STORE_NAME = "archives";
const BACKUP_DB_VERSION = 1;
const BACKUP_FORMAT_VERSION = 1;

export type BackupKind = "manual" | "automatic";

export function backupArchiveName(kind: BackupKind, createdAt: number): string {
  return `${kind === "automatic" ? "gugle-ai-auto" : "gugle-ai-manual"}-${formatBackupTimestamp(createdAt)}.zip`;
}

export interface BackupMetadata {
  id: string;
  name: string;
  kind: BackupKind;
  createdAt: number;
  size: number;
}

export interface StoredBackup extends BackupMetadata {
  blob: Blob;
}

export interface BackupContents {
  localStorage: Record<string, string>;
  resultImages: StoredResultImage[];
  canvases: StoredCanvasDocument[];
}

interface BackupManifest {
  app: "gugle-ai";
  formatVersion: 1;
  createdAt: number;
  resultImageCount: number;
  canvasCount: number;
}

let databasePromise: Promise<IDBDatabase> | null = null;

export async function createBackupArchive(): Promise<Blob> {
  const resultImages = await loadStoredResultImages();
  const canvases = await loadAllCanvasDocuments();
  const files: Record<string, Uint8Array> = {
    "local-storage.json": strToU8(JSON.stringify(readLocalStorage())),
  };
  const imageIndex: Array<Omit<StoredResultImage, "blob"> & {blobPath: string}> = [];
  for (const image of resultImages) {
    const blobPath = `history/${encodeURIComponent(image.id)}.bin`;
    files[blobPath] = new Uint8Array(await image.blob.arrayBuffer());
    imageIndex.push({
      id: image.id,
      mime: image.mime,
      prompt: image.prompt,
      createdAt: image.createdAt,
      blobPath,
    });
  }
  files["history/index.json"] = strToU8(JSON.stringify(imageIndex));

  const canvasIndex: Array<{id: string; documentPath: string}> = [];
  for (const document of canvases) {
    const documentPath = `canvases/${encodeURIComponent(document.id)}.json`;
    const snapshot = await serializeCanvasSnapshot(document.snapshot, files, document.id);
    files[documentPath] = strToU8(JSON.stringify({...document, snapshot}));
    canvasIndex.push({id: document.id, documentPath});
  }
  files["canvases/index.json"] = strToU8(JSON.stringify(canvasIndex));
  const manifest: BackupManifest = {
    app: "gugle-ai",
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: Date.now(),
    resultImageCount: resultImages.length,
    canvasCount: canvases.length,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  return new Blob([await zipArchive(files)], {type: "application/zip"});
}

export async function readBackupArchive(blob: Blob): Promise<BackupContents> {
  const archive = await unzipArchive(new Uint8Array(await blob.arrayBuffer()));
  const manifest = readJson<BackupManifest>(archive, "manifest.json");
  if (
    manifest.app !== "gugle-ai"
    || manifest.formatVersion !== BACKUP_FORMAT_VERSION
    || !Number.isFinite(manifest.createdAt)
  ) {
    throw new Error("不是受支持的 GugleAI 备份文件");
  }
  const localStorage = readJson<Record<string, string>>(archive, "local-storage.json");
  if (!localStorage || typeof localStorage !== "object" || Array.isArray(localStorage)) {
    throw new Error("备份中的设置数据无效");
  }
  const imageIndex = readJson<Array<Omit<StoredResultImage, "blob"> & {blobPath: string}>>(
      archive,
      "history/index.json"
  );
  const resultImages = imageIndex.map((item) => ({
    id: item.id,
    mime: item.mime,
    prompt: item.prompt ?? "",
    createdAt: item.createdAt,
    blob: blobFromArchive(archive, item.blobPath, item.mime),
  }));

  const canvasIndex = readJson<Array<{id: string; documentPath: string}>>(
      archive,
      "canvases/index.json"
  );
  const canvases: StoredCanvasDocument[] = [];
  for (const item of canvasIndex) {
    const document = readJson<StoredCanvasDocument>(archive, item.documentPath);
    canvases.push({
      ...document,
      snapshot: await restoreCanvasSnapshot(document.snapshot, archive, document.id),
    });
  }
  return {localStorage, resultImages, canvases};
}

export async function restoreBackupContents(contents: BackupContents): Promise<void> {
  validateBackupContents(contents);
  await replaceStoredResultImages(contents.resultImages);
  await replaceAllCanvasDocuments(contents.canvases);
  localStorage.clear();
  for (const [key, value] of Object.entries(contents.localStorage)) {
    if (typeof value === "string") localStorage.setItem(key, value);
  }
}

export async function listBackups(): Promise<BackupMetadata[]> {
  const database = await openBackupDatabase();
  const transaction = database.transaction(BACKUP_STORE_NAME, "readonly");
  const completed = waitForTransaction(transaction);
  const request = transaction.objectStore(BACKUP_STORE_NAME).getAll();
  await completed;
  return (request.result as StoredBackup[])
      .filter((item) => isStoredBackup(item))
      .map(({id, name, kind, createdAt, size}) => ({id, name, kind, createdAt, size}))
      .sort((left, right) => right.createdAt - left.createdAt);
}

export async function getBackup(id: string): Promise<StoredBackup | null> {
  const database = await openBackupDatabase();
  const transaction = database.transaction(BACKUP_STORE_NAME, "readonly");
  const completed = waitForTransaction(transaction);
  const request = transaction.objectStore(BACKUP_STORE_NAME).get(id);
  await completed;
  return isStoredBackup(request.result) ? request.result : null;
}

export async function putBackup(
    blob: Blob,
    kind: BackupKind,
    retentionCount: number
): Promise<BackupMetadata> {
  const createdAt = Date.now();
  const backup: StoredBackup = {
    id: globalThis.crypto?.randomUUID?.() ?? `backup-${createdAt}-${Math.random().toString(36).slice(2)}`,
    name: backupArchiveName(kind, createdAt),
    kind,
    createdAt,
    size: blob.size,
    blob,
  };
  const database = await openBackupDatabase();
  const transaction = database.transaction(BACKUP_STORE_NAME, "readwrite");
  const completed = waitForTransaction(transaction);
  transaction.objectStore(BACKUP_STORE_NAME).put(backup);
  await completed;
  if (kind === "automatic") await pruneAutomaticBackups(retentionCount);
  return {
    id: backup.id,
    name: backup.name,
    kind: backup.kind,
    createdAt: backup.createdAt,
    size: backup.size,
  };
}

export async function deleteBackup(id: string): Promise<void> {
  const database = await openBackupDatabase();
  const transaction = database.transaction(BACKUP_STORE_NAME, "readwrite");
  const completed = waitForTransaction(transaction);
  transaction.objectStore(BACKUP_STORE_NAME).delete(id);
  await completed;
}

export async function pruneAutomaticBackups(retentionCount: number): Promise<void> {
  const keep = Math.max(1, Math.trunc(retentionCount) || 1);
  const database = await openBackupDatabase();
  const transaction = database.transaction(BACKUP_STORE_NAME, "readwrite");
  const completed = waitForTransaction(transaction);
  const store = transaction.objectStore(BACKUP_STORE_NAME);
  const request = store.getAll();
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const automatic = (request.result as StoredBackup[])
          .filter((item) => item?.kind === "automatic")
          .sort((left, right) => right.createdAt - left.createdAt);
      for (const item of automatic.slice(keep)) store.delete(item.id);
      resolve();
    };
    request.onerror = () => reject(request.error ?? new Error("读取备份列表失败"));
  });
  await completed;
}

function readLocalStorage(): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key) values[key] = localStorage.getItem(key) ?? "";
  }
  return values;
}

async function serializeCanvasSnapshot(
    snapshot: CanvasSnapshot,
    files: Record<string, Uint8Array>,
    canvasId: string
): Promise<CanvasSnapshot> {
  const nodes: CanvasNodeSnapshot[] = [];
  for (const node of snapshot.nodes) {
    nodes.push({
      ...node,
      data: {
        ...node.data,
        references: await serializeAssets(node.data.references, files, canvasId),
        outputs: await serializeAssets(node.data.outputs, files, canvasId),
      },
    });
  }
  return {...snapshot, nodes};
}

async function serializeAssets(
    assets: CanvasImageAssetSnapshot[],
    files: Record<string, Uint8Array>,
    canvasId: string
): Promise<Array<CanvasImageAssetSnapshot & {blobPath: string}>> {
  const result: Array<CanvasImageAssetSnapshot & {blobPath: string}> = [];
  for (const asset of assets) {
    const blobPath = `canvases/${encodeURIComponent(canvasId)}/assets/${encodeURIComponent(asset.id)}.bin`;
    files[blobPath] = new Uint8Array(await asset.blob.arrayBuffer());
    result.push({...asset, blob: undefined as never, blobPath});
  }
  return result;
}

async function restoreCanvasSnapshot(
    snapshot: CanvasSnapshot,
    archive: Record<string, Uint8Array>,
    canvasId: string
): Promise<CanvasSnapshot> {
  const nodes = snapshot.nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      references: restoreAssets(node.data.references, archive, canvasId),
      outputs: restoreAssets(node.data.outputs, archive, canvasId),
    },
  }));
  return {...snapshot, nodes};
}

function restoreAssets(
    assets: Array<CanvasImageAssetSnapshot & {blobPath?: string}>,
    archive: Record<string, Uint8Array>,
    canvasId: string
): CanvasImageAssetSnapshot[] {
  return assets.map((asset) => {
    const blobPath = asset.blobPath
        ?? `canvases/${encodeURIComponent(canvasId)}/assets/${encodeURIComponent(asset.id)}.bin`;
    return {
      id: asset.id,
      mime: asset.mime,
      name: asset.name,
      blob: blobFromArchive(archive, blobPath, asset.mime),
    };
  });
}

function blobFromArchive(archive: Record<string, Uint8Array>, path: string, mime: string): Blob {
  const bytes = archive[path];
  if (!bytes) throw new Error(`备份缺少图片数据: ${path}`);
  return new Blob([bytes], {type: mime || "application/octet-stream"});
}

function readJson<T>(archive: Record<string, Uint8Array>, path: string): T {
  const bytes = archive[path];
  if (!bytes) throw new Error(`备份缺少文件: ${path}`);
  try {
    return JSON.parse(strFromU8(bytes)) as T;
  } catch {
    throw new Error(`备份文件无效: ${path}`);
  }
}

function validateBackupContents(contents: BackupContents): void {
  if (!contents || typeof contents !== "object") throw new Error("备份内容无效");
  if (!Array.isArray(contents.resultImages) || !Array.isArray(contents.canvases)) {
    throw new Error("备份数据结构无效");
  }
  for (const image of contents.resultImages) {
    if (!image.id || !(image.blob instanceof Blob)) throw new Error("备份中的预览图片无效");
  }
  for (const canvas of contents.canvases) {
    if (!canvas.id || !canvas.snapshot || !Array.isArray(canvas.snapshot.nodes)) {
      throw new Error("备份中的画布数据无效");
    }
  }
}

function zipArchive(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, {level: 6}, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    });
  });
}

function unzipArchive(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (error, archive) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(archive);
    });
  });
}

function formatBackupTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      + `-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}

function isStoredBackup(value: unknown): value is StoredBackup {
  if (!value || typeof value !== "object") return false;
  const backup = value as Partial<StoredBackup>;
  return typeof backup.id === "string"
      && typeof backup.name === "string"
      && (backup.kind === "manual" || backup.kind === "automatic")
      && Number.isFinite(backup.createdAt)
      && Number.isFinite(backup.size)
      && backup.blob instanceof Blob;
}

function openBackupDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BACKUP_STORE_NAME)) {
        request.result.createObjectStore(BACKUP_STORE_NAME, {keyPath: "id"});
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("无法打开备份数据库"));
    };
  });
  return databasePromise;
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("备份事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("备份事务已取消"));
  });
}
