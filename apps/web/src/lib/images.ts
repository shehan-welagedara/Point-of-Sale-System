/**
 * Resizes a photo in the browser so it can live in Firestore (no Cloud Storage, no cost):
 * longest side ≤ `max` px, WebP (or JPEG where WebP isn't supported), typically 15–40 KB.
 */
export async function resizeImage(file: File, max = 400, quality = 0.8): Promise<{ dataUrl: string; width: number; height: number; bytes: number }> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file (JPEG, PNG or WebP)");
  if (file.size > 15 * 1024 * 1024) throw new Error("Image is larger than 15 MB");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read the image"));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available");
    ctx.drawImage(img, 0, 0, width, height);
    let dataUrl = canvas.toDataURL("image/webp", quality);
    if (!dataUrl.startsWith("data:image/webp")) dataUrl = canvas.toDataURL("image/jpeg", quality);
    const bytes = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
    if (bytes > 900_000) throw new Error("Image is still too large after resizing");
    return { dataUrl, width, height, bytes };
  } finally {
    URL.revokeObjectURL(url);
  }
}
