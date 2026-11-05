import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {collectCommits, parseTag, renderNotes} from "../scripts/release-notes.mjs";

let cwd: string;
function git(...args: string[]) {
  return execFileSync("git", args, {cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}
function commit(subject: string) {
  git("commit", "--allow-empty", "-m", subject);
  return git("rev-parse", "HEAD");
}
function tag(name: string) { git("tag", name); }

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "gugle-release-notes-"));
  git("init", "--initial-branch=main");
  git("config", "user.name", "Release Notes Test");
  git("config", "user.email", "release-test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
});
afterEach(() => rmSync(cwd, {recursive: true, force: true}));

describe("release tag parsing", () => {
  it.each(["1.2.3", "v1.2.3", "1.2.3+build.9", "v1.2.3+build.10"])("accepts %s", value => {
    expect(parseTag(value)).toBeTruthy();
  });
  it.each(["", "main", "1.2", "1.2.3-beta.1", "1.2.3+build.x", "1.2.3+build.1-extra", "prefix1.2.3"])("rejects %s", value => {
    expect(parseTag(value)).toBeFalsy();
  });
});

describe("commit ranges from real Git history", () => {
  it("includes initial history newest first, anchored to the release tag rather than HEAD", async () => {
    const first = commit("initial commit");
    const second = commit("feat: first release");
    tag("v1.0.0");
    commit("not released yet");
    const result = await collectCommits({tag: "v1.0.0", cwd});
    expect(result.previousTag).toBeFalsy();
    expect(result.commits).toEqual([{sha: second, subject: "feat: first release"}, {sha: first, subject: "initial commit"}]);
  });

  it("compares build numbers numerically, selecting 10 ahead of 9", async () => {
    commit("build nine"); tag("1.0.0+build.9");
    commit("build ten"); tag("1.0.0+build.10");
    const sha = commit("build eleven"); tag("1.0.0+build.11");
    const result = await collectCommits({tag: "1.0.0+build.11", cwd});
    expect(result.previousTag).toBe("1.0.0+build.10");
    expect(result.commits).toEqual([{sha, subject: "build eleven"}]);
  });

  it("selects the largest semantic version rather than lexical or creation order", async () => {
    commit("old"); tag("1.9.0");
    commit("new"); tag("v1.10.0");
    git("tag", "1.8.0", "HEAD");
    const sha = commit("next"); tag("1.11.0+build.1");
    const result = await collectCommits({tag: "1.11.0+build.1", cwd});
    expect(result.previousTag).toBe("v1.10.0");
    expect(result.commits.map(entry => entry.sha)).toEqual([sha]);
  });

  it("formal releases skip build tags and include all changes since the prior stable release", async () => {
    commit("stable baseline"); tag("v1.0.0");
    const olderBuild = commit("earlier build"); tag("1.0.1+build.7");
    const currentBuild = commit("current build"); tag("1.1.0+build.8");
    const final = commit("release fix"); tag("1.1.0");
    const result = await collectCommits({tag: "1.1.0", cwd});
    expect(result.previousTag).toBe("v1.0.0");
    expect(result.commits.map(entry => entry.sha)).toEqual([final, currentBuild, olderBuild]);
  });

  it("does not treat a same-version stable alias as a previous formal release", async () => {
    commit("baseline"); tag("0.9.0");
    const sha = commit("release"); tag("v1.0.0"); tag("1.0.0");
    const result = await collectCommits({tag: "1.0.0", cwd});
    expect(result.previousTag).toBe("0.9.0");
    expect(result.commits.map(entry => entry.sha)).toEqual([sha]);
  });

  it("reruns ignore the current tag and future versions even if the future tag is an ancestor", async () => {
    commit("baseline"); tag("1.0.0+build.9"); tag("99.0.0");
    const sha = commit("target"); tag("1.0.0+build.10");
    commit("future commit"); tag("1.0.0+build.11");
    const first = await collectCommits({tag: "1.0.0+build.10", cwd});
    expect(first.previousTag).toBe("1.0.0+build.9");
    expect(first.commits.map(entry => entry.sha)).toEqual([sha]);
    expect(await collectCommits({tag: "1.0.0+build.10", cwd})).toEqual(first);
  });

  it("excludes newer eligible tags on unrelated branches", async () => {
    commit("baseline"); tag("1.0.0");
    git("checkout", "-b", "unrelated");
    commit("unrelated release"); tag("1.9.0");
    git("checkout", "main");
    const sha = commit("main release"); tag("2.0.0");
    const result = await collectCommits({tag: "2.0.0", cwd});
    expect(result.previousTag).toBe("1.0.0");
    expect(result.commits.map(entry => entry.sha)).toEqual([sha]);
  });

  it("supports annotated release tags", async () => {
    commit("baseline"); git("tag", "-a", "1.0.0", "-m", "stable release");
    const sha = commit("next release"); git("tag", "-a", "1.1.0", "-m", "next stable");
    const result = await collectCommits({tag: "1.1.0", cwd});
    expect(result.previousTag).toBe("1.0.0");
    expect(result.commits.map(entry => entry.sha)).toEqual([sha]);
  });

  it("allows an empty range when consecutive builds point at the same commit", async () => {
    commit("unchanged build"); tag("1.0.0+build.9"); tag("1.0.0+build.10");
    const result = await collectCommits({tag: "1.0.0+build.10", cwd});
    expect(result.previousTag).toBe("1.0.0+build.9");
    expect(result.commits).toEqual([]);
  });

  it("excludes merge commits without losing commits merged from a feature branch", async () => {
    commit("baseline"); tag("1.0.0");
    git("checkout", "-b", "feature");
    const feature = commit("feature work");
    git("checkout", "main");
    const main = commit("main work");
    git("merge", "--no-ff", "feature", "-m", "merge feature"); tag("1.1.0");
    const result = await collectCommits({tag: "1.1.0", cwd});
    expect(result.commits.map(entry => entry.sha).sort()).toEqual([feature, main].sort());
  });

  it("supports the exact commit of a not-yet-created build tag", async () => {
    commit("baseline"); tag("1.0.0+build.9");
    const targetSha = commit("target build");
    commit("newer HEAD");
    const result = await collectCommits({tag: "1.0.0+build.10", targetSha, cwd});
    expect(result.previousTag).toBe("1.0.0+build.9");
    expect(result.commits).toEqual([{sha: targetSha, subject: "target build"}]);
  });

  it("preserves unusual subjects from Git without delimiter loss", async () => {
    const subject = "fix: 中文 | [link](url) <html> `code` \"quotes\" \t tabs";
    const sha = commit(subject); tag("1.0.0");
    const result = await collectCommits({tag: "1.0.0", cwd});
    expect(result.commits).toEqual([{sha, subject}]);
  });

  it("freezes the baseline SHA even when the previous tag moves before finalization", async () => {
    const baseline = commit("baseline"); tag("1.0.0");
    const second = commit("second commit");
    const targetSha = commit("release commit"); tag("1.1.0");
    const prepared = await collectCommits({tag: "1.1.0", cwd});
    expect(prepared.previousSha).toBe(baseline);
    git("tag", "--force", "1.0.0", second);
    const finalized = await collectCommits({
      tag: "1.1.0", cwd, targetSha,
      previousTag: prepared.previousTag, previousSha: prepared.previousSha,
    });
    expect(finalized).toEqual(prepared);
    expect(finalized.commits.map(entry => entry.sha)).toEqual([targetSha, second]);
  });

  it("allows a frozen empty baseline when finalizing an initial release", async () => {
    const sha = commit("initial release"); tag("1.0.0+build.1");
    const result = await collectCommits({tag: "1.0.0+build.2", targetSha: sha, previousTag: "", cwd});
    expect(result.previousTag).toBe("");
    expect(result.commits.map(entry => entry.sha)).toEqual([sha]);
  });

  it("rejects an explicitly supplied baseline from an unrelated branch", async () => {
    commit("baseline");
    git("checkout", "-b", "unrelated");
    commit("unrelated release"); tag("1.0.0");
    git("checkout", "main");
    commit("target"); tag("2.0.0");
    await expect(Promise.resolve().then(() => collectCommits({tag: "2.0.0", previousTag: "1.0.0", cwd}))).rejects.toThrow();
  });

  it("rejects a missing target tag instead of silently using HEAD", async () => {
    commit("not tagged");
    await expect(Promise.resolve().then(() => collectCommits({tag: "1.0.0", cwd}))).rejects.toThrow();
  });
});

