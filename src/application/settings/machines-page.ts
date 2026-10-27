import { t } from "../../shared/i18n";
import type { DeviceCode, Machine, MachineGithub } from "../../domain/settings/types";
import { excludePath, SETUP_FOLDERS, type SetupPlatform } from "../../domain/settings/machines";
import * as backend from "../../infrastructure/backend";
import { checkAgents } from "./agents-page";
import { commit } from "./window";
import { useSettingsStore } from "./store";

// Settings › Machines: other computers in the LAN running relay-server. Pairing, the online check and the mirror on
// each machine. The backend saves machines itself; the window then reads the settings again.
const st = () => useSettingsStore.getState();
type Page = ReturnType<typeof st>["machinesPage"];
const change = (recipe: (draft: Page) => void) =>
  useSettingsStore.setState(draft => {
    recipe(draft.machinesPage);
  });
const machines = () => st().settings.machines ?? [];
const reload = async () => commit(await backend.getSettings());

/** When the page first shows: whether every machine is online. */
export function showMachinesPage() {
  if (st().machinesPage.checked) return;
  change(draft => {
    draft.checked = true;
  });
  checkAll();
  backend
    .serverSetup()
    .then(setup =>
      change(draft => {
        draft.setup = setup;
      }),
    )
    .catch(() => {}); // an older backend: no setup section
  refreshHost();
}
/** Reads this Mac as a machine, and what Claude Code here is (the Agents check, kept shown meanwhile). */
export function refreshHost() {
  backend
    .hostStatus()
    .then(host =>
      change(draft => {
        draft.host = host;
      }),
    )
    .catch(() => {}); // an older backend: no section
  checkAgents(true);
}
/** Turns this Mac as a machine on or off. */
export async function setHost(on: boolean) {
  change(draft => {
    draft.hostError = "";
    if (!on) draft.hostLine = "";
  });
  try {
    const host = await backend.hostSet(on);
    change(draft => {
      draft.host = host;
    });
  } catch (error) {
    change(draft => {
      draft.hostError = String(error);
    });
    refreshHost();
  }
}
/** Makes a pairing line for another Mac. */
export async function makeHostLine() {
  change(draft => {
    draft.hostError = "";
  });
  try {
    const line = await backend.hostPair();
    change(draft => {
      draft.hostLine = line;
    });
  } catch (error) {
    change(draft => {
      draft.hostError = String(error);
    });
  }
}
/** Makes a pairing for a phone of this Mac on a machine (shown as a QR), or closes it with `close`. */
export async function pairPhone(id: string, close = false) {
  change(draft => {
    draft.phone[id] = null;
    draft.messages[id] = null;
  });
  if (close) return;
  try {
    const pairing = await backend.machinePairPhone(id);
    change(draft => {
      draft.phone[id] = pairing;
    });
  } catch (error) {
    change(draft => {
      draft.messages[id] = { text: String(error), ok: false };
    });
  }
}
export async function checkMachine(id: string) {
  change(draft => {
    draft.status[id] = "checking";
  });
  const status = await backend.machineStatus(id).catch(error => ({ ok: false, error: String(error) }));
  change(draft => {
    draft.status[id] = status;
  });
  if (hasRepos(id)) readMachineGit(id);
}
export const checkAll = () => machines().forEach(machine => checkMachine(machine.id));

/** Pair with the line `relay-server pair` printed, `sharedOnly` for shared vaults only. True when it worked, so the
 *  page empties its fields. */
