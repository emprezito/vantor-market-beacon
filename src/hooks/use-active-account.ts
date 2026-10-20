import { useState } from "react";

const KEY = "vantor.activeAccountId";

function readActiveAccountId() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function useActiveAccount() {
  const [id, setId] = useState<string | null>(readActiveAccountId);
  const set = (next: string | null) => {
    setId(next);
    if (typeof window === "undefined") return;
    try {
      if (next) window.localStorage.setItem(KEY, next);
      else window.localStorage.removeItem(KEY);
    } catch {
      return;
    }
  };
  return [id, set] as const;
}
