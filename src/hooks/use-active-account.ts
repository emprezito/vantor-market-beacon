import { useEffect, useState } from "react";

const KEY = "vantor.activeAccountId";
const listeners = new Set<(id: string | null) => void>();

function readActiveAccountId() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeActiveAccountId(next: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (next) window.localStorage.setItem(KEY, next);
    else window.localStorage.removeItem(KEY);
  } catch {
    return;
  }
}

export function useActiveAccount() {
  const [id, setId] = useState<string | null>(readActiveAccountId);

  useEffect(() => {
    listeners.add(setId);
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEY) setId(readActiveAccountId());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(setId);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const set = (next: string | null) => {
    writeActiveAccountId(next);
    listeners.forEach((listener) => listener(next));
  };

  return [id, set] as const;
}