export async function pairMachine(line: string, name: string, sharedOnly: boolean) {
  change(draft => {
    draft.pairing = true;
    draft.pairError = "";
  });
  try {
    const machine = await backend.machinePair(line, name, sharedOnly);
    await reload();
    checkMachine(machine.id);
    return true;
  } catch (error) {
    change(draft => {
      draft.pairError = String(error);
    });
    return false;
  } finally {
    change(draft => {
      draft.pairing = false;
    });
  }
}
/** Update a machine's relay-server to this Relay's version, sent from here; then check it again. */
export async function updateMachine(id: string) {
  change(draft => {
    draft.updating = id;
    draft.messages[id] = null;
  });
  try {
    const { version } = await backend.machineUpdate(id);
    change(draft => {
      draft.messages[id] = { text: t("mc.updated", { version }), ok: true };
    });
  } catch (error) {
    change(draft => {
      draft.messages[id] = { text: String(error), ok: false };
    });
  } finally {
    change(draft => {
      draft.updating = "";
    });
    checkMachine(id);
  }
}
export async function forgetMachine(id: string) {
  try {
    await backend.machineForget(id);
    await reload();
  } catch (error) {
    change(draft => {
      draft.messages[id] = { text: String(error), ok: false };
    });
  }
}

/** Where new conversations run without a pick: "" this Mac, or a machine id. Resolves with an error to show, or "". */
export async function setRunDefault(id: string) {
  try {
    await backend.setMachinesDefault(id);
    await reload();
    return "";
  } catch (error) {
    return String(error);
  }
}

// The mirror: every machine keeps a sealed copy of the Claude context, plugins, vault and its memory. A failed
// command shows under the mirror section and leaves the page as it was.
const mirrorMessage = (id: string, text: string, ok = false) =>
  change(draft => {
    draft.mirrorMessages[id] = text ? { text, ok } : null;
  });
/** Reads the last mirror round and the running one of every machine; a failing command keeps what was there. */
export async function pollMirrors() {
  for (const machine of machines().filter(machine => !machine.sharedOnly)) {
    const [status, progress] = await Promise.all([
      backend.mirrorStatus(machine.id).catch(() => undefined),
      backend.mirrorProgress(machine.id).catch(() => undefined),
    ]);
    change(draft => {
      if (status !== undefined) draft.mirror[machine.id] = status;
      if (progress !== undefined) draft.mirrorProgress[machine.id] = progress;
    });
  }
}
/** The deletes a mirror holds back: through in its next round, or undone. Says which until that round. */
export async function settleHeldDeletes(machine: Machine, allow: boolean) {
  mirrorMessage(machine.id, "");
  try {
    await (allow ? backend.mirrorAllowDeletes(machine.id) : backend.mirrorRestoreHeld(machine.id));
    mirrorMessage(machine.id, t(allow ? "mc.mirrorHeldAllowed" : "mc.mirrorHeldRestored"), true);
    pollMirrors();
  } catch (error) {
    mirrorMessage(machine.id, String(error));
  }
}
/** Saves the excluded folders. True when it worked. */
async function saveExclude(machine: Machine, exclude: string[]) {
  mirrorMessage(machine.id, "");
  try {
    await backend.setMachineMirror(machine.id, exclude);
    await reload();
    pollMirrors();
    return true;
  } catch (error) {
    mirrorMessage(machine.id, String(error));
    return false;
  }
}
/** Adds a vault folder to the ones that stay on this Mac. Resolves with an error to show, or "". */
export async function addMirrorExclude(machine: Machine, input: string) {
  const path = excludePath(input);
  if (!path) return t("mc.mirrorErrExclude");
  const current = machine.mirror?.exclude ?? [];
  if (current.includes(path)) return "";
  return (await saveExclude(machine, [...current, path])) ? "" : t("mc.mirrorErrSave");
}
export const removeMirrorExclude = (machine: Machine, path: string) =>
  saveExclude(
    machine,
    (machine.mirror?.exclude ?? []).filter(item => item !== path),
  );
/** The kind of machine the setup commands are for, with that kind's folder. */
export const setSetupPlatform = (platform: SetupPlatform) =>
  change(draft => {
    draft.setupPlatform = platform;
    draft.setupFolder = SETUP_FOLDERS[platform];
  });
/** How a Mac becomes a machine: with the Relay app, or with Docker. */
export const setSetupMacWay = (way: "app" | "docker") =>
  change(draft => {
    draft.setupMacWay = way;
  });
/** The folder on the machine the setup commands use. */
export const setSetupFolder = (folder: string) =>
  change(draft => {
    draft.setupFolder = folder;
  });

