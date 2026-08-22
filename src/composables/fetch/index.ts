import {fetch as httpFetch, type ClientOptions} from "@tauri-apps/plugin-http";
import {invoke} from "@tauri-apps/api/core";

type Log = (level: "INFO" | "ERROR", message: string) => void;

const PROXY_CACHE_TTL_MS = 30_000;

export function useSystemFetch(log: Log, sanitizeUrl: (value: string) => string) {
  let lastProxy: string | null | undefined;
  let cachedProxy: string | null | undefined;
  let cachedAt = 0;

  async function fetch(input: string, init?: RequestInit & ClientOptions): Promise<Response> {
    const options = {...init};
    if (!options.proxy) {
      // 系统代理探测要走 Tauri IPC(Windows 下读注册表),短时间缓存避免每个请求都探测一次
      const now = Date.now();
      if (cachedProxy === undefined || now - cachedAt >= PROXY_CACHE_TTL_MS) {
        try {
          cachedProxy = await invoke<string | null>("get_system_proxy");
          cachedAt = now;
        } catch {
        }
        if (cachedProxy !== undefined && cachedProxy !== lastProxy) {
          lastProxy = cachedProxy;
          log("INFO", cachedProxy ? `使用系统代理: ${sanitizeUrl(cachedProxy)}` : "系统代理已关闭,直连");
        }
      }
      if (cachedProxy) options.proxy = {all: cachedProxy};
    }
    return httpFetch(input, options);
  }

  function proxyForLog(): string {
    if (lastProxy === undefined) return "未知";
    return lastProxy ? sanitizeUrl(lastProxy) : "直连";
  }

  return {fetch, proxyForLog};
}
