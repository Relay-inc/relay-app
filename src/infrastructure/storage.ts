// The UI's own state (the conversations' metadata, the sidebar's order and folds, the board's last pick, the settings
// window's `prefsTab`), in ui-state.json in Relay's data folder (`ui_state_get`, `ui_state_set`), so a development
// build and the installed app on this Mac see the same. It used to be the webview's localStorage, which is per origin:
// the first start with the file takes what this webview's localStorage still holds. Read once, when this module
// loads (a top-level await: every module that imports it, the stores that read it while loading among them, waits
// for it), then from memory. The keys and their encodings are the ones the app
// always used: most hold JSON (`get`/`set`), a few a bare string (`getRaw`/`setRaw`).
import { invoke } from "@tauri-apps/api/core";

let state: Record<string, string> = {};
const timers = new Map<string, ReturnType<typeof setTimeout>>();
// quiet like localStorage was: without the backend (a test) nothing is kept beyond memory
const write = async (key: string) => {
  try {
    await invoke("ui_state_set", { key, value: state[key] });
  } catch {
    /* backend unavailable */
  }
};
// a burst of writes to one key (a draft being typed) goes out once, a quarter second after the last
function put(key: string, value: string, now = false) {
  state[key] = value;
  clearTimeout(timers.get(key));
  timers.delete(key);
  if (now) return write(key);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      write(key);
    }, 250),
  );
  return Promise.resolve();
}

/** What this webview's localStorage holds, the UI state from before the file. */
function local() {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      out[key] = localStorage.getItem(key) ?? "";
    }
  } catch {
    /* no localStorage */
  }
  return out;
}
/** Read the UI state. The first time, localStorage's becomes the file in one go (`ui_state_init`): a reload halfway
 *  would otherwise leave a file with a few keys, read as taken over for good. */
async function load() {
  try {
    state = await invoke<Record<string, string>>("ui_state_get");
  } catch {
    state = local(); // no backend (a test): memory only
    return;
  }
  if (Object.keys(state).length) return;
  const old = local();
  if (!Object.keys(old).length) return;
  try {
    state = await invoke<Record<string, string>>("ui_state_init", { state: old });
  } catch {
    state = old;
  }
}

await load();

export const storage = {
  get: <T>(key: string, fallback: T): T => {
    try {
      return JSON.parse(state[key] || "") ?? fallback;
    } catch {
      return fallback;
    }
  },
  set: (key: string, value: unknown) => {
    put(key, JSON.stringify(value));
  },
  getRaw: (key: string) => state[key] || "",
  /** Written at once: another window may read it right after (the settings window's `prefsTab`). */
  setRaw: (key: string, value: string) => put(key, value, true),
};
/** sessionStorage, as quiet: it lives as long as the webview, so it survives a reload but not an app restart. */
export const session = {
  get: <T>(key: string, fallback: T): T => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || "") ?? fallback;
    } catch {
      return fallback;
    }
  },
  set: (key: string, value: unknown) => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};
