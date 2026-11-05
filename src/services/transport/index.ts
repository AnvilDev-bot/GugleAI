import type {ClientOptions} from "@tauri-apps/plugin-http";
import {OpenAIConnection} from "../../api";
import {describeRequestBody} from "../../composables/logger";
import {imageMimeFromBytes, type RetryConfig} from "../../domain/models";

type SystemFetch = (input: string, init?: RequestInit & ClientOptions) => Promise<Response>;
type Log = (level: "INFO" | "ERROR", message: string) => void;

interface GenerationTransportOptions {
  fetch: SystemFetch;
  retryConfig(): RetryConfig | null;
  log: Log;
  sanitizeUrl(value: string): string;
  redact(value: unknown): string;
  formatError(value: unknown): string;
  proxyForLog(): string;
}

export function createGenerationTransport(options: GenerationTransportOptions) {
  function abortError(): DOMException {
    return new DOMException("生成已停止", "AbortError");
  }

  function throwIfAborted(signal: AbortSignal) {
    if (signal.aborted) throw abortError();
  }

  function waitForRetryDelay(ms: number, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort, {once: true});
    });
  }

  async function fetchGeneration(
      input: string,
      init: RequestInit & ClientOptions,
      taskId: number,
      signal: AbortSignal
  ): Promise<Response> {
    const retryConfig = options.retryConfig();
    const method = (init.method ?? "GET").toUpperCase();
    const address = options.sanitizeUrl(input);
    const bodyDescription = describeRequestBody(init.body);
    for (let retries = 0; ; retries++) {
      throwIfAborted(signal);
      const startedAt = Date.now();
      options.log(
          "INFO",
          `任务=#${taskId} 发送生成请求: 方法=${method} 地址=${address} 尝试=${retries + 1} HTTP状态重试=${retries}/${retryConfig?.maxRetries ?? 0} 请求体=${bodyDescription}`
      );
      let response: Response;
      try {
        response = await options.fetch(input, {...init, signal});
      } catch (reason) {
        const elapsedMs = Date.now() - startedAt;
        if (signal.aborted) {
          options.log(
              "INFO",
              `任务=#${taskId} 生成请求已取消: 方法=${method} 地址=${address} 用时=${(elapsedMs / 1000).toFixed(1)}s`
          );
          throw reason;
        }
        const timeoutHint = elapsedMs >= 55_000
            ? "；耗时接近或超过 60 秒,优先检查上游响应超时、代理连接和网络链路"
            : "";
        options.log(
            "ERROR",
            `任务=#${taskId} 生成请求传输失败: 方法=${method} 地址=${address} 尝试=${retries + 1} 用时=${(elapsedMs / 1000).toFixed(1)}s 请求体=${bodyDescription} 代理=${options.proxyForLog()} WebView网络状态=${navigator.onLine ? "在线" : "离线"} 错误=${options.formatError(reason)}${timeoutHint}`
        );
        throw reason;
      }
      throwIfAborted(signal);
      const elapsedMs = Date.now() - startedAt;
      options.log(
          "INFO",
          `任务=#${taskId} 收到生成响应: 状态=${response.status} 用时=${(elapsedMs / 1000).toFixed(1)}s 地址=${options.sanitizeUrl(response.url || input)}`
      );
      if (!retryConfig || !retryConfig.statusCodes.has(response.status) || retries >= retryConfig.maxRetries) {
        return response;
      }
      try {
        await response.text();
      } catch (reason) {
        if (signal.aborted) throw reason;
        options.log("ERROR", `任务=#${taskId} 释放重试响应失败: ${options.formatError(reason)}`);
      }
      options.log(
          "INFO",
          `任务=#${taskId} 生成请求返回 ${response.status}，1 秒后进行第 ${retries + 1}/${retryConfig.maxRetries} 次重试`
      );
      await waitForRetryDelay(1000, signal);
    }
  }

  async function parseResponse(response: Response): Promise<any> {
    const text = await response.text();
    options.log("INFO", `响应: ${response.status} ${options.sanitizeUrl(response.url)} 长度=${text.length}`);
    if (!response.ok) {
      let message = text;
      try {
        message = JSON.parse(text)?.error?.message ?? text;
      } catch {
      }
      options.log("ERROR", `响应体: ${options.redact(text.slice(0, 500))}`);
      throw new Error(`请求失败 (${response.status}): ${options.redact(message)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`响应不是 JSON(收到 ${text.slice(0, 50)}...),请检查 API 端点是否正确`);
    }
  }

  async function requestTextCompletion(
      messages: unknown[],
      signal: AbortSignal,
      taskId: number,
      modelName: string,
      connection: OpenAIConnection
  ): Promise<string> {
    const response = await fetchGeneration(
        `${connection.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: connection.jsonHeaders,
          body: JSON.stringify({model: modelName, messages}),
        },
        taskId,
        signal
    );
    const data = await parseResponse(response);
    const content = OpenAIConnection.extractTextContent(data.choices?.[0]?.message?.content);
    if (!content.trim()) throw new Error("响应中没有文字内容");
    return content;
  }

  async function downloadImage(
      base: string,
      url: string,
      signal: AbortSignal,
      logDownload = false
  ): Promise<Blob> {
    const candidates: string[] = [];
    if (/^https?:\/\//i.test(url)) {
      candidates.push(url);
    } else {
      const path = url.startsWith("/") ? url : `/${url}`;
      candidates.push(base + path);
      try {
        const rootUrl = new URL(base).origin + path;
        if (rootUrl !== base + path) candidates.push(rootUrl);
      } catch {
      }
    }
    let lastStatus = 0;
    for (const imageUrl of candidates) {
      throwIfAborted(signal);
      if (logDownload) options.log("INFO", `下载图片: ${options.sanitizeUrl(imageUrl)}`);
      const response = await options.fetch(imageUrl, {signal});
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        throwIfAborted(signal);
        const mime = imageMimeFromBytes(new Uint8Array(buffer), response.headers.get("content-type"));
        return new Blob([buffer], {type: mime});
      }
      lastStatus = response.status;
      if (logDownload) options.log("ERROR", `下载失败 (${response.status}): ${options.sanitizeUrl(imageUrl)}`);
    }
    const address = candidates.map(options.sanitizeUrl).join(" 或 ");
    throw new Error(`下载图片失败 (${lastStatus})${address ? `: ${address}` : ""}`);
  }

  return {fetchGeneration, parseResponse, requestTextCompletion, downloadImage, throwIfAborted};
}

export type GenerationTransport = ReturnType<typeof createGenerationTransport>;

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