const repo = "owner/GugleAI";
const sha = "a".repeat(40);
function notes(overrides = {}) {
  return renderNotes({repo, tag: "1.1.0+build.10", previousTag: "v1.0.0+build.9", commits: [{sha, subject: "feat: better images"}], assets: [], ...overrides});
}

describe("release note rendering", () => {
  it("renders bilingual headings, commit links and URL-encoded comparison refs", () => {
    const body = notes();
    expect(body).toMatch(/changed|changes|commits|what.s new/i);
    expect(body).toMatch(/更新|提交|变更/);
    expect(body).toContain(`https://github.com/${repo}/commit/${sha}`);
    expect(body).toContain(`https://github.com/${repo}/compare/v1.0.0%2Bbuild.9...1.1.0%2Bbuild.10`);
    expect(body).toContain("feat: better images");
  });

  it("does not render a broken comparison for the first release", () => {
    const body = notes({previousTag: null});
    expect(body).not.toContain("/compare/");
    expect(body).not.toMatch(/undefined|null/);
  });

  it("renders empty ranges without undefined values", () => {
    const body = notes({commits: []});
    expect(body).not.toMatch(/undefined|null/);
    expect(body).toContain("/compare/");
  });

  it("escapes commit subjects so user text cannot inject links or HTML", () => {
    const subject = "fix: [click](https://example.invalid) <img src=x> *bold* | table `code` 中文";
    const body = notes({commits: [{sha, subject}]});
    expect(body).not.toContain(subject);
    expect(body).not.toContain("<img src=x>");
    expect(body).not.toContain("[click](https://example.invalid)");
    expect(body).toContain("中文");
    expect(body).toContain(`/commit/${sha}`);
  });

  it("preserves installer classification, asset URLs and safely escaped download labels", () => {
    const assets = [
      ["GugleAI_x64-setup.exe", "Windows | x86_64 | NSIS 安装包"],
      ["GugleAI-android-arm64.apk", "Android | arm64 | APK"],
      ["GugleAI_amd64.AppImage", "Linux | x86_64 | AppImage"],
      ["GugleAI_aarch64.dmg", "macOS | Apple Silicon (arm64) | dmg"],
      ["odd|[asset]<name>.zip", "其他 | - | -"],
    ].map(([name, classification], index) => ({name, classification, browser_download_url: `https://example.invalid/download/${index}`}));
    const body = notes({assets});
    for (const asset of assets) {
      expect(body).toContain(asset.classification);
      expect(body).toContain(asset.browser_download_url);
    }
    expect(body).not.toContain("odd|[asset]<name>.zip");
    expect(body).not.toContain("<name>");
    expect(body).toMatch(/下载/);
  });
});


