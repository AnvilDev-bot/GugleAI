import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {copyImageBlob} from "../src/services/clipboard";
import {base64ToBlob} from "../src/domain/models";

const gif = base64ToBlob("R0lGODlhAQABAIAAAAAAAP///yH5BAAAAAAALAAAAAABAAEAAAIBRAA7", "image/gif");
const write = vi.fn(async (_items: TestClipboardItem[]) => {});
class TestClipboardItem {
  static supports: ((mime: string) => boolean) | undefined = vi.fn(() => true);
  constructor(readonly data: Record<string, Blob | Promise<Blob>>) {}
}
beforeEach(() => {
  write.mockReset(); write.mockResolvedValue(undefined);
  TestClipboardItem.supports = vi.fn(() => true);
  vi.stubGlobal("ClipboardItem", TestClipboardItem);
  vi.stubGlobal("navigator", {clipboard: {write}});
});
afterEach(() => vi.unstubAllGlobals());

it("writes original GIF bytes synchronously in the click, without PNG fallback", async () => {
  const result = copyImageBlob(gif);
  expect(write).toHaveBeenCalledTimes(1); // No await before clipboard.write.
  const data = write.mock.calls[0][0][0].data;
  expect(Object.keys(data)).toEqual(["image/gif"]);
  expect(data["image/gif"]).toBe(gif);
  expect(await result).toBe("gif");
});
it("uses web custom GIF only when reported supported, preserving original bytes", async () => {
  TestClipboardItem.supports = mime => mime === "web image/gif";
  expect(await copyImageBlob(gif)).toBe("web-gif");
  const data = write.mock.calls[0][0][0].data;
  expect(Object.keys(data)).toEqual(["web image/gif"]);
  expect(await (data["web image/gif"] as Blob).arrayBuffer()).toEqual(await gif.arrayBuffer());
});
it("reports unsupported GIF rather than silently flattening it", async () => {
  TestClipboardItem.supports = () => false;
  await expect(copyImageBlob(gif)).rejects.toThrow("不支持 GIF");
  expect(write).not.toHaveBeenCalled();
});
it("tries standard GIF when old ClipboardItem lacks supports", async () => {
  TestClipboardItem.supports = undefined;
  expect(await copyImageBlob(gif)).toBe("gif");
  expect(Object.keys(write.mock.calls[0][0][0].data)).toEqual(["image/gif"]);
});
it.each(["NotAllowedError", "NotSupportedError"])("does not silently retry PNG on %s", async name => {
  write.mockRejectedValue(new DOMException("clipboard denied", name));
  await expect(copyImageBlob(gif)).rejects.toMatchObject({name});
  expect(write).toHaveBeenCalledTimes(1);
  expect(Object.keys(write.mock.calls[0][0][0].data)).toEqual(["image/gif"]);
});
it("reports missing clipboard API", async () => {
  vi.stubGlobal("navigator", {});
  await expect(copyImageBlob(gif)).rejects.toThrow("不支持复制图片");
  vi.stubGlobal("ClipboardItem", undefined);
  await expect(copyImageBlob(gif)).rejects.toThrow("不支持复制图片");
});
it("keeps ordinary PNG copying working", async () => {
  const png = new Blob(["png"], {type:"image/png"});
  expect(await copyImageBlob(png)).toBe("png");
  expect(await write.mock.calls[0][0][0].data["image/png"]).toBe(png);
});

describe("asynchronous PNG conversion", () => {
  it("copies a static frame only when explicitly requested and retains user activation", async () => {
    let finish!: (bitmap: unknown) => void;
    vi.stubGlobal("createImageBitmap", vi.fn(() => new Promise(resolve => {finish = resolve;})));
    const png = new Blob(["static frame"], {type:"image/png"});
    const close = vi.fn();
    const drawImage = vi.fn();
    vi.stubGlobal("document", {createElement:()=>({getContext:()=>({drawImage}), toBlob:(callback: (value:Blob)=>void)=>callback(png)})});
    const result = copyImageBlob(gif, true);
    expect(write).toHaveBeenCalledTimes(1);
    const data = write.mock.calls[0][0][0].data;
    expect(Object.keys(data)).toEqual(["image/png"]);
    expect(data["image/png"]).toBeInstanceOf(Promise);
    finish({width:1,height:1,close});
    expect(await data["image/png"]).toBe(png);
    expect(await result).toBe("png");
    expect(close).toHaveBeenCalledOnce();
  });
});

// Verify the shared preview/context-menu path surfaces compatibility limits instead of claiming universal GIF paste.
vi.mock("@arco-design/web-vue", () => ({Message:{success:vi.fn(), error:vi.fn()}}));
vi.mock("vue", async original => ({...await original(), onMounted:vi.fn(), onUnmounted:vi.fn()}));
import {ref} from "vue";
import {Message} from "@arco-design/web-vue";
import {useResultHistory} from "../src/composables/history";
import {readFileSync} from "node:fs";

function historyFixture() {
  vi.stubGlobal("window", {setTimeout:vi.fn(()=>1), clearTimeout:vi.fn()});
  const error = ref("");
  const history = useResultHistory({error, log:vi.fn(), errorMessage:String, formatErrorDetails:String,
    addReference:vi.fn(), saveImage:vi.fn()});
  const image = {id:"gif", blob:gif, mime:"image/gif", prompt:"", previewUrl:"blob:test", createdAt:0};
  history.resultContextMenu.value = {image,x:0,y:0};
  return {history,error,image};
}
it("shared copy handler closes menu, writes immediately and labels custom-format success", async () => {
  TestClipboardItem.supports = mime => mime === "web image/gif";
  const {history,error,image} = historyFixture();
  const copy = history.copyResultImage(image);
  expect(write).toHaveBeenCalledOnce();
  expect(history.resultContextMenu.value).toBeNull();
  await copy;
  expect(error.value).toBe("");
  expect(Message.success).toHaveBeenCalledWith(expect.objectContaining({content:expect.stringContaining("仅兼容应用")}));
});
it("shared copy handler offers saving GIF or explicit static frame on failure", async () => {
  TestClipboardItem.supports = () => false;
  const {history,error,image} = historyFixture();
  await history.copyResultImage(image);
  expect(write).not.toHaveBeenCalled();
  expect(error.value).toContain("保存 GIF"); expect(error.value).toContain("复制静态帧");
  expect(Message.error).toHaveBeenCalled();
});
it("keeps GIF option labels localized and routes enlarged preview to the app copy menu", () => {
  const view = readFileSync(new URL("../src/views/ImageView.vue", import.meta.url), "utf8");
  expect(view).toContain("输出格式"); expect(view).toContain("GIF 帧数"); expect(view).toContain("每帧时长");
  for (const name of ["output_format", "frame_count", "frame_duration_ms"]) expect(view).not.toContain(name);
  const overlays = readFileSync(new URL("../src/components/modals/ResultOverlays.vue", import.meta.url), "utf8");
  expect(overlays).toContain('@contextmenu.prevent="app.openResultContextMenu($event, app.enlargedResult)"');
  expect(overlays).toContain("app.copyCanvasImage(app.canvasImageContextMenu.image, true)");
  expect(overlays).toContain("app.copyResultImage(app.resultContextMenu.image, true)");
});