// GitHub and the repos on a machine that has them (relay-server's github.rs): read for the online machines with the
// page's slow poll and after each action. Connecting asks GitHub's code, then where it stands every few seconds.
const hasRepos = (id: string) => {
  const status = st().machinesPage.status[id];
  const sharedOnly = machines().some(machine => machine.id === id && machine.sharedOnly);
  return !!status && status !== "checking" && status.ok && !!status.repos && !sharedOnly;
};
/** Reads GitHub and the repos of one machine; a failing read keeps what was there. */
export async function readMachineGit(id: string) {
  const [github, repos] = await Promise.all([
    backend.machineGithub(id).catch(() => undefined),
    backend.machineRepos(id).catch(() => undefined),
  ]);
  change(draft => {
    if (github !== undefined) draft.github[id] = github;
    if (repos !== undefined) draft.repos[id] = repos;
  });
}
export async function pollMachineGit() {
  for (const machine of machines()) if (hasRepos(machine.id)) await readMachineGit(machine.id);
}
const githubMessage = (id: string, text: string) =>
  change(draft => {
    draft.githubMessages[id] = text ? { text, ok: false } : null;
  });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Asks GitHub for a code to type there and waits for it in the background; the code, or null when it failed. */
export async function connectGithub(id: string): Promise<DeviceCode | null> {
  githubMessage(id, "");
  try {
    const code = await backend.machineGithubConnect(id);
    change(draft => {
      draft.device[id] = code;
    });
    waitForGithub(id, code);
    return code;
  } catch (error) {
    githubMessage(id, String(error));
    return null;
  }
}
// every `interval` seconds until the code is typed, refused or expired; a new code replaces this wait
async function waitForGithub(id: string, code: DeviceCode) {
  const until = Date.now() + code.expires_in * 1000;
  const current = () => st().machinesPage.device[id]?.user_code === code.user_code;
  let github: MachineGithub;
  for (;;) {
    await sleep(Math.max(1, code.interval) * 1000);
    if (!current()) return;
    try {
      github = await backend.machineGithubPoll(id);
    } catch (error) {
      if (!current()) return;
      github = { state: "error", login: "", since: "", name: "", email: "", error: String(error) };
    }
    if (!current()) return;
    if (github.state !== "pending" || Date.now() > until) break;
  }
  const problem: Record<string, string> = {
    pending: t("mc.ghExpired"),
    expired: t("mc.ghExpired"),
    denied: t("mc.ghDenied"),
    error: t("mc.ghError", { error: github.error }),
  };
  change(draft => {
    draft.device[id] = null;
    if (github.state !== "pending" && github.state !== "error") draft.github[id] = github;
  });
  githubMessage(id, problem[github.state] ?? "");
  readMachineGit(id);
}
export async function disconnectGithub(id: string) {
  githubMessage(id, "");
  try {
    await backend.machineGithubDisconnect(id);
  } catch (error) {
    githubMessage(id, String(error));
  }
  readMachineGit(id);
}
// one action per machine at a time: its buttons wait, the result shows under the repo
async function repoAction(id: string, name: string, run: () => Promise<string>) {
  const at = `${id}/${name}`;
  change(draft => {
    draft.repoBusy[id] = name;
    draft.repoMessages[at] = null;
  });
  try {
    const text = await run();
    change(draft => {
      draft.repoMessages[at] = { text, ok: true };
    });
  } catch (error) {
    change(draft => {
      draft.repoMessages[at] = { text: String(error), ok: false };
    });
  } finally {
    change(draft => {
      draft.repoBusy[id] = "";
    });
    readMachineGit(id);
  }
}
/** Pushes the branch checked out in a repo there. */
export const pushMachineRepo = (id: string, name: string) =>
  repoAction(id, name, async () => {
    await backend.machineRepoPush(id, name);
    return t("mc.repoPushed");
  });
/** The work in a repo there to this Mac's checkout of it, on `relay/<machine>`. */
export const machineRepoToMac = (id: string, name: string) =>
  repoAction(id, name, async () => t("mc.repoOnMac", await backend.machineRepoToMac(id, name)));
