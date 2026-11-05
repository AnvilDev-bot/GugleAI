import {computed, ref} from "vue";
import {DEFAULT_RETRY_STATUS_CODE_OPTIONS, type RetryConfig} from "../../../domain/models";

export function useGenerationSettings() {
  const apiMode = ref<"auto" | "images" | "chat">("auto");
  const retryEnabled = ref(false);
  const retryStatusCodes = ref<number[]>([504]);
  const retryStatusCodeOptions = ref([...DEFAULT_RETRY_STATUS_CODE_OPTIONS]);
  const retryStatusCodeInput = ref("");
  const retryStatusCodeMenuOpen = ref(false);
  const retryCount = ref(5);
  const size = ref("auto");
  const customWidth = ref(1024);
  const customHeight = ref(1024);
  const count = ref(1);
  const outputFormat = ref<"auto" | "gif">("auto");
  const frameCount = ref(9);
  const frameDurationMs = ref(200);

  function imageOutputOptions(): Record<string, string | number> {
    if (outputFormat.value === "auto") return {};
    if (outputFormat.value !== "gif") throw new Error("不支持的输出格式");
    if (!Number.isInteger(frameCount.value) || frameCount.value < 2 || frameCount.value > 64) {
      throw new Error("GIF 帧数必须是 2 到 64 之间的整数");
    }
    if (!Number.isInteger(frameDurationMs.value) || frameDurationMs.value < 20 || frameDurationMs.value > 2000) {
      throw new Error("GIF 每帧时长必须是 20 到 2000 之间的整数（毫秒）");
    }
    return {output_format: "gif", frame_count: frameCount.value, frame_duration_ms: frameDurationMs.value};
  }

  const retryStatusCodeInputValue = computed(() => {
    const value = retryStatusCodeInput.value.trim();
    if (!/^\d{3}$/.test(value)) return null;
    const code = Number(value);
    return code >= 100 && code <= 599 ? code : null;
  });

  const filteredRetryStatusCodeOptions = computed(() => {
    const query = retryStatusCodeInput.value.trim();
    if (!query) return retryStatusCodeOptions.value;
    return retryStatusCodeOptions.value.filter((code) => String(code).includes(query));
  });

  const showRetryStatusCodeInputAction = computed(() => {
    const code = retryStatusCodeInputValue.value;
    return code !== null && !retryStatusCodes.value.includes(code);
  });

  function toggleRetryStatusCode(code: number) {
    retryStatusCodes.value = retryStatusCodes.value.includes(code)
        ? retryStatusCodes.value.filter((item) => item !== code)
        : [...retryStatusCodes.value, code].sort((a, b) => a - b);
  }

  function addRetryStatusCode() {
    const code = retryStatusCodeInputValue.value;
    if (code === null) return;
    if (!retryStatusCodeOptions.value.includes(code)) {
      retryStatusCodeOptions.value = [...retryStatusCodeOptions.value, code].sort((a, b) => a - b);
    }
    if (!retryStatusCodes.value.includes(code)) {
      retryStatusCodes.value = [...retryStatusCodes.value, code].sort((a, b) => a - b);
    }
    retryStatusCodeInput.value = "";
  }

  function removeRetryStatusCodeOption(code: number) {
    if (DEFAULT_RETRY_STATUS_CODE_OPTIONS.includes(code)) return;
    retryStatusCodeOptions.value = retryStatusCodeOptions.value.filter((item) => item !== code);
    retryStatusCodes.value = retryStatusCodes.value.filter((item) => item !== code);
  }

  function retryConfig(): RetryConfig | null {
    if (!retryEnabled.value) return null;
    if (
      retryStatusCodes.value.length === 0
      || retryStatusCodes.value.some((code) => !Number.isInteger(code) || code < 100 || code > 599)
    ) {
      throw new Error("请至少选择一个 100 到 599 之间的重试错误码");
    }
    const maxRetries = Number(retryCount.value);
    if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > 20) {
      throw new Error("重试次数必须是 1 到 20 之间的整数");
    }
    return {statusCodes: new Set(retryStatusCodes.value), maxRetries};
  }

  function resolvedSize(): string | null {
    if (size.value === "auto") return null;
    if (size.value !== "custom") return size.value;
    const width = Number(customWidth.value);
    const height = Number(customHeight.value);
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new Error("自定义尺寸的宽度和高度必须是大于 0 的整数");
    }
    return `${width}x${height}`;
  }

  return {
    apiMode,
    retryEnabled,
    retryStatusCodes,
    retryStatusCodeOptions,
    retryStatusCodeInput,
    retryStatusCodeMenuOpen,
    retryCount,
    size,
    customWidth,
    customHeight,
    count,
    outputFormat,
    frameCount,
    frameDurationMs,
    imageOutputOptions,
    retryStatusCodeInputValue,
    filteredRetryStatusCodeOptions,
    showRetryStatusCodeInputAction,
    toggleRetryStatusCode,
    addRetryStatusCode,
    removeRetryStatusCodeOption,
    retryConfig,
    resolvedSize,
  };
}

export type GenerationSettings = ReturnType<typeof useGenerationSettings>;
