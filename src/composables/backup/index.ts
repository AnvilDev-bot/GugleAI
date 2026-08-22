import {computed, onMounted, onUnmounted, ref, watch, type Ref} from "vue";
import {save} from "@tauri-apps/plugin-dialog";
import {invoke} from "@tauri-apps/api/core";
import {arrayBufferToBase64} from "../../services/transport";
import {
  backupArchiveName,
  createBackupArchive,
  deleteBackup as deleteStoredBackup,
  getBackup,
  listBackups,
  putBackup,
  pruneAutomaticBackups,
  readBackupArchive,
  restoreBackupContents,
  type BackupKind,
  type BackupMetadata,
} from "../../services/backup";

export const BACKUP_SETTINGS_KEY = "gugle-ai-backup-settings";

interface BackupOptions {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  error: Ref<string>;
  errorMessage(value: unknown): string;
}

export function useBackup(options: BackupOptions) {
  const backups = ref<BackupMetadata[]>([]);
  const backupLoading = ref(false);
  const backupBusy = ref(false);
  const backupStatus = ref("");
  const autoBackupEnabled = ref(false);
  const autoBackupIntervalMinutes = ref(1440);
  const automaticBackupRetention = ref(5);
  const webdavEnabled = ref(false);
  const webdavBackupIntervalMinutes = ref(1440);
  const webdavAutomaticBackupRetention = ref(5);
  const webdavUrl = ref("");
  const webdavPath = ref("gugle-ai-backups");
  const webdavUsername = ref("");
  const webdavPassword = ref("");
  const webdavBackups = ref<string[]>([]);
  const webdavLoading = ref(false);
  const webdavTesting = ref(false);
  const webdavTestStatus = ref<"idle" | "success" | "error">("idle");
  let autoBackupTimer: number | null = null;
  let startupCheckTimer: number | null = null;

  restoreSettings();
  watch(
      [
        autoBackupEnabled,
        autoBackupIntervalMinutes,
        automaticBackupRetention,
        webdavEnabled,
        webdavBackupIntervalMinutes,
        webdavAutomaticBackupRetention,
        webdavUrl,
        webdavPath,
        webdavUsername,
        webdavPassword,
      ],
      persistSettings,
      {deep: true}
  );
  watch(automaticBackupRetention, (value) => {
    void pruneAutomaticBackups(value).then(refreshBackups).catch((reason) => {
      reportBackupError("清理自动备份", reason);
    });
  });
  watch(webdavAutomaticBackupRetention, () => {
    if (!webdavConfigured.value || webdavLoading.value) return;
    void listWebdavBackupNames()
        .then((names) => {
          webdavBackups.value = names;
          return pruneWebdavAutomaticBackups(names);
        })
        .catch((reason) => {
          reportBackupError("清理 WebDAV 自动备份", reason);
        });
  });
  watch([webdavUrl, webdavPath, webdavUsername, webdavPassword], () => {
    webdavTestStatus.value = "idle";
  });

  const latestBackup = computed(() => backups.value[0] ?? null);
  const automaticBackups = computed(() => backups.value.filter((item) => item.kind === "automatic"));

  async function refreshBackups() {
    backupLoading.value = true;
    try {
      backups.value = await listBackups();
    } catch (reason) {
      reportBackupError("加载备份", reason);
    } finally {
      backupLoading.value = false;
    }
  }

  async function createBackup(kind: BackupKind = "manual") {
    if (backupBusy.value) return;
    backupBusy.value = true;
    backupStatus.value = "";
    try {
      const archive = await createBackupArchive();
      await putBackup(archive, kind, automaticBackupRetention.value);
      await refreshBackups();
      backupStatus.value = `${kind === "automatic" ? "自动" : "手动"}备份已创建`;
    } catch (reason) {
      reportBackupError("创建备份", reason);
    } finally {
      backupBusy.value = false;
    }
  }

  async function deleteBackup(id: string) {
    const backup = backups.value.find((item) => item.id === id);
    if (!backup || !window.confirm(`确定删除备份“${backup.name}”吗？此操作无法撤销。`)) return;
    try {
      await deleteStoredBackup(id);
      backups.value = backups.value.filter((item) => item.id !== id);
      backupStatus.value = "备份已删除";
    } catch (reason) {
      reportBackupError("删除备份", reason);
    }
  }

  async function exportBackup(id: string) {
    const backup = await getBackup(id);
    if (!backup) {
      reportBackupError("导出备份", new Error("备份不存在"));
      return;
    }
    const path = await save({
      defaultPath: backup.name,
      filters: [{name: "GugleAI 备份", extensions: ["zip"]}],
    });
    if (!path) return;
    try {
      await invoke("save_file", {
        path,
        base64Data: arrayBufferToBase64(await backup.blob.arrayBuffer()),
      });
      backupStatus.value = "备份已导出";
    } catch (reason) {
      reportBackupError("导出备份", reason);
    }
  }

  async function importBackup(file: File | Blob) {
    if (backupBusy.value) return;
    backupBusy.value = true;
    try {
      const contents = await readBackupArchive(file);
      if (!window.confirm("导入备份会覆盖当前设置、聊天、预览历史和画布数据，确定继续吗？")) return;
      await restoreBackupContents(contents);
      backupStatus.value = "备份已导入，正在重新加载应用";
      window.setTimeout(() => window.location.reload(), 250);
    } catch (reason) {
      reportBackupError("导入备份", reason);
    } finally {
      backupBusy.value = false;
    }
  }

  function onImportBackup(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) void importBackup(file);
  }

  async function testWebdav() {
    if (!webdavConfigured.value) {
      webdavTestStatus.value = "error";
      reportBackupError("测试 WebDAV", new Error("请先填写 WebDAV 地址和账号"));
      return;
    }
    if (webdavTesting.value || webdavLoading.value) return;
    webdavTesting.value = true;
    webdavTestStatus.value = "idle";
    try {
      const response = await webdavRequest(webdavDirectoryUrl.value, "PROPFIND", undefined, {Depth: "0"});
      if (!response.ok && response.status !== 207) throw new Error(`WebDAV 返回 HTTP ${response.status}`);
      webdavTestStatus.value = "success";
      backupStatus.value = "WebDAV 连接成功";
    } catch (reason) {
      webdavTestStatus.value = "error";
      reportBackupError("测试 WebDAV", reason);
    } finally {
      webdavTesting.value = false;
    }
  }

  async function refreshWebdavBackups() {
    if (!webdavConfigured.value) return;
    webdavLoading.value = true;
    try {
      webdavBackups.value = await listWebdavBackupNames();
    } catch (reason) {
      reportBackupError("读取 WebDAV 备份", reason);
    } finally {
      webdavLoading.value = false;
    }
  }

  async function downloadWebdavBackup(name: string) {
    if (!webdavConfigured.value || !name) return;
    webdavLoading.value = true;
    try {
      const archive = await fetchWebdavBackup(name);
      await putBackup(archive, "manual", automaticBackupRetention.value);
      await refreshBackups();
      backupStatus.value = "WebDAV 备份已下载到本地";
    } catch (reason) {
      reportBackupError("下载 WebDAV 备份", reason);
    } finally {
      webdavLoading.value = false;
    }
  }

  async function restoreWebdavBackup(name: string) {
    if (!webdavConfigured.value || !name || backupBusy.value || webdavLoading.value) return;
    webdavLoading.value = true;
    try {
      const archive = await fetchWebdavBackup(name);
      await importBackup(archive);
    } catch (reason) {
      reportBackupError("从 WebDAV 恢复", reason);
    } finally {
      webdavLoading.value = false;
    }
  }

  async function uploadBackup(id: string) {
    const backup = await getBackup(id);
    if (!backup || webdavLoading.value) return;
    webdavLoading.value = true;
    try {
      await uploadBackupArchive(backup, backup.blob);
      webdavBackups.value = await listWebdavBackupNames();
      backupStatus.value = "备份已上传到 WebDAV";
    } catch (reason) {
      reportBackupError("上传 WebDAV 备份", reason);
    } finally {
      webdavLoading.value = false;
    }
  }

  async function uploadBackupArchive(metadata: BackupMetadata, archive: Blob) {
    const response = await webdavRequest(
        webdavFileUrl(metadata.name),
        "PUT",
        archive,
        {"Content-Type": "application/zip"}
    );
    if (!response.ok) throw new Error(`WebDAV 返回 HTTP ${response.status}`);
  }

  async function fetchWebdavBackup(name: string): Promise<Blob> {
    const response = await webdavRequest(webdavFileUrl(name), "GET");
    if (!response.ok) throw new Error(`WebDAV 返回 HTTP ${response.status}`);
    return response.blob();
  }

  async function listWebdavBackupNames(): Promise<string[]> {
    const response = await webdavRequest(webdavDirectoryUrl.value, "PROPFIND", undefined, {Depth: "1"});
    if (!response.ok && response.status !== 207) throw new Error(`WebDAV 返回 HTTP ${response.status}`);
    const xml = await response.text();
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("WebDAV 返回了无效的 XML");
    return [...document.getElementsByTagNameNS("*", "href")]
        .map((element) => decodeWebdavHref(element.textContent ?? ""))
        .map((value) => value.split("/").filter(Boolean).pop() ?? "")
        .filter((name, index, names) => name.endsWith(".zip") && names.indexOf(name) === index)
        .sort((left, right) => (webdavBackupTimestamp(right) ?? 0) - (webdavBackupTimestamp(left) ?? 0));
  }

  async function pruneWebdavAutomaticBackups(names = webdavBackups.value) {
    const keep = finiteRange(webdavAutomaticBackupRetention.value, 5, 1, 100);
    const automatic = names
        .filter((name) => webdavAutomaticBackupTimestamp(name) !== null)
        .sort((left, right) => webdavAutomaticBackupTimestamp(right)! - webdavAutomaticBackupTimestamp(left)!);
    for (const name of automatic.slice(keep)) {
      const response = await webdavRequest(webdavFileUrl(name), "DELETE");
      if (!response.ok && response.status !== 404) {
        throw new Error(`删除远程备份 ${name} 时 WebDAV 返回 HTTP ${response.status}`);
      }
    }
    if (automatic.length > keep) webdavBackups.value = await listWebdavBackupNames();
  }

  async function createWebdavAutomaticBackup() {
    if (backupBusy.value || webdavLoading.value || !webdavConfigured.value) return;
    backupBusy.value = true;
    webdavLoading.value = true;
    try {
      const createdAt = Date.now();
      const archive = await createBackupArchive();
      const metadata: BackupMetadata = {
        id: `webdav-${createdAt}`,
        name: backupArchiveName("automatic", createdAt),
        kind: "automatic",
        createdAt,
        size: archive.size,
      };
      await uploadBackupArchive(metadata, archive);
      webdavBackups.value = await listWebdavBackupNames();
      await pruneWebdavAutomaticBackups(webdavBackups.value);
      backupStatus.value = "WebDAV 自动备份已创建";
    } catch (reason) {
      reportBackupError("创建 WebDAV 自动备份", reason);
    } finally {
      backupBusy.value = false;
      webdavLoading.value = false;
    }
  }

  async function webdavRequest(
      url: string,
      method: string,
      body?: BodyInit,
      extraHeaders: Record<string, string> = {}
  ): Promise<Response> {
    const headers: Record<string, string> = {...extraHeaders};
    if (webdavUsername.value || webdavPassword.value) {
      headers.Authorization = `Basic ${encodeBasicAuth(webdavUsername.value, webdavPassword.value)}`;
    }
    return options.fetch(url, {method, headers, body});
  }

  async function checkAutomaticBackup() {
    if (!autoBackupEnabled.value || backupBusy.value) return;
    await refreshBackups();
    const latest = latestBackup.value;
    const interval = Math.max(1, Number(autoBackupIntervalMinutes.value) || 1) * 60 * 1000;
    if (!latest || Date.now() - latest.createdAt >= interval) await createBackup("automatic");
  }

  async function checkWebdavAutomaticBackup() {
    if (!webdavEnabled.value || !webdavConfigured.value || backupBusy.value || webdavLoading.value) return;
    try {
      const names = await listWebdavBackupNames();
      webdavBackups.value = names;
      await pruneWebdavAutomaticBackups(names);
      const latest = names
          .map(webdavAutomaticBackupTimestamp)
          .filter((timestamp): timestamp is number => timestamp !== null)
          .sort((left, right) => right - left)[0];
      const interval = finiteRange(webdavBackupIntervalMinutes.value, 1440, 1, 525600) * 60 * 1000;
      if (!latest || Date.now() - latest >= interval) await createWebdavAutomaticBackup();
    } catch (reason) {
      reportBackupError("检查 WebDAV 自动备份", reason);
    }
  }

  function reportBackupError(action: string, reason: unknown, setError = true) {
    const message = `备份${action}失败: ${options.errorMessage(reason)}`;
    if (setError) options.error.value = message;
  }

  function restoreSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(BACKUP_SETTINGS_KEY) ?? "null");
      if (!saved || typeof saved !== "object") return;
      autoBackupEnabled.value = saved.autoBackupEnabled === true;
      autoBackupIntervalMinutes.value = finiteRange(saved.autoBackupIntervalMinutes, 1440, 1, 525600);
      automaticBackupRetention.value = finiteRange(saved.automaticBackupRetention, 5, 1, 100);
      webdavEnabled.value = saved.webdavEnabled === true;
      webdavBackupIntervalMinutes.value = finiteRange(saved.webdavBackupIntervalMinutes, 1440, 1, 525600);
      webdavAutomaticBackupRetention.value = finiteRange(saved.webdavAutomaticBackupRetention, 5, 1, 100);
      webdavUrl.value = stringValue(saved.webdavUrl);
      webdavPath.value = stringValue(saved.webdavPath) || "gugle-ai-backups";
      webdavUsername.value = stringValue(saved.webdavUsername);
      webdavPassword.value = stringValue(saved.webdavPassword);
    } catch {
    }
  }

  function persistSettings() {
    localStorage.setItem(BACKUP_SETTINGS_KEY, JSON.stringify({
      autoBackupEnabled: autoBackupEnabled.value,
      autoBackupIntervalMinutes: finiteRange(autoBackupIntervalMinutes.value, 1440, 1, 525600),
      automaticBackupRetention: finiteRange(automaticBackupRetention.value, 5, 1, 100),
      webdavEnabled: webdavEnabled.value,
      webdavBackupIntervalMinutes: finiteRange(webdavBackupIntervalMinutes.value, 1440, 1, 525600),
      webdavAutomaticBackupRetention: finiteRange(webdavAutomaticBackupRetention.value, 5, 1, 100),
      webdavUrl: webdavUrl.value.trim(),
      webdavPath: webdavPath.value.trim(),
      webdavUsername: webdavUsername.value,
      webdavPassword: webdavPassword.value,
    }));
  }

  onMounted(() => {
    void refreshBackups();
    // 自动备份检查可能触发全量打包上传,延迟到首屏渲染稳定后再执行
    startupCheckTimer = window.setTimeout(() => {
      startupCheckTimer = null;
      void checkAutomaticBackup().then(checkWebdavAutomaticBackup);
    }, 3000);
    autoBackupTimer = window.setInterval(() => {
      void checkAutomaticBackup().then(checkWebdavAutomaticBackup);
    }, 60 * 1000);
  });
  onUnmounted(() => {
    if (startupCheckTimer !== null) window.clearTimeout(startupCheckTimer);
    if (autoBackupTimer !== null) window.clearInterval(autoBackupTimer);
  });

  const webdavConfigured = computed(() => Boolean(webdavUrl.value.trim()));
  const webdavDirectoryUrl = computed(() => buildWebdavUrl(webdavUrl.value, webdavPath.value));
  const webdavFileUrl = (name: string) => `${webdavDirectoryUrl.value.replace(/\/+$/, "")}/${encodeURIComponent(name)}`;

  return {
    backups,
    automaticBackups,
    latestBackup,
    backupLoading,
    backupBusy,
    backupStatus,
    autoBackupEnabled,
    autoBackupIntervalMinutes,
    automaticBackupRetention,
    webdavEnabled,
    webdavBackupIntervalMinutes,
    webdavAutomaticBackupRetention,
    webdavUrl,
    webdavPath,
    webdavUsername,
    webdavPassword,
    webdavConfigured,
    webdavBackups,
    webdavLoading,
    webdavTesting,
    webdavTestStatus,
    refreshBackups,
    createBackup,
    deleteBackup,
    exportBackup,
    onImportBackup,
    testWebdav,
    refreshWebdavBackups,
    downloadWebdavBackup,
    restoreWebdavBackup,
    uploadBackup,
    formatBackupDate,
    formatBackupSize,
  };
}

function buildWebdavUrl(base: string, path: string): string {
  const normalizedBase = base.trim().replace(/\/+$/, "");
  const segments = path.split("/").map((item) => item.trim()).filter(Boolean).map(encodeURIComponent);
  return segments.length ? `${normalizedBase}/${segments.join("/")}` : normalizedBase;
}

function encodeBasicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function finiteRange(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function decodeWebdavHref(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function webdavAutomaticBackupTimestamp(name: string): number | null {
  if (!name.startsWith("gugle-ai-auto-")) return null;
  return webdavBackupTimestamp(name);
}

function webdavBackupTimestamp(name: string): number | null {
  const match = name.match(/-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{3})\.zip$/i);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, millisecond] = match;
  const timestamp = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(millisecond)
  ).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatBackupDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN");
}

function formatBackupSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / 1024 / 1024).toFixed(1)} MiB`;
}

export type BackupSettings = ReturnType<typeof useBackup>;
