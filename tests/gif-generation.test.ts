import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {effectScope, nextTick, ref} from "vue";
import {useGenerationSettings} from "../src/composables/settings/generation";
import {useAppSettings} from "../src/composables/settings/app";
import {useProviderSettings} from "../src/composables/settings/provider";
import {useImageWorkspace} from "../src/composables/workspace/image";
import {useCanvasWorkspace} from "../src/composables/workspace/canvas";
import {CanvasGraph} from "../src/canvas";
import {base64ToBlob, imageExtension, SETTINGS_KEY} from "../src/domain/models";
import {createGenerationTransport} from "../src/services/transport";
import {save} from "@tauri-apps/plugin-dialog";

vi.mock("vue", async (original) => ({...await original(), onMounted: vi.fn(), onUnmounted: vi.fn()}));
vi.mock("vue-router", () => ({useRouter: () => ({push: vi.fn(), beforeEach: vi.fn(() => vi.fn())})}));
vi.mock("@tauri-apps/plugin-dialog", () => ({save: vi.fn(async () => null)}));

const models = ["gpt-image-2.6-sunburst", "gpt-image-2.6-flare"];
const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAAAAAAALAAAAAABAAEAAAIBRAA7";
const params = {output_format: "gif", frame_count: 9, frame_duration_ms: 200};
let scope: ReturnType<typeof effectScope>;
beforeEach(() => {
  scope = effectScope();
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value)});
});
afterEach(() => {scope.stop(); vi.unstubAllGlobals(); vi.clearAllMocks();});

function setup(model = models[0]) {
  const settings = useGenerationSettings();
  settings.outputFormat.value = "gif";
  const provider = {id: "provider", name: "Test", endpoint: "https://example.test", imageEndpoint: "", apiKey: "", models: [{id:model, isImage:true, displayName:"", description:"", contextLength:0}]};
  const selection = ref(model);
  const resolved = () => ({provider, model: {id: selection.value, isImage: true, displayName: "", description: "", contextLength: 0}});
  const transport = {
    fetchGeneration: vi.fn(async () => new Response("{}")),
    parseResponse: vi.fn(async () => ({data: [{b64_json: gif}], choices: [{message: {images: [{image_url: {url: `data:image/png;base64,${gif}`}}]}}]})),
    throwIfAborted: vi.fn(), downloadImage: vi.fn(), requestTextCompletion: vi.fn(),
  };
  const addResultImage = vi.fn(async (blob, mime, prompt, ids) => {ids.add("result"); return {id: "result", blob, mime, prompt, previewUrl: "", createdAt: 0};});
  const image = scope.run(() => useImageWorkspace({
    imageModelSelection: selection, resolveModelSelection: resolved, addConnection: vi.fn(), generationSettings: settings,
    transport, nextTaskId: () => 1, addResultImage, log: vi.fn(), sanitizeUrl: String, errorMessage: String, formatErrorDetails: String,
  }))!;
  image.prompt.value = "A moving cake";
  return {settings, provider, selection, resolved, transport, addResultImage, image};
}

function bodyOf(transport: ReturnType<typeof setup>["transport"]) {
  const [url, init] = transport.fetchGeneration.mock.calls[0] as unknown as [string, RequestInit];
  return {url, body: init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(init.body as string)};
}

