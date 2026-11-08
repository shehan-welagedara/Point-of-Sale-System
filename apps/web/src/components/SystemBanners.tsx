import { useEffect, useState } from "react";
import { APP_VERSION, isBusy, useUpdateCheck } from "../lib/version";

/**
 * Release and connection notices on every screen:
 * - a newer release is live → "Update available" (devices with nobody signed in reload by themselves);
 * - this screen is older than the minimum supported version → it must reload before use;
 * - no internet → sales are kept on this device and sent when the connection returns.
 */
export function SystemBanners() {
  const update = useUpdateCheck();
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Reload unattended screens (nobody signed in on the POS, page hidden or idle) a minute after a release.
  useEffect(() => {
    if (update.status !== "available") return;
    const t = setInterval(() => {
      if (!isBusy() || document.visibilityState === "hidden") location.reload();
    }, 60_000);
    return () => clearInterval(t);
  }, [update.status]);

  if (update.status === "required") {
    return (
      <div className="overlay" style={{ zIndex: 300 }} role="alertdialog" aria-label="Update required">
        <div className="modal" style={{ padding: 24, gap: 12 }}>
          <h2>Update required</h2>
          <p>This screen runs version {APP_VERSION}; version {update.live.version} is now live and this one can no longer be used safely. Updating takes a few seconds. Anything already saved is kept.</p>
          <button className="btn primary lg" onClick={() => location.reload()}>Update now</button>
        </div>
      </div>
    );
  }
  return (
    <>
      {update.status === "available" ? (
        <div className="sys-banner info" role="status">
          <span>Version {update.live.version} is available.</span>
          <button className="btn sm" onClick={() => location.reload()}>Update now</button>
        </div>
      ) : null}
      {!online ? (
        <div className="sys-banner warn" role="status">
          <span>No internet. Orders are kept on this device and sent when the connection returns. Card, LankaQR and PayHere payments, PIN checks and printing need the connection.</span>
        </div>
      ) : null}
    </>
  );
}
