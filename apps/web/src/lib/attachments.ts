import { type Attachment, type AttachmentChunk, type DocStore, COLLECTIONS as C, newId, sha256Bytes } from "@pos/core";
import { resizeImage } from "./images";

/** Largest file accepted (PDF scans); photos are shrunk well below this. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Characters of base64 per stored part (Firestore documents are limited to 1 MB). */
const CHUNK = 700_000;

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface PreparedFile {
  fileName: string;
  contentType: string;
  base64: string;
  size: number;
  sha256: string;
  thumbnail?: string;
}

/**
 * Photos are resized (longest side 1,800 px, JPEG/WebP) so a bill stays readable at a few hundred
 * KB; PDFs are kept as they are, up to 10 MB.
 */
export async function prepareFile(file: File): Promise<PreparedFile> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_FILE_BYTES) throw new Error("PDF is larger than 10 MB: scan at a lower resolution");
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { fileName: file.name, contentType: "application/pdf", base64: bytesToBase64(bytes), size: bytes.length, sha256: toHex(await sha256Bytes(bytes)) };
  }
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo (JPEG, PNG, WebP, HEIC) or a PDF");
  const big = await resizeImage(file, 1800, 0.82);
  const small = await resizeImage(file, 240, 0.7);
  const contentType = big.dataUrl.slice(5, big.dataUrl.indexOf(";"));
  const base64 = big.dataUrl.slice(big.dataUrl.indexOf(",") + 1);
  const bytes = base64ToBytes(base64);
  const ext = contentType === "image/webp" ? "webp" : "jpg";
  return { fileName: `${file.name.replace(/\.[^.]+$/, "") || "photo"}.${ext}`, contentType, base64, size: bytes.length, sha256: toHex(await sha256Bytes(bytes)), thumbnail: small.dataUrl };
}

/** Files a prepared file (optionally linked to a document) and returns its record. */
export async function saveAttachment(store: DocStore, f: PreparedFile, args: { uid: string; linkedTo?: Attachment["linkedTo"]; documentDate?: string; supplierName?: string; amount?: number; note?: string }): Promise<Attachment> {
  const id = `ATT-${newId()}`;
  const parts = Math.max(1, Math.ceil(f.base64.length / CHUNK));
  const att: Attachment = {
    id,
    fileName: f.fileName,
    contentType: f.contentType,
    size: f.size,
    sha256: f.sha256,
    chunks: parts,
    ...(f.thumbnail ? { thumbnail: f.thumbnail } : {}),
    ...(args.linkedTo ? { linkedTo: args.linkedTo } : {}),
    status: args.linkedTo ? "linked" : "inbox",
    ...(args.documentDate ? { documentDate: args.documentDate } : {}),
    ...(args.supplierName ? { supplierName: args.supplierName } : {}),
    ...(args.amount ? { amount: args.amount } : {}),
    ...(args.note ? { note: args.note } : {}),
    uploadedBy: args.uid,
    uploadedAt: new Date().toISOString(),
  };
  const chunks: AttachmentChunk[] = Array.from({ length: parts }, (_, i) => ({ id: `${id}__${String(i).padStart(3, "0")}`, attachmentId: id, index: i, data: f.base64.slice(i * CHUNK, (i + 1) * CHUNK) }));
  // Parts first, then the record: a record only appears once its file is complete.
  await store.batch(chunks.map((data) => ({ op: "set" as const, col: C.attachmentChunks, data })));
  await store.set(C.attachments, att);
  return att;
}

/** Reassembles a file and checks its fingerprint. */
export async function loadAttachment(store: DocStore, att: Attachment): Promise<{ blob: Blob; intact: boolean }> {
  const parts = (await store.list<AttachmentChunk>(C.attachmentChunks, { where: [["attachmentId", "==", att.id]] })).sort((a, b) => a.index - b.index);
  const bytes = base64ToBytes(parts.map((p) => p.data).join(""));
  const intact = parts.length === att.chunks && toHex(await sha256Bytes(bytes)) === att.sha256;
  return { blob: new Blob([bytes as BlobPart], { type: att.contentType }), intact };
}

export async function linkAttachment(store: DocStore, attId: string, linkedTo: NonNullable<Attachment["linkedTo"]>): Promise<void> {
  await store.merge(C.attachments, attId, { linkedTo, status: "linked" });
}