describe("GIF options", () => {
  it("keeps existing models/default output unchanged", () => {
    const settings = useGenerationSettings();
    expect(settings.imageOutputOptions(models[0])).toEqual({});
    settings.outputFormat.value = "gif";
    expect(settings.imageOutputOptions("gpt-image-2")).toEqual({});
    for (const model of models) expect(settings.imageOutputOptions(model)).toEqual(params);
  });
  it.each([[2,20],[64,2000],[9,200]])("accepts %i frames at %i ms", (count, duration) => {
    const {settings} = setup(); settings.frameCount.value = count; settings.frameDurationMs.value = duration;
    expect(settings.imageOutputOptions(models[0])).toEqual({...params, frame_count: count, frame_duration_ms: duration});
  });
  it.each([1,65,2.5,NaN,Infinity,undefined,null])("rejects invalid frame count %s", (value) => {
    const {settings} = setup(); settings.frameCount.value = value as number;
    expect(() => settings.imageOutputOptions(models[0])).toThrow(/帧数/);
  });
  it.each([19,2001,20.5,NaN,Infinity,undefined,null])("rejects invalid frame duration %s", (value) => {
    const {settings} = setup(); settings.frameDurationMs.value = value as number;
    expect(() => settings.imageOutputOptions(models[0])).toThrow(/时长/);
  });
  it("restores and watches persisted options, safely migrating old/invalid settings", async () => {
    function restore(saved: object) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved));
      return scope.run(() => {
        const generation = useGenerationSettings();
        const providers = useProviderSettings({canvasNodes: ref([]), updateCanvasNodeData: vi.fn()});
        useAppSettings({providers, generation, themeMode: ref("system")});
        return generation;
      })!;
    }
    for (const saved of [{}, {outputFormat: "bad", frameCount: 65, frameDurationMs: 19}]) {
      const settings = restore(saved);
      expect([settings.outputFormat.value, settings.frameCount.value, settings.frameDurationMs.value]).toEqual(["auto",9,200]);
    }
    const settings = restore({outputFormat: "gif", frameCount: 64, frameDurationMs: 2000});
    expect(settings.imageOutputOptions(models[1])).toEqual({...params, frame_count: 64, frame_duration_ms: 2000});
    settings.frameCount.value = 2; settings.frameDurationMs.value = 20;
    await nextTick();
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toMatchObject({outputFormat: "gif", frameCount: 2, frameDurationMs: 20});
  });
});

for (const model of models) describe(model, () => {
  for (const [mode, referenceCount, path] of [["images",0,"images/generations"],["images",1,"images/edits"],["chat",0,"chat/completions"],["auto",2,"chat/completions"]] as const) {
    it(`sends validated GIF parameters via ${mode}/${referenceCount} references`, async () => {
      const {settings, image, transport, addResultImage} = setup(model);
      settings.apiMode.value = mode;
      for (let i=0; i<referenceCount; i++) image.addFile(new File(["ref"], "ref.png", {type:"image/png"}));
      await image.generate();
      expect(image.error.value).toBe("");
      const {url, body} = bodyOf(transport);
      expect(url).toBe(`https://example.test/v1/${path}`);
      expect(body).toMatchObject(path.endsWith("edits") ? {output_format:"gif", frame_count:"9", frame_duration_ms:"200"} : params);
      expect(addResultImage.mock.calls[0][0].type).toBe("image/gif");
      expect(addResultImage.mock.calls[0][1]).toBe("image/gif");
      await image.saveImage(await addResultImage.mock.results[0].value);
      expect(save).toHaveBeenCalledWith(expect.objectContaining({defaultPath: expect.stringMatching(/\.gif$/)}));
    });
    it(`sends GIF parameters for Canvas ${mode}/${referenceCount}`, async () => {
      const {settings, provider, selection, resolved, transport} = setup(model);
      settings.apiMode.value = mode;
      const graph = new CanvasGraph();
      graph.add("image", {connectionId:provider.id, model});
      const node = graph.nodes.value[0]; graph.updateData(node.id, {prompt:"animate"});
      vi.spyOn(graph, "referenceAssets").mockReturnValue(Array.from({length:referenceCount}, () => ({id:"ref", blob:new Blob(["ref"]), mime:"image/png", url:"", name:"ref.png"})));
      const canvas = scope.run(() => useCanvasWorkspace({graph, connectionProfiles:ref([provider]), imageModelSelection:selection, chatModelSelection:selection,
        resolveModelSelection:resolved, firstModelSelection:()=>model, generationSettings:settings, transport, nextTaskId:()=>1, errorMessage:String,
        resolvePromptSystemPrompt:async()=>"", error:ref(""), copyResultPrompt:vi.fn(), copyResultImage:vi.fn(), saveImage:vi.fn()}))!;
      await canvas.generateCanvasImage(node.id);
      expect(graph.findNode(node.id)?.data.error).toBe("");
      expect(graph.findNode(node.id)?.data.status).toBe("success");
      const {url, body} = bodyOf(transport);
      expect(url).toBe(`https://example.test/v1/${path}`);
      expect(body).toMatchObject(path.endsWith("edits") ? {output_format:"gif", frame_count:"9", frame_duration_ms:"200"} : params);
      const output = graph.nodes.value.find(item => item.data.generatedFrom === node.id)!;
      expect(output.data.references[0].mime).toBe("image/gif");
      expect(output.data.references[0].name).toMatch(/\.gif$/);
      graph.dispose();
    });
  }
});

