import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { type Block, type ReceiptDoc, pad, pairLines, wrap } from "@pos/printing";

function QrImg({ data }: { data: string }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    QRCode.toDataURL(data, { margin: 1, width: 240 }).then(setSrc).catch(() => setSrc(""));
  }, [data]);
  return src ? <img className="qr" src={src} alt="QR code" /> : null;
}

export function QrCode({ data, size = 220 }: { data: string; size?: number }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    QRCode.toDataURL(data, { margin: 1, width: size * 2 }).then(setSrc).catch(() => setSrc(""));
  }, [data, size]);
  return src ? <img src={src} width={size} height={size} alt="QR code" style={{ borderRadius: 12, background: "#fff", padding: 8 }} /> : null;
}

function renderBlock(b: Block, width: number, key: number, logo?: string) {
  const w = "size" in b && b.size === 2 ? Math.floor(width / 2) : width;
  const cls = ["bold" in b && b.bold ? "b" : "", "size" in b && b.size === 2 ? "x2" : "", "invert" in b && b.invert ? "inv" : ""].filter(Boolean).join(" ");
  switch (b.t) {
    case "text":
      return (
        <div key={key} className={cls}>
          {wrap(b.text, w).map((l) => pad(l, w, b.align ?? "left")).join("\n")}
        </div>
      );
    case "pair":
      return (
        <div key={key} className={cls}>
          {pairLines(b.left, b.right, w).join("\n")}
        </div>
      );
    case "rule":
      return <div key={key}>{(b.char ?? "-").repeat(width)}</div>;
    case "feed":
      return <div key={key}>{"\n".repeat(Math.max(0, b.lines - 1))} </div>;
    case "qr":
      return (
        <div key={key} style={{ textAlign: "center" }}>
          <QrImg data={b.data} />
          {b.caption ? pad(b.caption, width, "center") : null}
        </div>
      );
    case "nvLogo":
      return logo ? (
        <div key={key} style={{ textAlign: "center" }}>
          <img src={logo} alt="" style={{ maxWidth: 160, maxHeight: 70, filter: "grayscale(1)" }} />
        </div>
      ) : null;
    case "cut":
      return (
        <div key={key} className="cut">
          {"- - ".repeat(Math.ceil(width / 4)).slice(0, width)}
        </div>
      );
    default:
      return null;
  }
}

/** On-screen rendering of a receipt document, character-for-character like the thermal printer. */
export function ReceiptView({ doc, logo }: { doc: ReceiptDoc; logo?: string }) {
  return <div className="paper print-area">{doc.blocks.map((b, i) => renderBlock(b, doc.width, i, logo))}</div>;
}
