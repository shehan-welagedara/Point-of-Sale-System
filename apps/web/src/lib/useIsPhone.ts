import { useSyncExternalStore } from "react";

const PHONE = "(max-width: 600px)";

/** True on phone-sized screens, where the back office switches to its app layout. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(PHONE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}