it("does not send on invalid input and omits GIF fields after switching models", async () => {
  const {settings, image, selection, transport} = setup();
  settings.frameCount.value = 65; await image.generate();
  expect(transport.fetchGeneration).not.toHaveBeenCalled(); expect(image.error.value).toContain("帧数");
  selection.value = "gpt-image-2"; await image.generate();
  expect(bodyOf(transport).body).not.toHaveProperty("output_format");
  expect(image.imageSupportsGif.value).toBe(false);
});

it("recognizes GIF87a/GIF89a bytes, and downloads without retry or conversion", async () => {
  expect(base64ToBlob(gif, "image/png").type).toBe("image/gif");
  expect(base64ToBlob(btoa("GIF87a"), "image/png").type).toBe("image/gif");
  expect(imageExtension("image/gif")).toBe("gif");
  const bytes = await base64ToBlob(gif, "image/png").arrayBuffer();
  const fetch = vi.fn(async()=> new Response(bytes, {headers:{"content-type":"application/octet-stream"}}));
  const transport = createGenerationTransport({fetch, retryConfig:vi.fn(), log:vi.fn(), sanitizeUrl:String, redact:String, formatError:String, proxyForLog:()=>""});
  const blob = await transport.downloadImage("https://example.test/v1", "/result", new AbortController().signal);
  expect(blob.type).toBe("image/gif"); expect(await blob.arrayBuffer()).toEqual(bytes); expect(fetch).toHaveBeenCalledTimes(1);
});

it("preserves error status/message for all image API paths", async () => {
  const transport = createGenerationTransport({fetch:vi.fn(), retryConfig:()=>null, log:vi.fn(), sanitizeUrl:String, redact:String, formatError:String, proxyForLog:()=>""});
  await expect(transport.parseResponse(new Response(JSON.stringify({error:{message:"GIF unavailable"}}), {status:400})))
      .rejects.toThrow("请求失败 (400): GIF unavailable");
});

it("recognizes inline Chat GIF and preserves static output returned by a relay", async () => {
  const {settings, image, transport, addResultImage} = setup();
  settings.apiMode.value = "chat";
  transport.parseResponse.mockResolvedValueOnce({choices:[{message:{content:`data:image/png;base64,${gif}`}}]} as any);
  await image.generate();
  expect(addResultImage.mock.calls[0][1]).toBe("image/gif");
  settings.apiMode.value = "images";
  transport.parseResponse.mockResolvedValueOnce({data:[{b64_json:btoa("static png bytes")}]} as any);
  await image.generate();
  expect(addResultImage.mock.calls[1][1]).toBe("image/png");
});

it("snapshots GIF options and ignores repeated Generate clicks while pending", async () => {
  const {settings, image, transport} = setup();
  let finish!: (response: Response) => void;
  transport.fetchGeneration.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const pending = image.generate();
  settings.frameCount.value = 64;
  await image.generate();
  expect(transport.fetchGeneration).toHaveBeenCalledTimes(1);
  expect(bodyOf(transport).body).toMatchObject(params);
  finish(new Response("{}"));
  await pending;
  expect(image.loading.value).toBe(false);
  await image.generate();
  expect(JSON.parse((transport.fetchGeneration.mock.calls[1] as any)[1].body).frame_count).toBe(64);
});
