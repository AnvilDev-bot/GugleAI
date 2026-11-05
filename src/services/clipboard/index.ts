export type ImageClipboardFormat = "gif" | "web-gif" | "png";

/** Writes immediately in the user gesture; asynchronous PNG conversion is a promised item value. */
export function copyImageBlob(blob: Blob, staticFrame = false): Promise<ImageClipboardFormat> {
  if (typeof ClipboardItem === "undefined" || typeof navigator.clipboard?.write !== "function") {
    return Promise.reject(new Error("当前系统 WebView 不支持复制图片"));
  }
  let format: ImageClipboardFormat = "png";
  let type = "image/png";
  if (blob.type === "image/gif" && !staticFrame) {
    const supports = typeof ClipboardItem.supports === "function"
        ? (mime: string) => ClipboardItem.supports(mime) : null;
    if (!supports || supports("image/gif")) {
      type = "image/gif";
      format = "gif";
    } else if (supports("web image/gif")) {
      // Chromium custom formats preserve bytes, but ordinary native apps may not read them.
      type = "web image/gif";
      format = "web-gif";
    } else {
      return Promise.reject(new Error("当前系统 WebView 不支持 GIF 动画剪贴板格式"));
    }
  }
  const data = format === "png" ? convertImageBlobToPng(blob) : blob;
  return navigator.clipboard.write([new ClipboardItem({[type]: data})]).then(() => format);
}

async function convertImageBlobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图片转换画布");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
          (pngBlob) => pngBlob ? resolve(pngBlob) : reject(new Error("无法将图片转换为 PNG")),
          "image/png"
      );
    });
  } finally {
    bitmap.close();
  }
}
