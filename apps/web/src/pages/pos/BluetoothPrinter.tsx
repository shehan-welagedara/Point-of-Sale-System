import { useState } from "react";
import type { Workstation } from "@pos/core";
import { buildTestPage, widthForPaper } from "@pos/printing";
import { Modal } from "../../components/ui";
import { choosePrinter, clearPending, forgetPrinter, isIos, printBluetooth, useBluetoothPrinter } from "../../lib/bluetooth-printer";
import { useApp } from "../../state/app";

/**
 * The printer button on a phone or tablet that prints to its own Bluetooth printer: shows whether
 * the printer is connected and how many prints are waiting; opens a panel to connect, test and
 * change the printer. Shown only on workstations set to Bluetooth printing.
 */
export function BluetoothPrinterButton({ ws, className = "btn sm" }: { ws: Workstation; className?: string }) {
  const bt = useBluetoothPrinter();
  const [open, setOpen] = useState(false);
  if (ws.printMode !== "bluetooth") return null;
  const rawbt = ws.bluetoothVia === "rawbt";
  const ok = rawbt || bt.status === "ready" || bt.status === "printing";
  const label = rawbt ? "Printer: RawBT" : ok ? `Printer: ${bt.deviceName ?? "connected"}` : bt.pending ? `Printer: ${bt.pending} waiting` : "Connect printer";
  return (
    <>
      <button type="button" className={`${className} bt-printer ${ok ? "ok" : "off"}`} onClick={() => setOpen(true)} aria-label={label} title={bt.message || label}>
        <span aria-hidden>🖨</span> {label}
      </button>
      {open ? <BluetoothPrinterPanel ws={ws} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function BluetoothPrinterPanel({ ws, onClose }: { ws: Workstation; onClose: () => void }) {
  const { toast } = useApp();
  const bt = useBluetoothPrinter();
  const [busy, setBusy] = useState(false);
  const rawbt = ws.bluetoothVia === "rawbt";
  const width = widthForPaper(ws.paperWidthMm ?? 80);

  async function connect() {
    setBusy(true);
    const done = await choosePrinter();
    setBusy(false);
    if (done) toast(bt.pending ? "Printer connected: printing what was waiting" : "Printer connected");
  }
  async function test() {
    setBusy(true);
    const printed = await printBluetooth(buildTestPage(`${ws.name} (${ws.code})`, width), rawbt ? "rawbt" : "browser");
    setBusy(false);
    toast(printed ? "Test page sent to the printer" : "Not printed: connect the printer first", !printed);
  }

  return (
    <Modal title="Bluetooth printer" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Close</button>}>
      <div className="stack">
        {rawbt ? (
          <>
            <p className="small" style={{ margin: 0 }}>This phone prints through the <strong>RawBT</strong> app, which works with any Bluetooth receipt printer.</p>
            <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Install <strong>RawBT</strong> from Google Play.</li>
              <li>In Android Settings → Bluetooth, pair the printer (PIN usually 0000 or 1234).</li>
              <li>In RawBT, choose the printer and the paper width ({ws.paperWidthMm ?? 80} mm).</li>
              <li>Come back here and press <strong>Test print</strong>.</li>
            </ol>
          </>
        ) : bt.status === "unsupported" ? (
          <div className="callout warn small">
            {isIos()
              ? "iPhones and iPads can't print to Bluetooth printers from Safari or Chrome. Open the POS in the Bluefy browser (free on the App Store, it adds Bluetooth), or set this workstation to print through the Print Agent."
              : "This browser can't use Bluetooth. Open the POS in Chrome on Android, or set this workstation to “Bluetooth via the RawBT app” in the back office."}
          </div>
        ) : (
          <>
            <div className="row between">
              <span className="small">
                <strong>{bt.deviceName ?? "No printer chosen yet"}</strong>
                <span className="tiny muted" style={{ display: "block" }}>
                  {bt.status === "ready" ? "Connected" : bt.status === "printing" ? "Printing…" : bt.status === "connecting" ? "Connecting…" : "Not connected"}
                  {bt.pending ? ` · ${bt.pending} print(s) waiting` : ""}
                </span>
              </span>
              <span className={`badge ${bt.status === "ready" || bt.status === "printing" ? "good" : "warn"}`}>{bt.status === "ready" || bt.status === "printing" ? "Ready" : "Off"}</span>
            </div>
            {bt.message ? <div className="small muted">{bt.message}</div> : null}
            <p className="tiny muted" style={{ margin: 0 }}>
              Switch the printer on, then <strong>Connect printer</strong> and pick it from the list (for example <em>XP-T80Q</em> or <em>Printer001</em>). Choose it once; afterwards it reconnects by itself while the POS is open. Bills, kitchen tickets and reports print here, and the cash drawer opens from it.
            </p>
          </>
        )}
        <div className="row wrap">
          {!rawbt && bt.status !== "unsupported" ? (
            <button className="btn primary" disabled={busy} onClick={connect}>{bt.deviceName ? "Connect printer" : "Choose the printer"}</button>
          ) : null}
          <button className="btn" disabled={busy || (!rawbt && bt.status === "unsupported")} onClick={test}>Test print</button>
          {!rawbt && bt.deviceName ? <button className="btn ghost" onClick={() => { forgetPrinter(); toast("Printer forgotten: choose it again"); }}>Use another printer</button> : null}
          {bt.pending ? <button className="btn ghost" onClick={() => { clearPending(); toast("Waiting prints cleared (reprint from Orders if needed)"); }}>Clear {bt.pending} waiting</button> : null}
        </div>
      </div>
    </Modal>
  );
}
