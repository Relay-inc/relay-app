// localStorage, quiet when storage is unavailable. The keys and their encodings are the ones the app always used, so
// existing users keep their conversations: most hold JSON (`get`/`set`), a few a bare string (`getRaw`/`setRaw`: the
// board's last project, board, grouping and folded columns, and the settings window's `prefsTab`).
export const storage = {
  get: <T>(key: string, fallback: T): T => {
    try {
      return JSON.parse(localStorage.getItem(key) || "") ?? fallback;
    } catch {
      return fallback;
    }
  },
  set: (key: string, value: unknown) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
  getRaw: (key: string) => {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  },
  setRaw: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
};
