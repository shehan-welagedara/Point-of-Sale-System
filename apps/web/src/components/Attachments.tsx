import { useEffect, useRef, useState } from "react";
import { type Attachment, COLLECTIONS as C } from "@pos/core";
import { linkAttachment, loadAttachment, prepareFile, saveAttachment } from "../lib/attachments";
import { dateTimeColombo, money } from "../lib/format";
import { useApp, useCollection, useStore } from "../state/app";
import { Modal } from "./ui";

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Uploads photos/scans; returns the saved records. */
export function useAttachmentUpload() {
  const { actor, user, toast } = useApp();
  const store = useStore();
  const [busy, setBusy] = useState(false);
  async function upload(files: FileList | File[], linkedTo?: Attachment["linkedTo"], extra: { documentDate?: string; supplierName?: string; amount?: number } = {}): Promise<Attachment[]> {
    const uid = actor?.uid ?? user?.uid ?? "local";
    const out: Attachment[] = [];
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        try {
          out.push(await saveAttachment(store, await prepareFile(f), { uid, ...(linkedTo ? { linkedTo } : {}), ...extra }));
        } catch (e) {
          toast(`${f.name}: ${(e as Error).message}`, true);
        }
      }
      if (out.length) toast(`${out.length} file(s) attached`);
    } finally {
      setBusy(false);
    }
    return out;
  }
  return { upload, busy };
}

/** Shows a filed photo or PDF, with its fingerprint check and a download link. */
export function AttachmentViewer({ att, onClose }: { att: Attachment; onClose: () => void }) {
  const store = useStore();
  const [url, setUrl] = useState<string | null>(null);
  const [intact, setIntact] = useState<boolean | null>(null);
  useEffect(() => {
    let u = "";
    void loadAttachment(store, att).then((r) => {
      u = URL.createObjectURL(r.blob);
      setUrl(u);
      setIntact(r.intact);
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [store, att]);
  return (
    <Modal wide title={att.fileName} onClose={onClose} footer={<>{url ? <a className="btn" href={url} download={att.fileName}>Download</a> : null}<button className="btn primary" onClick={onClose}>Close</button></>}>
      <div className="stack">
        <div className="row wrap small">
          {intact === null ? <span className="muted">Loading…</span> : intact ? <span className="badge good">Fingerprint verified: unchanged since filing</span> : <span className="badge bad">Fingerprint does not match: the file was altered or is incomplete</span>}
          <span className="muted">{kb(att.size)} · filed {dateTimeColombo(att.uploadedAt)}</span>
          {att.supplierName ? <span>{att.supplierName}</span> : null}
          {att.amount ? <span className="num">{money(att.amount)}</span> : null}
        </div>
        {url ? (
          att.contentType === "application/pdf" ? <iframe title={att.fileName} src={url} style={{ width: "100%", height: "70vh", border: "1px solid var(--line)", borderRadius: 10 }} /> : <img src={url} alt={att.fileName} style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: 10 }} />
        ) : null}
      </div>
    </Modal>
  );
}

export function AttachmentThumb({ att, onOpen }: { att: Attachment; onOpen: () => void }) {
  return (
    <button type="button" className="att-thumb" onClick={onOpen} title={att.fileName}>
      {att.thumbnail ? <img src={att.thumbnail} alt="" /> : <span className="att-pdf">PDF</span>}
      <span className="att-name">{att.fileName}</span>
    </button>
  );
}

/**
 * Photos and scans of the paper behind a document (supplier bill, receipt, handwritten sales
 * bills). Add from the camera or a file, or pick one already in Bills & receipts.
 */
export function AttachmentPanel({ linkedTo, title = "Bill photos and scans", readOnly = false }: { linkedTo: NonNullable<Attachment["linkedTo"]>; title?: string; readOnly?: boolean }) {
  const store = useStore();
  const { toast } = useApp();
  const files = useCollection<Attachment>(C.attachments, { where: [["linkedTo.id", "==", linkedTo.id]] }) ?? [];
  const inbox = useCollection<Attachment>(readOnly ? null : C.attachments, { where: [["status", "==", "inbox"]] }) ?? [];
  const { upload, busy } = useAttachmentUpload();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<Attachment | null>(null);
  const [picking, setPicking] = useState(false);
  return (
    <div className="att-panel">
      <div className="row between">
        <span className="small"><strong>{title}</strong> {files.length ? <span className="muted">({files.length})</span> : null}</span>
        {!readOnly ? (
          <span className="row">
            {inbox.length ? <button type="button" className="btn sm ghost" onClick={() => setPicking(true)}>From inbox ({inbox.length})</button> : null}
            <button type="button" className="btn sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Saving…" : "📎 Add photo or scan"}</button>
            <input ref={input} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { if (e.target.files?.length) void upload(e.target.files, linkedTo); e.target.value = ""; }} />
          </span>
        ) : null}
      </div>
      {files.length ? <div className="att-grid">{files.map((a) => <AttachmentThumb key={a.id} att={a} onOpen={() => setOpen(a)} />)}</div> : !readOnly ? <p className="tiny muted">Take a photo of the paper bill with your phone, or attach a scan (PDF). It is kept with this document as evidence.</p> : null}
      {open ? <AttachmentViewer att={open} onClose={() => setOpen(null)} /> : null}
      {picking ? (
        <Modal title="Attach from Bills & receipts" onClose={() => setPicking(false)}>
          <div className="att-grid">
            {inbox.map((a) => (
              <div key={a.id} className="stack tight" style={{ alignItems: "center" }}>
                <AttachmentThumb att={a} onOpen={() => setOpen(a)} />
                <span className="tiny muted">{a.supplierName ?? ""} {a.amount ? money(a.amount) : ""}</span>
                <button type="button" className="btn sm" onClick={async () => { await linkAttachment(store, a.id, linkedTo); toast("Attached"); setPicking(false); }}>Attach</button>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
