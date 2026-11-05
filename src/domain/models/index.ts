export interface RefImage {
  file: File;
  previewUrl: string;
}

export interface ResultImage {
  id: string;
  blob: Blob;
  mime: string;
  prompt: string;
  previewUrl: string;
  createdAt: number;
}

export interface StoredResultImage {
  id: string;
  blob: Blob;
  mime: string;
  prompt?: string;
  createdAt: number;
}

export interface ResultContextMenuState {
  image: ResultImage;
  x: number;
  y: number;
}

export interface RetryConfig {
  statusCodes: Set<number>;
  maxRetries: number;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  endpoint: string;
  imageEndpoint: string;
  apiKey: string;
  models: ProviderModel[];
}

export interface ProviderModel {
  id: string;
  displayName: string;
  description: string;
  isImage: boolean;
  contextLength: number;
}

export interface ResolvedModel {
  provider: ConnectionProfile;
  model: ProviderModel;
}

export const SETTINGS_KEY = "gugle-ai-settings";
export const DEFAULT_ENDPOINT = "https://api.openai.com/v1";
export const DEFAULT_CONNECTION_ID = "default-openai";
export const DEFAULT_MODEL_OPTIONS = [
  "gpt-image-2",
  "gpt-image-2.6-sunburst",
  "gpt-image-2.6-flare",
  "grok-imagine",
  "grok-imagine-edit",
  "grok-imagine-image",
  "grok-imagine-image-quality",
];
export const DEFAULT_TEXT_MODEL_OPTIONS = [
  "gpt-4o-mini",
  "gpt-4.1-mini",
  "deepseek-chat",
  "claude-3-5-sonnet",
];
export const DEFAULT_CONNECTION_MODELS = [...new Set([
  ...DEFAULT_MODEL_OPTIONS,
  ...DEFAULT_TEXT_MODEL_OPTIONS,
])];
export const DEFAULT_RETRY_STATUS_CODE_OPTIONS = [408, 409, 429, 500, 502, 503, 504, 524];

export function imageExtension(mime: string): string {
  if (mime.includes("gif")) return "gif";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

export function imageMimeFromBytes(bytes: Uint8Array, fallback?: string | null): string {
  // Some relays omit Content-Type or return GIF bytes in b64_json without metadata.
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  return header === "GIF87a" || header === "GIF89a" ? "image/gif" : normalizeImageMime(fallback);
}

export function createConnectionId(): string {
  return globalThis.crypto?.randomUUID?.()
      ?? `connection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function defaultProviderModels(): ProviderModel[] {
  return normalizeProviderModels(DEFAULT_CONNECTION_MODELS);
}

export function normalizeProviderModels(
    value: unknown,
    fallback: string[] = DEFAULT_CONNECTION_MODELS
): ProviderModel[] {
  const source = Array.isArray(value) ? value : fallback;
  const models: ProviderModel[] = [];
  const usedIds = new Set<string>();
  for (const item of source) {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
    const id = typeof item === "string"
        ? item.trim()
        : typeof record?.id === "string"
            ? record.id.trim()
            : "";
    if (!id || usedIds.has(id)) continue;
    const contextLengthValue = Number(record?.contextLength ?? 256000);
    models.push({
      id,
      displayName: typeof record?.displayName === "string" ? record.displayName.trim() : "",
      description: typeof record?.description === "string" ? record.description.trim() : "",
      isImage: typeof record?.isImage === "boolean"
          ? record.isImage
          : DEFAULT_MODEL_OPTIONS.includes(id),
      contextLength: Number.isInteger(contextLengthValue) && contextLengthValue > 0
          ? contextLengthValue
          : 256000,
    });
    usedIds.add(id);
  }
  return models;
}

export function normalizeConnectionProfiles(
    value: unknown,
    fallbackModels = DEFAULT_CONNECTION_MODELS
): ConnectionProfile[] {
  if (!Array.isArray(value)) return [];
  const profiles: ConnectionProfile[] = [];
  const usedIds = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const endpoint = typeof record.endpoint === "string" ? record.endpoint.trim() : "";
    const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
    if (!endpoint) continue;
    let id = typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : createConnectionId();
    if (usedIds.has(id)) id = createConnectionId();
    profiles.push({
      id,
      name: typeof record.name === "string" && record.name.trim()
          ? record.name.trim()
          : providerNameFromEndpoint(endpoint, profiles.length + 1),
      endpoint,
      imageEndpoint: typeof record.imageEndpoint === "string" ? record.imageEndpoint.trim() : "",
      apiKey,
      models: normalizeProviderModels(record.models, fallbackModels),
    });
    usedIds.add(id);
  }
  return profiles;
}

export function providerNameFromEndpoint(endpoint: string, index: number): string {
  try {
    return new URL(endpoint).hostname || `提供商 ${index}`;
  } catch {
    return `提供商 ${index}`;
  }
}

export function modelSelectionKey(providerId: string, modelId: string): string {
  return `${encodeURIComponent(providerId)}|${encodeURIComponent(modelId)}`;
}

export function resolveModelSelection(
    value: string,
    profiles: ConnectionProfile[]
): ResolvedModel | null {
  const separator = value.indexOf("|");
  if (separator < 0) return null;
  let providerId = "";
  let modelId = "";
  try {
    providerId = decodeURIComponent(value.slice(0, separator));
    modelId = decodeURIComponent(value.slice(separator + 1));
  } catch {
    return null;
  }
  const provider = profiles.find((item) => item.id === providerId);
  const model = provider?.models.find((item) => item.id === modelId);
  return provider && model ? {provider, model} : null;
}

export function modelDisplayName(model: ProviderModel): string {
  return model.displayName || model.id;
}

export function resolvedModelLabel(resolved: ResolvedModel): string {
  return `${modelDisplayName(resolved.model)} · ${resolved.provider.name}`;
}

export function normalizeModelOptions(value: unknown): string[] {
  const saved = Array.isArray(value)
      ? value.filter((option): option is string => typeof option === "string" && option.trim().length > 0)
      : [];
  return [...new Set([...DEFAULT_MODEL_OPTIONS, ...saved.map((option) => option.trim())])];
}

export function normalizeTextModelOptions(value: unknown): string[] {
  const saved = Array.isArray(value)
      ? value.filter((option): option is string => typeof option === "string" && option.trim().length > 0)
      : [];
  return [...new Set([...DEFAULT_TEXT_MODEL_OPTIONS, ...saved.map((option) => option.trim())])];
}

export function normalizeStatusCodes(value: unknown): number[] | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const codes = parsed.filter(
      (code): code is number => Number.isInteger(code) && code >= 100 && code <= 599
  );
  return codes.length === parsed.length ? [...new Set(codes)].sort((a, b) => a - b) : null;
}

export function normalizeImageMime(mime: string | null | undefined): string {
  const normalized = mime?.split(";", 1)[0].trim().toLowerCase() ?? "";
  return normalized.startsWith("image/") ? normalized : "image/png";
}

export function createResultId(): string {
  return globalThis.crypto?.randomUUID?.()
      ?? `result-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], {type: imageMimeFromBytes(bytes, mime)});
}
