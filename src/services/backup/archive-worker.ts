import {strToU8, zipSync} from "fflate";
import type {CanvasImageAssetSnapshot, CanvasNodeSnapshot, CanvasSnapshot} from "../../canvas";
import type {StoredResultImage} from "../../domain/models";
import {
  BACKUP_FORMAT_VERSION,
  type ArchiveCreateRequest,
  type ArchiveCreateResponse,
  type BackupManifest,
} from "./archive-format";

// 备份归档构建 Worker:blob 字节拷贝、JSON 序列化和 zip 压缩都在这里执行,避免占用主线程
interface WorkerScope {
  onmessage: ((event: MessageEvent<ArchiveCreateRequest>) => void) | null;
  postMessage(message: ArchiveCreateResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  void buildArchive(event.data)
      .then((data) => {
        scope.postMessage({ok: true, data}, [data.buffer as ArrayBuffer]);
      })
      .catch((reason: unknown) => {
        scope.postMessage({
          ok: false,
          error: reason instanceof Error ? reason.message : String(reason),
        });
      });
};

async function buildArchive(request: ArchiveCreateRequest): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {
    "local-storage.json": strToU8(JSON.stringify(request.localStorage)),
  };
  const imageIndex: Array<Omit<StoredResultImage, "blob"> & {blobPath: string}> = [];
  for (const image of request.resultImages) {
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
  for (const document of request.canvases) {
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
    resultImageCount: request.resultImages.length,
    canvasCount: request.canvases.length,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  return zipSync(files, {level: 6});
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
