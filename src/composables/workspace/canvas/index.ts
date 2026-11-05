import {onUnmounted, ref, watch, type Ref} from "vue";
import type {EdgeMouseEvent, ViewportTransform} from "@vue-flow/core";
import {OpenAIConnection} from "../../../api";
import {
  CanvasGraph,
  DEFAULT_CANVAS_VIEWPORT,
  type CanvasImageAsset,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasPoint,
  type CanvasViewport,
} from "../../../canvas";
import {
  base64ToBlob,
  modelSelectionKey,
  type ConnectionProfile,
  type ResolvedModel,
  type ResultImage,
} from "../../../domain/models";
import {
  deleteCanvasDocument as deleteStoredCanvasDocument,
  getCanvasDocument,
  listCanvasDocuments,
  putCanvasDocument,
  type CanvasDocumentMeta,
  type StoredCanvasDocument,
} from "../../../services/canvas-storage";
import {arrayBufferToBase64, type GenerationTransport} from "../../../services/transport";
import type {GenerationSettings} from "../../settings/generation";

interface CanvasWorkspaceOptions {
  graph: CanvasGraph;
  connectionProfiles: Ref<ConnectionProfile[]>;
  imageModelSelection: Ref<string>;
  chatModelSelection: Ref<string>;
  resolveModelSelection(value: string): ResolvedModel | null;
  firstModelSelection(image: boolean): string;
  generationSettings: GenerationSettings;
  transport: GenerationTransport;
  nextTaskId(): number;
  errorMessage(value: unknown): string;
  resolvePromptSystemPrompt(modelName: string): Promise<string>;
  error: Ref<string>;
  copyResultPrompt(image: ResultImage): Promise<void>;
  copyResultImage(image: ResultImage, staticFrame?: boolean): Promise<void>;
  saveImage(image: ResultImage): Promise<void>;
}

interface CanvasImageContextMenuState {
  image: ResultImage;
  x: number;
  y: number;
}

interface CanvasDocumentContextMenuState {
  document: CanvasDocumentMeta;
  x: number;
  y: number;
}

const CANVAS_VIEWPORT_VERSION = 2;

