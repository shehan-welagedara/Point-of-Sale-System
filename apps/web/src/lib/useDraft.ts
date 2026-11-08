import { useEffect, useRef, useState } from "react";

/**
 * Local copy of a saved setting for an edit form. It follows the saved value (which may arrive
 * after the first render, or change on another device) until the user edits it.
 */
export function useDraft<T>(saved: T): [T, (next: T) => void, () => void] {
  const [draft, setDraft] = useState<T>(saved);
  const dirty = useRef(false);
  const key = JSON.stringify(saved);
  useEffect(() => {
    if (!dirty.current) setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const edit = (next: T) => {
    dirty.current = true;
    setDraft(next);
  };
  const reset = () => {
    dirty.current = false;
  };
  return [draft, edit, reset];
}
