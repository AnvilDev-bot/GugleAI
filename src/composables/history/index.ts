import {copyImageBlob} from "../../services/clipboard";
import {Message} from "@arco-design/web-vue";
import {onMounted, onUnmounted, ref, type Ref} from "vue";
import {
  createResultId,
  imageExtension,
  normalizeImageMime,
  type ResultContextMenuState,
  type ResultImage,
} from "../../domain/models";
import {
  clearStoredResultImages,
  deleteStoredResultImage,
  loadStoredResultImages,
  putStoredResultImage,
} from "../../services/history";

type Log = (level: "INFO" | "ERROR", message: string) => void;

interface ResultHistoryOptions {
  error: Ref<string>;
  log: Log;
  errorMessage(value: unknown): string;
  formatErrorDetails(value: unknown): string;
  addReference(file: File): void;
  saveImage(image: ResultImage): Promise<void>;
}

export function useResultHistory(options: ResultHistoryOptions) {
  const results = ref<ResultImage[]>([]);
  const historyLoading = ref(true);
  const resultContextMenu = ref<ResultContextMenuState | null>(null);
  const enlargedResult = ref<ResultImage | null>(null);
  const previewNotice = ref("");
  let previewNoticeTimer: number | null = null;

  function reportHistoryError(action: string, reason: unknown) {
    const message = `预览历史${action}失败: ${options.errorMessage(reason)}`;
    options.log("ERROR", `${message}；当前会话中的图片不会被丢弃`);
    if (!options.error.value) options.error.value = message;
  }

  async function addResultImage(
      blob: Blob,
      mime: string,
      prompt: string,
      generatedResultIds?: Set<string>
  ): Promise<ResultImage> {
    const normalizedMime = normalizeImageMime(mime || blob.type);
    const normalizedBlob = blob.type === normalizedMime ? blob : blob.slice(0, blob.size, normalizedMime);
    const image: ResultImage = {
      id: createResultId(),
      blob: normalizedBlob,
      mime: normalizedMime,
      prompt,
      previewUrl: URL.createObjectURL(normalizedBlob),
      createdAt: Date.now(),
    };
    results.value.push(image);
    generatedResultIds?.add(image.id);
    try {
      await putStoredResultImage({
        id: image.id,
        blob: image.blob,
        mime: image.mime,
        prompt: image.prompt,
        createdAt: image.createdAt,
      });
    } catch (reason) {
      reportHistoryError("保存", reason);
    }
    return image;
  }

  async function restoreResultHistory() {
    historyLoading.value = true;
    try {
      const records = await loadStoredResultImages();
      const currentIds = new Set(results.value.map((image) => image.id));
      const restored = records
          .filter((record) => !currentIds.has(record.id))
          .map((record): ResultImage => ({
            id: record.id,
            blob: record.blob,
            mime: normalizeImageMime(record.mime || record.blob.type),
            prompt: typeof record.prompt === "string" ? record.prompt : "",
            previewUrl: URL.createObjectURL(record.blob),
            createdAt: Number.isFinite(record.createdAt) ? record.createdAt : 0,
          }));
      results.value = [...restored, ...results.value];
      if (restored.length > 0) options.log("INFO", `已恢复 ${restored.length} 张预览图片`);
    } catch (reason) {
      reportHistoryError("加载", reason);
    } finally {
      historyLoading.value = false;
    }
  }

  async function deleteResultImage(image: ResultImage) {
    if (resultContextMenu.value?.image.id === image.id) closeResultContextMenu();
    if (enlargedResult.value?.id === image.id) closeResultLightbox();
    try {
      await deleteStoredResultImage(image.id);
      const index = results.value.findIndex((item) => item.id === image.id);
      if (index >= 0) {
        URL.revokeObjectURL(results.value[index].previewUrl);
        results.value.splice(index, 1);
      }
    } catch (reason) {
      reportHistoryError("删除", reason);
    }
  }

  async function clearResultHistory() {
    if (historyLoading.value || results.value.length === 0) return;
    if (!window.confirm(`确定清空全部 ${results.value.length} 张预览图片吗？此操作无法撤销。`)) return;
    closeResultContextMenu();
    closeResultLightbox();
    try {
      await clearStoredResultImages();
      for (const image of results.value) URL.revokeObjectURL(image.previewUrl);
      results.value = [];
      options.log("INFO", "已清空预览历史");
    } catch (reason) {
      reportHistoryError("清空", reason);
    }
  }

  function openResultContextMenu(event: MouseEvent, image: ResultImage) {
    const menuWidth = 176;
    const menuHeight = image.mime === "image/gif" ? 242 : 202;
    const padding = 8;
    resultContextMenu.value = {
      image,
      x: Math.max(padding, Math.min(event.clientX, window.innerWidth - menuWidth - padding)),
      y: Math.max(padding, Math.min(event.clientY, window.innerHeight - menuHeight - padding)),
    };
  }

  function closeResultContextMenu() {
    resultContextMenu.value = null;
  }

  function openResultLightbox(image: ResultImage) {
    closeResultContextMenu();
    enlargedResult.value = image;
  }

  function closeResultLightbox() {
    enlargedResult.value = null;
  }

  function showPreviewNotice(message: string) {
    previewNotice.value = message;
    if (previewNoticeTimer !== null) window.clearTimeout(previewNoticeTimer);
    previewNoticeTimer = window.setTimeout(() => {
      previewNotice.value = "";
      previewNoticeTimer = null;
    }, 2000);
  }

  async function copyResultPrompt(image: ResultImage) {
    closeResultContextMenu();
    if (!image.prompt) {
      options.error.value = "这张图片由旧版本生成，没有保存可复制的提示词";
      return;
    }
    if (!await copyText(image.prompt)) {
      options.error.value = "复制提示词失败，请检查系统剪贴板权限";
      return;
    }
    showPreviewNotice("提示词已复制");
    options.log("INFO", "已复制预览图片的提示词");
  }

  async function copyResultImage(image: ResultImage, staticFrame = false) {
    closeResultContextMenu();
    try {
      // Start the clipboard write before any await to retain the click's user activation.
      const result = await copyImageBlob(image.blob, staticFrame);
      const message = result === "web-gif"
          ? "GIF 原始数据已复制，仅兼容应用可粘贴动画；如无法粘贴，请保存 GIF 文件"
          : result === "gif" ? "GIF 已复制，动画能否粘贴取决于目标应用"
          : staticFrame ? "静态帧已复制（不含动画）" : "图片已复制到剪贴板";
      options.error.value = "";
      showPreviewNotice(message);
      Message.success({content: message, duration: result === "web-gif" ? 6000 : 3000});
      options.log("INFO", `复制图片完成: 格式=${result}`);
    } catch (reason) {
      const fallback = image.mime === "image/gif" && !staticFrame
          ? "；可保存 GIF 文件保留动画，或选择“复制静态帧”" : "";
      options.error.value = `复制图片失败: ${options.errorMessage(reason)}${fallback}`;
      Message.error({content: options.error.value, duration: 6000});
      options.log("ERROR", `复制预览图片到剪贴板失败: ${options.formatErrorDetails(reason)}`);
    }
  }

  function setResultAsReference(image: ResultImage) {
    closeResultContextMenu();
    const extension = imageExtension(image.mime);
    try {
      options.addReference(new File([image.blob], `generated-${image.createdAt}.${extension}`, {
        type: image.mime,
        lastModified: image.createdAt,
      }));
      showPreviewNotice("已添加为参考图");
      options.log("INFO", "已将预览图片添加为参考图");
    } catch (reason) {
      options.error.value = `添加参考图失败: ${options.errorMessage(reason)}`;
    }
  }

  async function saveResultFromContextMenu(image: ResultImage) {
    closeResultContextMenu();
    await options.saveImage(image);
  }

  async function deleteResultFromContextMenu(image: ResultImage) {
    closeResultContextMenu();
    await deleteResultImage(image);
  }

  function closeOnOutsideScroll(event: Event) {
    if (event.target instanceof Element && event.target.closest(".result-context-menu")) return;
    closeResultContextMenu();
  }

  function closeOnEscape(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    closeResultContextMenu();
    closeResultLightbox();
  }

  onMounted(() => {
    window.addEventListener("blur", closeResultContextMenu);
    window.addEventListener("resize", closeResultContextMenu);
    window.addEventListener("scroll", closeOnOutsideScroll, true);
    document.addEventListener("keydown", closeOnEscape);
  });

  onUnmounted(() => {
    for (const image of results.value) URL.revokeObjectURL(image.previewUrl);
    if (previewNoticeTimer !== null) window.clearTimeout(previewNoticeTimer);
    window.removeEventListener("blur", closeResultContextMenu);
    window.removeEventListener("resize", closeResultContextMenu);
    window.removeEventListener("scroll", closeOnOutsideScroll, true);
    document.removeEventListener("keydown", closeOnEscape);
  });

  return {
    results,
    historyLoading,
    resultContextMenu,
    enlargedResult,
    previewNotice,
    addResultImage,
    restoreResultHistory,
    deleteResultImage,
    clearResultHistory,
    openResultContextMenu,
    closeResultContextMenu,
    openResultLightbox,
    closeResultLightbox,
    copyResultPrompt,
    copyResultImage,
    setResultAsReference,
    saveResultFromContextMenu,
    deleteResultFromContextMenu,
  };
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }
}
