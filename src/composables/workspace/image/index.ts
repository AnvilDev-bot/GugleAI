import {computed, onMounted, onUnmounted, ref, type Ref} from "vue";
import {save} from "@tauri-apps/plugin-dialog";
import {invoke} from "@tauri-apps/api/core";
import {OpenAIConnection} from "../../../api";
import {
  base64ToBlob,
  imageExtension,
  normalizeImageMime,
  type RefImage,
  type ResolvedModel,
  type ResultImage,
} from "../../../domain/models";
import {arrayBufferToBase64, type GenerationTransport} from "../../../services/transport";
import type {GenerationSettings} from "../../settings/generation";

type Log = (level: "INFO" | "ERROR", message: string) => void;

interface ImageWorkspaceOptions {
  imageModelSelection: Ref<string>;
  resolveModelSelection(value: string): ResolvedModel | null;
  addConnection(endpoint: string, apiKey: string): boolean;
  generationSettings: GenerationSettings;
  transport: GenerationTransport;
  nextTaskId(): number;
  addResultImage(
      blob: Blob,
      mime: string,
      prompt: string,
      generatedResultIds?: Set<string>
  ): Promise<ResultImage>;
  log: Log;
  sanitizeUrl(value: string): string;
  errorMessage(value: unknown): string;
  formatErrorDetails(value: unknown): string;
  error?: Ref<string>;
}