describe.skipIf(process.platform === "win32")("release workflow resolution", () => {
  function resolveRelease({event = "push", releaseId = "", releases = [] as {tag_name: string; id: number}[][]} = {}) {
    // Execute the actual workflow body, replacing only gh with a local shell mock.
    const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
    const step = workflow.split("      - name: Resolve release\n")[1];
    expect(step).toBeTruthy();
    const body = step.split("        run: |\n")[1].split("\n\n")[0]
      .split("\n").map(line => line.replace(/^          /, "")).join("\n");
    writeFileSync(join(cwd, "mock-releases.json"), JSON.stringify(releases));
    const output = join(cwd, "github-output");
    writeFileSync(output, "");
    writeFileSync(join(cwd, "gh-calls"), "");
    const mock = `gh() {
      printf '%s\\n' "$*" >> gh-calls
      if [ "$2" = "--paginate" ]; then
        cat mock-releases.json
      else
        printf '999\\n'
      fi
    }`;
    execFileSync("bash", ["-e", "-c", mock + "\n" + body], {
      cwd, encoding: "utf8",
      env: {...process.env, EVENT_NAME: event, RELEASE_ID: releaseId,
        TAG: "1.1.0+build.10", TARGET_SHA: sha, REPO: repo, GITHUB_OUTPUT: output},
    });
    return {output: readFileSync(output, "utf8"), calls: readFileSync(join(cwd, "gh-calls"), "utf8").trim().split("\n").filter(Boolean)};
  }

  it("reuses the matching release from later paginated results without creating a duplicate", () => {
    const result = resolveRelease({releases: [[{tag_name: "1.1.0+build.9", id: 100}], [{tag_name: "1.1.0+build.10", id: 101}]]});
    expect(result.output).toContain("release_id=101\n");
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toContain("--paginate --slurp");
  });

  it("creates a new build release at the frozen target SHA when no exact tag matches", () => {
    const result = resolveRelease({releases: [[{tag_name: "1.1.0+build.9", id: 100}]]});
    expect(result.output).toContain("release_id=999\n");
    expect(result.calls).toHaveLength(2);
    expect(result.calls[1]).toContain("-f tag_name=1.1.0+build.10");
    expect(result.calls[1]).toContain(`-f target_commitish=${sha}`);
    expect(result.calls[1]).toContain("-F body=@body.md");
    expect(result.calls[1]).toContain("-F prerelease=true");
  });

  it("uses the existing release-event ID without listing or creating a release", () => {
    const result = resolveRelease({event: "release", releaseId: "123"});
    expect(result.output).toContain("release_id=123\n");
    expect(result.calls).toEqual([]);
  });
});