export function useCanvasWorkspace(options: CanvasWorkspaceOptions) {
  const canvasNodes = options.graph.nodes;
  const canvasEdges = options.graph.edges;
  const canvasBusyCount = ref(0);
  const canvasDocuments = ref<CanvasDocumentMeta[]>([]);
  const canvasLibraryLoading = ref(false);
  const canvasLibraryOpen = ref(true);
  const activeCanvas = ref<CanvasDocumentMeta | null>(null);
  const canvasViewport = ref<CanvasViewport>({...DEFAULT_CANVAS_VIEWPORT});
  const canvasImageContextMenu = ref<CanvasImageContextMenuState | null>(null);
  const canvasDocumentContextMenu = ref<CanvasDocumentContextMenuState | null>(null);
  const canvasRenameTarget = ref<CanvasDocumentMeta | null>(null);
  const canvasRenameDraft = ref("");
  const canvasRenameError = ref("");
  const canvasRenameSaving = ref(false);
  const canvasDeleteTarget = ref<CanvasDocumentMeta | null>(null);
  const canvasDeleteSaving = ref(false);
  const controllers = new Map<string, AbortController>();
  let libraryInitialized = false;
  let persistenceSuspended = false;
  let canvasDirty = false;
  let persistTimer: number | null = null;
  let persistQueue: Promise<void> = Promise.resolve();

  async function enterCanvasWorkspace() {
    await initializeCanvasLibrary();
    await showCanvasLibrary();
  }

  async function initializeCanvasLibrary() {
    if (libraryInitialized) return;
    canvasLibraryLoading.value = true;
    try {
      canvasDocuments.value = await listCanvasDocuments();
      if (canvasDocuments.value.length === 0) {
        const document = createBlankCanvasDocument("画布 1");
        await putCanvasDocument(document);
        canvasDocuments.value = [documentMeta(document)];
      }
      libraryInitialized = true;
    } catch (reason) {
      reportCanvasStorageError("加载", reason);
    } finally {
      canvasLibraryLoading.value = false;
    }
  }

  async function createCanvas() {
    if (canvasLibraryLoading.value || canvasBusyCount.value > 0) return;
    canvasLibraryLoading.value = true;
    closeCanvasDocumentContextMenu();
    try {
      const document = createBlankCanvasDocument(nextCanvasName());
      await putCanvasDocument(document);
      canvasDocuments.value = [documentMeta(document), ...canvasDocuments.value];
      loadCanvasDocument(document);
    } catch (reason) {
      reportCanvasStorageError("新建", reason);
    } finally {
      canvasLibraryLoading.value = false;
    }
  }

  async function openCanvas(id: string) {
    if (canvasLibraryLoading.value || canvasBusyCount.value > 0) return;
    canvasLibraryLoading.value = true;
    closeCanvasDocumentContextMenu();
    try {
      const document = await getCanvasDocument(id);
      if (!document) throw new Error("画布不存在或已经被删除");
      loadCanvasDocument(document);
    } catch (reason) {
      reportCanvasStorageError("打开", reason);
    } finally {
      canvasLibraryLoading.value = false;
    }
  }

  async function showCanvasLibrary() {
    if (canvasBusyCount.value > 0) return;
    closeCanvasImageContextMenu();
    closeCanvasDocumentContextMenu();
    await flushActiveCanvas();
    persistenceSuspended = true;
    activeCanvas.value = null;
    canvasLibraryOpen.value = true;
    options.graph.clear();
    canvasViewport.value = {...DEFAULT_CANVAS_VIEWPORT};
    persistenceSuspended = false;
    if (libraryInitialized) {
      try {
        canvasDocuments.value = await listCanvasDocuments();
      } catch (reason) {
        reportCanvasStorageError("刷新", reason);
      }
    }
  }

  function openCanvasDocumentContextMenu(event: MouseEvent, document: CanvasDocumentMeta) {
    closeCanvasImageContextMenu();
    const menuWidth = 152;
    const menuHeight = 78;
    const padding = 8;
    canvasDocumentContextMenu.value = {
      document,
      x: Math.max(padding, Math.min(event.clientX, window.innerWidth - menuWidth - padding)),
      y: Math.max(padding, Math.min(event.clientY, window.innerHeight - menuHeight - padding)),
    };
  }

  function closeCanvasDocumentContextMenu() {
    canvasDocumentContextMenu.value = null;
  }

  function startRenameCanvasDocument() {
    const document = canvasDocumentContextMenu.value?.document;
    closeCanvasDocumentContextMenu();
    if (!document) return;
    canvasRenameTarget.value = document;
    canvasRenameDraft.value = document.name;
    canvasRenameError.value = "";
  }

  function cancelRenameCanvasDocument() {
    if (canvasRenameSaving.value) return;
    canvasRenameTarget.value = null;
    canvasRenameDraft.value = "";
    canvasRenameError.value = "";
  }

  async function renameCanvasDocument() {
    const target = canvasRenameTarget.value;
    const name = canvasRenameDraft.value.trim();
    if (!target || canvasRenameSaving.value) return;
    if (!name) {
      canvasRenameError.value = "画布名称不能为空";
      return;
    }
    canvasRenameSaving.value = true;
    canvasRenameError.value = "";
    try {
      const stored = await getCanvasDocument(target.id);
      if (!stored) throw new Error("画布不存在或已经被删除");
      const updated = {...stored, name, updatedAt: Date.now()};
      await putCanvasDocument(updated);
      canvasDocuments.value = [
        documentMeta(updated),
        ...canvasDocuments.value.filter((item) => item.id !== target.id),
      ];
      canvasRenameTarget.value = null;
    } catch (reason) {
      canvasRenameError.value = `重命名失败: ${options.errorMessage(reason)}`;
    } finally {
      canvasRenameSaving.value = false;
    }
  }

  function requestDeleteCanvasDocument() {
    const document = canvasDocumentContextMenu.value?.document;
    closeCanvasDocumentContextMenu();
    if (document) canvasDeleteTarget.value = document;
  }

  function cancelDeleteCanvasDocument() {
    if (!canvasDeleteSaving.value) canvasDeleteTarget.value = null;
  }

  async function confirmDeleteCanvasDocument() {
    const document = canvasDeleteTarget.value;
    if (!document || canvasDeleteSaving.value) return;
    canvasDeleteSaving.value = true;
    try {
      await deleteStoredCanvasDocument(document.id);
      canvasDocuments.value = canvasDocuments.value.filter((item) => item.id !== document.id);
      canvasDeleteTarget.value = null;
    } catch (reason) {
      reportCanvasStorageError("删除", reason);
    } finally {
      canvasDeleteSaving.value = false;
    }
  }

  function loadCanvasDocument(document: StoredCanvasDocument) {
    const migrateViewport = document.viewportVersion !== CANVAS_VIEWPORT_VERSION;
    persistenceSuspended = true;
    options.graph.load(document.snapshot);
    canvasViewport.value = normalizeCanvasViewport(
        migrateViewport ? DEFAULT_CANVAS_VIEWPORT : document.viewport
    );
    activeCanvas.value = documentMeta(document);
    canvasLibraryOpen.value = false;
    canvasDirty = migrateViewport;
    persistenceSuspended = false;
    if (migrateViewport) void persistActiveCanvas();
  }

  function createBlankCanvasDocument(name: string): StoredCanvasDocument {
    const now = Date.now();
    return {
      id: globalThis.crypto?.randomUUID?.()
          ?? `canvas-${now}-${Math.random().toString(36).slice(2)}`,
      name,
      createdAt: now,
      updatedAt: now,
      viewportVersion: CANVAS_VIEWPORT_VERSION,
      viewport: {...DEFAULT_CANVAS_VIEWPORT},
      snapshot: {version: 1, nodes: [], edges: []},
    };
  }

  function nextCanvasName(): string {
    const names = new Set(canvasDocuments.value.map((item) => item.name));
    let index = 1;
    while (names.has(`画布 ${index}`)) index += 1;
    return `画布 ${index}`;
  }

  function scheduleCanvasPersistence() {
    if (persistenceSuspended || !activeCanvas.value) return;
    canvasDirty = true;
    if (persistTimer !== null) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = null;
      void persistActiveCanvas();
    }, 350);
  }

  async function persistActiveCanvas() {
    const current = activeCanvas.value;
    if (!current || !canvasDirty) return persistQueue;
    canvasDirty = false;
    const updatedAt = Date.now();
    const document: StoredCanvasDocument = {
      id: current.id,
      name: current.name,
      createdAt: current.createdAt,
      updatedAt,
      viewportVersion: CANVAS_VIEWPORT_VERSION,
      snapshot: options.graph.snapshot(),
      viewport: {...canvasViewport.value},
    };
    activeCanvas.value = documentMeta(document);
    canvasDocuments.value = [
      documentMeta(document),
      ...canvasDocuments.value.filter((item) => item.id !== document.id),
    ];
    persistQueue = persistQueue
        .then(() => putCanvasDocument(document))
        .catch((reason) => reportCanvasStorageError("保存", reason));
    return persistQueue;
  }

  async function flushActiveCanvas() {
    if (persistTimer !== null) {
      window.clearTimeout(persistTimer);
      persistTimer = null;
    }
    await persistActiveCanvas();
  }

  function updateCanvasViewport(viewport: ViewportTransform) {
    canvasViewport.value = normalizeCanvasViewport(viewport);
  }

  function formatCanvasUpdatedAt(timestamp: number): string {
    return new Date(timestamp).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function reportCanvasStorageError(action: string, reason: unknown) {
    options.error.value = `画布${action}失败: ${options.errorMessage(reason)}`;
  }

  function addCanvasTextNode(center?: CanvasPoint) {
    options.graph.add("text", canvasNodeDefaults("text"), center);
  }

  function addCanvasImageNode(center?: CanvasPoint) {
    options.graph.add("image", canvasNodeDefaults("image"), center);
  }

  function canvasNodeDefaults(type: "text" | "image") {
    const preferredSelection = type === "text"
        ? options.chatModelSelection.value
        : options.imageModelSelection.value;
    const resolved = options.resolveModelSelection(preferredSelection)
        ?? options.resolveModelSelection(options.firstModelSelection(type === "image"));
    return {
      connectionId: resolved?.provider.id ?? "",
      model: resolved?.model.id ?? "",
    };
  }

  function canvasNodeModelSelection(nodeData: CanvasNodeData): string {
    return modelSelectionKey(nodeData.connectionId, nodeData.model);
  }

  function onCanvasNodeModelChange(nodeId: string, valueOrEvent: string | Event) {
    const selection = typeof valueOrEvent === "string"
        ? valueOrEvent
        : (valueOrEvent.target as HTMLSelectElement).value;
    const resolved = options.resolveModelSelection(selection);
    if (!resolved) return;
    updateCanvasNodeData(nodeId, {
      connectionId: resolved.provider.id,
      model: resolved.model.id,
      error: "",
    });
  }

  function connectionForCanvasNode(node: CanvasNode, imageGeneration = false): OpenAIConnection {
    const profile = options.connectionProfiles.value.find((item) => item.id === node.data.connectionId);
    if (!profile) throw new Error("节点选择的 API 连接不存在，请重新选择");
    if (!profile.models.some((item) => item.id === node.data.model)) {
      throw new Error("节点选择的模型不存在，请重新选择");
    }
    const endpoint = imageGeneration ? profile.imageEndpoint || profile.endpoint : profile.endpoint;
    return new OpenAIConnection(endpoint, profile.apiKey);
  }

  function updateCanvasNodeData(id: string, patch: Partial<CanvasNodeData>) {
    options.graph.updateData(id, patch);
  }

  function onCanvasConnect(connection: Parameters<CanvasGraph["connect"]>[0]) {
    options.graph.connect(connection);
  }

  function onCanvasNodesUpdate(nodes: Parameters<CanvasGraph["replaceNodes"]>[0]) {
    options.graph.replaceNodes(nodes);
  }

  function onCanvasEdgesUpdate(edges: Parameters<CanvasGraph["replaceEdges"]>[0]) {
    options.graph.replaceEdges(edges);
  }

  function onCanvasEdgeDoubleClick({edge, event}: EdgeMouseEvent) {
    if (!options.graph.removeManualEdge(edge.id)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function deleteCanvasNode(id: string) {
    for (const removedId of options.graph.deleteNode(id)) {
      controllers.get(removedId)?.abort();
      controllers.delete(removedId);
    }
  }

  function onCanvasImageFiles(nodeId: string, event: Event) {
    const input = event.target as HTMLInputElement;
    options.graph.addFiles(nodeId, [...(input.files ?? [])]);
    input.value = "";
  }

  function openCanvasImagePicker(nodeId: string) {
    document.getElementById(`canvas-image-input-${nodeId}`)?.click();
  }

  function removeCanvasReference(nodeId: string, assetId: string) {
    options.graph.removeReference(nodeId, assetId);
  }

  function openCanvasImageContextMenu(event: MouseEvent, nodeId: string, assetId: string) {
    const node = options.graph.findNode(nodeId);
    const asset = node
        ? [...node.data.references, ...node.data.outputs].find((item) => item.id === assetId)
        : null;
    if (!node || !asset) return;
    const menuWidth = 176;
    const menuHeight = asset.mime === "image/gif" ? 162 : 122;
    const padding = 8;
    canvasImageContextMenu.value = {
      image: {
        id: asset.id,
        blob: asset.blob,
        mime: asset.mime,
        prompt: node.data.prompt,
        previewUrl: asset.url,
        createdAt: Date.now(),
      },
      x: Math.max(padding, Math.min(event.clientX, window.innerWidth - menuWidth - padding)),
      y: Math.max(padding, Math.min(event.clientY, window.innerHeight - menuHeight - padding)),
    };
  }

  function closeCanvasImageContextMenu() {
    canvasImageContextMenu.value = null;
  }

  async function copyCanvasImagePrompt(image: ResultImage) {
    closeCanvasImageContextMenu();
    await options.copyResultPrompt(image);
  }

  async function copyCanvasImage(image: ResultImage, staticFrame = false) {
    closeCanvasImageContextMenu();
    await options.copyResultImage(image, staticFrame);
  }

  async function saveCanvasImage(image: ResultImage) {
    closeCanvasImageContextMenu();
    await options.saveImage(image);
  }

  async function assetDataUrl(asset: CanvasImageAsset): Promise<string> {
    return `data:${asset.mime};base64,${arrayBufferToBase64(await asset.blob.arrayBuffer())}`;
  }

  async function requestCanvasText(
      node: CanvasNode,
      signal: AbortSignal,
      taskId: number
  ): Promise<string> {
    const prompt = options.graph.prompt(node);
    if (!prompt) throw new Error("请先在节点或父节点中填写文字内容");
    const content: unknown[] = [{type: "text", text: prompt}];
    for (const asset of options.graph.referenceAssets(node)) {
      content.push({type: "image_url", image_url: {url: await assetDataUrl(asset)}});
    }
    const systemPrompt = await options.resolvePromptSystemPrompt(node.data.model);
    return options.transport.requestTextCompletion(
        [
          ...(systemPrompt.trim() ? [{role: "system", content: systemPrompt}] : []),
          {role: "user", content},
        ],
        signal,
        taskId,
        node.data.model,
        connectionForCanvasNode(node)
    );
  }

  async function generateCanvasText(nodeId: string) {
    const node = options.graph.findNode(nodeId);
    if (!node || node.type !== "text" || node.data.readOnly || controllers.has(nodeId)) return;
    const controller = new AbortController();
    controllers.set(nodeId, controller);
    canvasBusyCount.value += 1;
    updateCanvasNodeData(nodeId, {status: "running", error: ""});
    try {
      const output = await requestCanvasText(node, controller.signal, options.nextTaskId());
      options.graph.addGeneratedTextChild(nodeId, output);
      updateCanvasNodeData(nodeId, {status: "success"});
    } catch (reason) {
      updateCanvasNodeData(nodeId, controller.signal.aborted
          ? {status: "idle"}
          : {status: "error", error: options.errorMessage(reason)});
    } finally {
      canvasBusyCount.value -= 1;
      controllers.delete(nodeId);
    }
  }

  async function requestCanvasImages(
      node: CanvasNode,
      prompt: string,
      references: CanvasImageAsset[],
      amount: number,
      signal: AbortSignal,
      taskId: number
  ): Promise<Blob[]> {
    const connection = connectionForCanvasNode(node, true);
    const base = connection.baseUrl;
    const requestSize = resolveCanvasNodeSize(node.data);
    const outputOptions = options.generationSettings.imageOutputOptions();
    const useChat = options.generationSettings.apiMode.value === "chat"
        || (options.generationSettings.apiMode.value === "auto" && references.length > 1);
    if (useChat) {
      const content: unknown[] = [{type: "text", text: prompt}];
      for (const asset of references) {
        content.push({type: "image_url", image_url: {url: await assetDataUrl(asset)}});
      }
      const response = await options.transport.fetchGeneration(
          `${base}/chat/completions`,
          {
            method: "POST",
            headers: connection.jsonHeaders,
            body: JSON.stringify({
              model: node.data.model,
              messages: [{role: "user", content}],
              n: amount,
              ...(requestSize ? {size: requestSize} : {}),
              ...outputOptions,
            }),
          },
          taskId,
          signal
      );
      const data = await options.transport.parseResponse(response);
      const blobs: Blob[] = [];
      for (const choice of data.choices ?? []) {
        const message = choice.message ?? {};
        for (const image of message.images ?? []) {
          const url = image?.image_url?.url ?? image?.url;
          if (url) blobs.push(await imageUrlToBlob(base, url, signal));
        }
        const text = OpenAIConnection.extractTextContent(message.content);
        for (const match of text.matchAll(/data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)/g)) {
          blobs.push(base64ToBlob(match[2], match[1]));
        }
        if (blobs.length === 0) {
          for (const match of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g)) {
            blobs.push(await imageUrlToBlob(base, match[1], signal));
          }
        }
      }
      return blobs.slice(0, amount);
    }

    let response: Response;
    if (references.length > 0) {
      const form = new FormData();
      form.append("model", node.data.model);
      form.append("prompt", prompt);
      form.append("n", String(amount));
      if (requestSize) form.append("size", requestSize);
      for (const [key, value] of Object.entries(outputOptions)) form.append(key, String(value));
      for (const asset of references) {
        form.append("image[]", new File([asset.blob], asset.name, {type: asset.mime}), asset.name);
      }
      response = await options.transport.fetchGeneration(
          `${base}/images/edits`,
          {method: "POST", headers: connection.authHeaders, body: form},
          taskId,
          signal
      );
    } else {
      response = await options.transport.fetchGeneration(
          `${base}/images/generations`,
          {
            method: "POST",
            headers: connection.jsonHeaders,
            body: JSON.stringify({
              model: node.data.model,
              prompt,
              n: amount,
              ...(requestSize ? {size: requestSize} : {}),
              ...outputOptions,
            }),
          },
          taskId,
          signal
      );
    }
    const data = await options.transport.parseResponse(response);
    const blobs: Blob[] = [];
    for (const item of data.data ?? []) {
      if (item.b64_json) blobs.push(base64ToBlob(item.b64_json, "image/png"));
      else if (item.url) blobs.push(await imageUrlToBlob(base, item.url, signal));
    }
    return blobs.slice(0, amount);
  }

  function resolveCanvasNodeSize(data: CanvasNodeData): string | null {
    if (data.size === "auto" || !data.size) return null;
    if (data.size !== "custom") return data.size;
    const width = Number(data.customWidth);
    const height = Number(data.customHeight);
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new Error("自定义尺寸的宽度和高度必须是大于 0 的整数");
    }
    return `${width}x${height}`;
  }

  async function imageUrlToBlob(base: string, url: string, signal: AbortSignal): Promise<Blob> {
    const dataUrl = url.match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (dataUrl) return base64ToBlob(dataUrl[2], dataUrl[1]);
    return options.transport.downloadImage(base, url, signal);
  }

  async function generateCanvasImage(nodeId: string) {
    const node = options.graph.findNode(nodeId);
    if (!node || node.type !== "image" || node.data.readOnly || controllers.has(nodeId)) return;
    if (node.data.references.length > 0) {
      updateCanvasNodeData(nodeId, {
        status: "error",
        error: "参考图节点不能直接生成，请新建图像节点并连接此节点",
      });
      return;
    }
    const prompt = options.graph.prompt(node);
    if (!prompt) {
      updateCanvasNodeData(nodeId, {status: "error", error: "请先填写提示词或连接文字节点"});
      return;
    }
    const references = options.graph.referenceAssets(node);
    const amount = Math.max(1, Math.min(10, Number(node.data.count) || 1));
    const controller = new AbortController();
    controllers.set(nodeId, controller);
    canvasBusyCount.value += 1;
    updateCanvasNodeData(nodeId, {status: "running", error: ""});
    try {
      const blobs = await requestCanvasImages(
          node,
          prompt,
          references,
          amount,
          controller.signal,
          options.nextTaskId()
      );
      if (blobs.length === 0) throw new Error("响应中没有图片数据");
      options.graph.addGeneratedOutputs(nodeId, blobs, prompt);
      updateCanvasNodeData(nodeId, {status: "success"});
    } catch (reason) {
      updateCanvasNodeData(nodeId, controller.signal.aborted
          ? {status: "idle"}
          : {status: "error", error: options.errorMessage(reason)});
    } finally {
      canvasBusyCount.value -= 1;
      controllers.delete(nodeId);
    }
  }

  function stopCanvasNode(nodeId: string) {
    controllers.get(nodeId)?.abort();
  }

  function clearCanvas() {
    if (canvasNodes.value.length === 0) return;
    if (!window.confirm("确定清空无尽画布中的全部节点和连接吗？")) return;
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    options.graph.clear();
  }

  watch([canvasNodes, canvasEdges], scheduleCanvasPersistence, {flush: "sync"});
  watch(canvasViewport, scheduleCanvasPersistence, {deep: true, flush: "sync"});

  onUnmounted(() => {
    if (persistTimer !== null) window.clearTimeout(persistTimer);
    void persistActiveCanvas();
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    closeCanvasImageContextMenu();
    closeCanvasDocumentContextMenu();
    options.graph.dispose();
  });

  return {
    canvasNodes,
    canvasEdges,
    canvasBusyCount,
    canvasDocuments,
    canvasLibraryLoading,
    canvasLibraryOpen,
    activeCanvas,
    canvasViewport,
    canvasImageContextMenu,
    canvasDocumentContextMenu,
    canvasRenameTarget,
    canvasRenameDraft,
    canvasRenameError,
    canvasRenameSaving,
    canvasDeleteTarget,
    canvasDeleteSaving,
    enterCanvasWorkspace,
    createCanvas,
    openCanvas,
    showCanvasLibrary,
    openCanvasDocumentContextMenu,
    closeCanvasDocumentContextMenu,
    startRenameCanvasDocument,
    cancelRenameCanvasDocument,
    renameCanvasDocument,
    requestDeleteCanvasDocument,
    cancelDeleteCanvasDocument,
    confirmDeleteCanvasDocument,
    updateCanvasViewport,
    formatCanvasUpdatedAt,
    addCanvasTextNode,
    addCanvasImageNode,
    updateCanvasNodeData,
    onCanvasConnect,
    onCanvasNodesUpdate,
    onCanvasEdgesUpdate,
    onCanvasEdgeDoubleClick,
    deleteCanvasNode,
    canvasNodeModelSelection,
    onCanvasNodeModelChange,
    onCanvasImageFiles,
    openCanvasImagePicker,
    removeCanvasReference,
    openCanvasImageContextMenu,
    closeCanvasImageContextMenu,
    copyCanvasImagePrompt,
    copyCanvasImage,
    saveCanvasImage,
    generateCanvasText,
    generateCanvasImage,
    stopCanvasNode,
    clearCanvas,
  };
}

function documentMeta(document: StoredCanvasDocument): CanvasDocumentMeta {
  return {
    id: document.id,
    name: document.name,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    nodeCount: document.snapshot.nodes.length,
  };
}

function normalizeCanvasViewport(viewport: Partial<CanvasViewport> | null | undefined): CanvasViewport {
  const zoom = Number(viewport?.zoom);
  return {
    x: Number.isFinite(viewport?.x) ? Number(viewport?.x) : DEFAULT_CANVAS_VIEWPORT.x,
    y: Number.isFinite(viewport?.y) ? Number(viewport?.y) : DEFAULT_CANVAS_VIEWPORT.y,
    zoom: Number.isFinite(zoom) ? Math.max(0.2, Math.min(2.5, zoom)) : DEFAULT_CANVAS_VIEWPORT.zoom,
  };
}

export type CanvasWorkspace = ReturnType<typeof useCanvasWorkspace>;