export function useImageWorkspace(options: ImageWorkspaceOptions) {
  const prompt = ref("");
  const refImages = ref<RefImage[]>([]);
  const loading = ref(false);
  const stopping = ref(false);
  const error = options.error ?? ref("");
  const dragOver = ref(false);
  let abortController: AbortController | null = null;
  let activeTaskId: number | null = null;

  const hintText = computed(() => {
    const referenceCount = refImages.value.length;
    const useChat = options.generationSettings.apiMode.value === "chat"
        || (options.generationSettings.apiMode.value === "auto" && referenceCount > 1);
    const api = useChat ? "Chat 接口" : referenceCount > 0 ? "图像编辑接口" : "文生图接口";
    return referenceCount > 0 ? `${referenceCount} 张参考图 · ${api}` : `无参考图 · ${api}`;
  });

  function addFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    refImages.value.push({file, previewUrl: URL.createObjectURL(file)});
  }

  function addImages(event: Event) {
    const input = event.target as HTMLInputElement;
    for (const file of input.files ?? []) addFile(file);
    input.value = "";
  }

  function onDrop(event: DragEvent) {
    dragOver.value = false;
    for (const file of event.dataTransfer?.files ?? []) addFile(file);
  }

  function tryApplyConnectionConfig(text: string): boolean {
    if (text.startsWith("{") && text.includes("newapi_channel_conn")) {
      try {
        const connection = JSON.parse(text);
        if (
          typeof connection.url === "string" && connection.url
          && typeof connection.key === "string" && connection.key
        ) {
          return options.addConnection(connection.url, connection.key);
        }
      } catch {
      }
    }
    if (/^\[model_providers\.[^\]]+\]/m.test(text)) {
      const match = text.match(/^\[model_providers\.[^\]]+\][^[]*?^\s*base_url\s*=\s*"([^"]+)"/ms);
      if (match) return options.addConnection(match[1], "");
    }
    return false;
  }

  function onPaste(event: ClipboardEvent) {
    const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
    if (text && tryApplyConnectionConfig(text)) {
      error.value = "";
      event.preventDefault();
      return;
    }
    for (const item of event.clipboardData?.items ?? []) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) addFile(file);
    }
  }

  function removeImage(index: number) {
    URL.revokeObjectURL(refImages.value[index].previewUrl);
    refImages.value.splice(index, 1);
  }

  function stopGeneration() {
    if (!loading.value || !abortController || abortController.signal.aborted) return;
    stopping.value = true;
    options.log("INFO", `任务=#${activeTaskId ?? "?"} 用户请求停止生成`);
    abortController.abort();
  }

  async function generate() {
    if (loading.value) return;
    const selectedModel = options.resolveModelSelection(options.imageModelSelection.value);
    if (!selectedModel || !selectedModel.model.isImage) {
      error.value = "请先选择一个生图模型";
      return;
    }
    const generationPrompt = prompt.value;
    if (!generationPrompt.trim()) {
      error.value = "请输入提示词";
      return;
    }
    let requestSize: string | null;
    let outputOptions: Record<string, string | number>;
    try {
      requestSize = options.generationSettings.resolvedSize();
      outputOptions = options.generationSettings.imageOutputOptions();
    } catch (reason) {
      error.value = options.errorMessage(reason);
      return;
    }
    const requestCount = Math.max(
        1,
        Math.min(10, Math.trunc(Number(options.generationSettings.count.value) || 1))
    );
    const taskId = options.nextTaskId();
    const controller = new AbortController();
    const generatedResultIds = new Set<string>();
    abortController = controller;
    activeTaskId = taskId;
    loading.value = true;
    stopping.value = false;
    error.value = "";
    const connection = new OpenAIConnection(
        selectedModel.provider.imageEndpoint || selectedModel.provider.endpoint,
        selectedModel.provider.apiKey
    );
    try {
      const retryConfig = options.generationSettings.retryConfig();
      const useChat = options.generationSettings.apiMode.value === "chat"
          || (options.generationSettings.apiMode.value === "auto" && refImages.value.length > 1);
      options.log(
          "INFO",
          `任务=#${taskId} 开始生成: 端点=${options.sanitizeUrl(connection.baseUrl)} 模型=${selectedModel.model.id} 模式=${useChat ? "chat" : "images"} 参考图=${refImages.value.length} 数量=${requestCount} 尺寸=${requestSize ?? "auto"} 重试=${retryConfig ? `[${[...retryConfig.statusCodes].join(",")}],最多${retryConfig.maxRetries}次` : "关闭"}`
      );
      if (useChat) {
        await generateViaChat(
            connection,
            selectedModel.model.id,
            generationPrompt,
            requestSize,
            requestCount,
            taskId,
            controller.signal,
            generatedResultIds,
            outputOptions
        );
      } else {
        await generateViaImages(
            connection,
            selectedModel.model.id,
            generationPrompt,
            requestSize,
            requestCount,
            taskId,
            controller.signal,
            generatedResultIds,
            outputOptions
        );
      }
      options.transport.throwIfAborted(controller.signal);
      if (generatedResultIds.size === 0) throw new Error("响应中没有图片数据");
      options.log("INFO", `任务=#${taskId} 生成成功: ${generatedResultIds.size} 张图片`);
    } catch (reason) {
      if (controller.signal.aborted) {
        error.value = "";
        options.log("INFO", `任务=#${taskId} 生成已停止`);
      } else {
        error.value = options.errorMessage(reason);
        options.log("ERROR", `任务=#${taskId} 生成失败: ${options.formatErrorDetails(reason)}`);
      }
    } finally {
      if (abortController === controller) {
        abortController = null;
        activeTaskId = null;
      }
      stopping.value = false;
      loading.value = false;
    }
  }

  async function generateViaImages(
      connection: OpenAIConnection,
      modelName: string,
      generationPrompt: string,
      requestSize: string | null,
      requestCount: number,
      taskId: number,
      signal: AbortSignal,
      resultIds: Set<string>,
      outputOptions: Record<string, string | number>
  ) {
    options.transport.throwIfAborted(signal);
    let response: Response;
    if (refImages.value.length > 0) {
      const form = new FormData();
      form.append("model", modelName);
      form.append("prompt", generationPrompt);
      form.append("n", String(requestCount));
      if (requestSize) form.append("size", requestSize);
      for (const [key, value] of Object.entries(outputOptions)) form.append(key, String(value));
      for (const image of refImages.value) form.append("image[]", image.file, image.file.name);
      response = await options.transport.fetchGeneration(
          `${connection.baseUrl}/images/edits`,
          {method: "POST", headers: connection.authHeaders, body: form},
          taskId,
          signal
      );
    } else {
      response = await options.transport.fetchGeneration(
          `${connection.baseUrl}/images/generations`,
          {
            method: "POST",
            headers: connection.jsonHeaders,
            body: JSON.stringify({
              model: modelName,
              prompt: generationPrompt,
              n: requestCount,
              ...(requestSize ? {size: requestSize} : {}),
              ...outputOptions,
            }),
          },
          taskId,
          signal
      );
    }
    const data = await options.transport.parseResponse(response);
    options.transport.throwIfAborted(signal);
    for (const item of data.data ?? []) {
      options.transport.throwIfAborted(signal);
      if (item.b64_json) {
        const blob = base64ToBlob(item.b64_json, "image/png");
        await options.addResultImage(
            blob,
            blob.type,
            generationPrompt,
            resultIds
        );
      } else if (item.url) {
        await downloadResult(connection.baseUrl, item.url, signal, resultIds, generationPrompt);
      }
    }
  }

  async function generateViaChat(
      connection: OpenAIConnection,
      modelName: string,
      generationPrompt: string,
      requestSize: string | null,
      requestCount: number,
      taskId: number,
      signal: AbortSignal,
      resultIds: Set<string>,
      outputOptions: Record<string, string | number>
  ) {
    const content: unknown[] = [{type: "text", text: generationPrompt}];
    for (const image of refImages.value) {
      options.transport.throwIfAborted(signal);
      const buffer = await image.file.arrayBuffer();
      options.transport.throwIfAborted(signal);
      content.push({
        type: "image_url",
        image_url: {url: `data:${image.file.type || "image/png"};base64,${arrayBufferToBase64(buffer)}`},
      });
    }
    const response = await options.transport.fetchGeneration(
        `${connection.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: connection.jsonHeaders,
          body: JSON.stringify({
            model: modelName,
            messages: [{role: "user", content}],
            n: requestCount,
            ...(requestSize ? {size: requestSize} : {}),
            ...outputOptions,
          }),
        },
        taskId,
        signal
    );
    const data = await options.transport.parseResponse(response);
    options.transport.throwIfAborted(signal);
    for (const choice of data.choices ?? []) {
      const resultCount = resultIds.size;
      const message = choice.message ?? {};
      for (const image of message.images ?? []) {
        const url = image?.image_url?.url ?? image?.url;
        if (url) await collectChatImage(connection.baseUrl, url, signal, resultIds, generationPrompt);
      }
      const text = typeof message.content === "string" ? message.content : "";
      for (const match of text.matchAll(/data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)/g)) {
        options.transport.throwIfAborted(signal);
        const blob = base64ToBlob(match[2], match[1]);
        await options.addResultImage(
            blob,
            blob.type,
            generationPrompt,
            resultIds
        );
      }
      if (resultIds.size === resultCount) {
        for (const match of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g)) {
          await collectChatImage(connection.baseUrl, match[1], signal, resultIds, generationPrompt);
        }
      }
    }
  }

  async function collectChatImage(
      base: string,
      url: string,
      signal: AbortSignal,
      resultIds: Set<string>,
      generationPrompt: string
  ) {
    options.transport.throwIfAborted(signal);
    const dataUrl = url.match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (dataUrl) {
      const blob = base64ToBlob(dataUrl[2], dataUrl[1]);
      await options.addResultImage(
          blob,
          blob.type,
          generationPrompt,
          resultIds
      );
    } else {
      await downloadResult(base, url, signal, resultIds, generationPrompt);
    }
  }

  async function downloadResult(
      base: string,
      url: string,
      signal: AbortSignal,
      resultIds: Set<string>,
      generationPrompt: string
  ) {
    const blob = await options.transport.downloadImage(base, url, signal, true);
    await options.addResultImage(blob, normalizeImageMime(blob.type), generationPrompt, resultIds);
  }

  async function saveImage(image: ResultImage) {
    const extension = imageExtension(image.mime);
    const path = await save({
      defaultPath: `generated-${Date.now()}.${extension}`,
      filters: [{name: "图片", extensions: [extension]}],
    });
    if (!path) return;
    try {
      await invoke("save_file", {
        path,
        base64Data: arrayBufferToBase64(await image.blob.arrayBuffer()),
      });
    } catch (reason) {
      error.value = `保存失败: ${options.errorMessage(reason)}`;
    }
  }

  onMounted(() => window.addEventListener("paste", onPaste));
  onUnmounted(() => {
    abortController?.abort();
    window.removeEventListener("paste", onPaste);
    for (const image of refImages.value) URL.revokeObjectURL(image.previewUrl);
  });

  return {
    prompt,
    refImages,
    loading,
    stopping,
    error,
    dragOver,
    hintText,
    addFile,
    addImages,
    removeImage,
    onDrop,
    generate,
    stopGeneration,
    saveImage,
  };
}

export type ImageWorkspace = ReturnType<typeof useImageWorkspace>;
