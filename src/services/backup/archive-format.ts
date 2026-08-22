import type {StoredResultImage} from "../../domain/models";
import type {StoredCanvasDocument} from "../canvas-storage";

export const BACKUP_FORMAT_VERSION = 1;

export interface BackupManifest {
  app: "gugle-ai";
  formatVersion: 1;
  createdAt: number;
  resultImageCount: number;
  canvasCount: number;
}

export interface ArchiveCreateRequest {
  localStorage: Record<string, string>;
  resultImages: StoredResultImage[];
  canvases: StoredCanvasDocument[];
}

export type ArchiveCreateResponse =
    | {ok: true; data: Uint8Array}
    | {ok: false; error: string};
