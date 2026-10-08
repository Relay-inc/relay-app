import type { Key } from "../../../shared/i18n";

/** "5 min ago", "3 h ago", "2 d ago": how long ago a conversation touched a note. */
export function agoOf(at: number, t: (key: Key, vars?: Record<string, string | number>) => string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (minutes < 60) return t("wait.agoMin", { n: minutes });
  if (minutes < 48 * 60) return t("wait.agoHour", { n: Math.floor(minutes / 60) });
  return t("brain.agoDay", { n: Math.floor(minutes / 1440) });
}
