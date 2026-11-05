// Commit-based release notes, inspired by dsh-launcher. Never invokes a shell.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parseTag(tag) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+build\.(0|[1-9]\d*))?$/.exec(tag);
  return match ? { base: match.slice(1, 4).map(BigInt), build: match[4] === undefined ? null : BigInt(match[4]) } : null;
}
function compareBase(a, b) {
  for (let i = 0; i < 3; i++) if (a.base[i] !== b.base[i]) return a.base[i] < b.base[i] ? -1 : 1;
  return 0;
}
function compareTags(a, b) {
  const base = compareBase(a, b);
  if (base) return base;
  // Stable releases rank above builds of their own base version.
  if (a.build === b.build) return 0;
  if (a.build === null) return 1;
  if (b.build === null) return -1;
  return a.build < b.build ? -1 : 1;
}
export function collectCommits({ tag, cwd = process.cwd(), targetSha, previousTag, previousSha }) {
  const current = parseTag(tag);
  if (!current) throw new Error(`Unsupported release tag: ${tag}`);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  const target = git('rev-parse', '--verify', '--end-of-options', `${targetSha || `refs/tags/${tag}`}^{commit}`);
  if (previousTag === undefined) {
    const candidates = git('tag', '--merged', target).split('\n').filter(Boolean)
      .map(name => ({ name, parsed: parseTag(name) }))
      .filter(({ name, parsed }) => name !== tag && parsed && (
        current.build === null
          ? parsed.build === null && compareBase(parsed, current) < 0
          : compareBase(parsed, current) < 0 || (compareBase(parsed, current) === 0 && parsed.build !== null && parsed.build < current.build)
      ))
      .sort((a, b) => compareTags(b.parsed, a.parsed) || a.name.localeCompare(b.name));
    previousTag = candidates[0]?.name || '';
  }
  let base;
  if (previousTag) {
    if (!parseTag(previousTag)) throw new Error('Invalid previous tag');
    base = git('rev-parse', '--verify', '--end-of-options', `${previousSha || `refs/tags/${previousTag}`}^{commit}`);
    git('merge-base', '--is-ancestor', base, target);
  }
  const log = git('log', '--no-merges', '--format=%H%x00%s', base ? `${base}..${target}` : target, '--');
  const commits = log ? log.split('\n').map(line => {
    const [sha, ...subject] = line.split('\0');
    return { sha, subject: subject.join('\0') };
  }) : [];
  return { previousTag, previousSha: base || '', commits, targetSha: target };
}
export function escapeMarkdown(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&').replace(/[\r\n]/g, ' ');
}
function safeUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Release asset URLs must use HTTPS');
  return parsed.href.replace(/>/g, '%3E').replace(/</g, '%3C');
}
export function renderNotes({ repo, tag, previousTag = '', commits = [], assets = null }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Invalid repository');
  const root = `https://github.com/${repo}`;
  const list = commits.map(({ sha, subject }) => {
    if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Invalid commit SHA');
    return `- ${escapeMarkdown(subject)} ([${sha.slice(0, 7)}](${root}/commit/${sha}))`;
  }).join('\n') || '_No new commits / 没有新增提交。_';
  const comparison = previousTag
    ? `**Full Changelog / 完整变更**: ${root}/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(tag)}`
    : `**Full History / 完整历史**: ${root}/commits/${encodeURIComponent(tag)}`;
  const notes = `## What's Changed / 更新内容\n\n${list}\n\n${comparison}`;
  if (assets === null) return `${notes}\n\n_Artifacts are being prepared / 正在准备安装包。_\n`;
  const rules = [
    [/_x64-setup\.exe$/,      "Windows", "x86_64",                "NSIS 安装包"],
    [/_x86-setup\.exe$/,      "Windows", "x86 (32位)",            "NSIS 安装包"],
    [/_arm64-setup\.exe$/,    "Windows", "arm64",                 "NSIS 安装包"],
    [/_x64[^/]*\.msi$/,       "Windows", "x86_64",                "MSI 安装包"],
    [/_x86[^/]*\.msi$/,       "Windows", "x86 (32位)",            "MSI 安装包"],
    [/-android-arm64\.apk$/,  "Android", "arm64",                 "APK"],
    [/_amd64\.deb$/,          "Linux",   "x86_64",                "deb"],
    [/_arm64\.deb$/,          "Linux",   "arm64",                 "deb"],
    [/\.x86_64\.rpm$/,        "Linux",   "x86_64",                "rpm"],
    [/\.aarch64\.rpm$/,       "Linux",   "arm64",                 "rpm"],
    [/_amd64\.AppImage$/,     "Linux",   "x86_64",                "AppImage"],
    [/_aarch64\.AppImage$/,   "Linux",   "arm64",                 "AppImage"],
    [/_x64\.dmg$/,            "macOS",   "Intel (x86_64)",        "dmg"],
    [/_aarch64\.dmg$/,        "macOS",   "Apple Silicon (arm64)", "dmg"],
    [/x64\.app\.tar\.gz$/,    "macOS",   "Intel (x86_64)",        "app 压缩包"],
    [/aarch64\.app\.tar\.gz$/,"macOS",   "Apple Silicon (arm64)", "app 压缩包"],
  ];

  const rows = assets
    .map((a) => {
      const i = rules.findIndex(([re]) => re.test(a.name));
      const [, os, arch, kind] = i === -1 ? [null, "其他", "-", "-"] : rules[i];
      return { order: i === -1 ? rules.length : i, os, arch, kind, a };
    })
    .sort((x, y) => x.order - y.order)
    .map((r) => `| ${r.os} | ${r.arch} | ${r.kind} | [${escapeMarkdown(r.a.name)}](<${safeUrl(r.a.browser_download_url)}>) |`);

  const table = [
    "## Downloads / 下载", "",
    "| Platform / 平台 | Architecture / 架构 | Format / 格式 | Download / 下载 |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
  return `${notes}\n\n${table}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.env.TAG;
  const data = collectCommits({ tag, targetSha: process.env.TARGET_SHA, previousTag: process.env.PREVIOUS_TAG, previousSha: process.env.PREVIOUS_SHA });
  const assets = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')).assets : null;
  writeFileSync('body.md', renderNotes({ repo: process.env.REPO, tag, ...data, assets }));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    `tag=${tag}\nprevious_tag=${data.previousTag}\nprevious_sha=${data.previousSha}\ntarget_sha=${data.targetSha}\n`);
}
