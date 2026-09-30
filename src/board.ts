import { t } from "./i18n";
import { PROVIDERS, type BoardProvider, type BoardRef, type Card, type Column, type Ctx, type Opt } from "./providers";

// A provider's board as a kanban: pick a project and one of its boards, the columns and cards come from
// the provider (src/providers/). Dragging a card to another column moves it in the tracker right away,
// it is the user's own action (decided 30/9). The backend holds the token.
// The board can be linked to a vault project (settings.boards): opening the board from that project shows it.
type H = {
  esc: (s: unknown) => string; ctx: () => Ctx; open: (card: string, ref: BoardRef) => void;
  /** vault project names with their label, and the mapping in settings.boards */
  vaultProjects: () => [string, string][]; linked: () => Record<string, BoardRef>; link: (vaultProject: string, ref: BoardRef) => void;
};
type State = { projects: Opt[] | null; boards: Opt[]; columns: Column[]; cards: Card[]; project: string; board: string };

const ls = { get: (k: string) => localStorage.getItem(k) || "", set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };
// the Productive keys of before the providers, so the board opens where it was
const lsKey = (p: BoardProvider) => p.id === "productive" ? "pv" : p.id;
const states = new Map<string, State>();
let el: HTMLElement | null = null, h: H, pv: BoardProvider, s: State, err = "", busy = false, gen = 0;
const ref = (): BoardRef => ({ provider: pv.id, project: s.project, board: s.board });

// one load at a time: a newer choice makes the answer of an older one irrelevant
async function run(fn: (live: () => boolean) => Promise<void>) {
  const g = ++gen, live = () => g === gen;
  busy = true; err = ""; draw();
  try { await fn(live); } catch (x) { if (live()) err = String(x); }
  if (live()) { busy = false; draw(); }
}
const remember = () => { ls.set(`${lsKey(pv)}Project`, s.project); ls.set(`${lsKey(pv)}Board`, s.board); };
async function loadCards(live: () => boolean, b: string) {
  const r = { ...ref(), board: b };
  const [cols, cs] = b ? await Promise.all([pv.columns(h.ctx(), r), pv.cards(h.ctx(), r)]) : [[], []];
  if (!live()) return false;
  s.board = b; s.columns = cols; s.cards = cs; remember();
  return true;
}

/** new credentials or a new language: start over */
export function resetBoard() { states.clear(); err = ""; PROVIDERS.forEach(p => p.reset?.()); }

/** Show the provider's board in the element, from what is known right away, then fresh from the tracker. `prefer` is the board to open. */
export function showBoard(target: HTMLElement, p: BoardProvider, helpers: H, prefer?: BoardRef) {
  el = target; h = helpers; pv = p;
  if (!states.has(p.id)) states.set(p.id, { projects: null, boards: [], columns: [], cards: [], project: ls.get(`${lsKey(p)}Project`), board: ls.get(`${lsKey(p)}Board`) });
  s = states.get(p.id)!;
  if (prefer?.provider === p.id && (prefer.project !== s.project || prefer.board !== s.board)) {
    s.project = prefer.project; s.board = prefer.board; s.boards = []; s.columns = []; s.cards = [];
  }
  run(async live => {
    const ps = s.projects ?? await pv.projects(h.ctx()); if (!live()) return;
    s.projects = ps;
    if (!ps.some(x => x.id === s.project)) { s.project = ""; s.board = ""; }
    const bs = s.project ? await pv.boards(h.ctx(), s.project) : []; if (!live()) return;
    s.boards = bs;
    await loadCards(live, bs.some(b => b.id === s.board) ? s.board : bs[0]?.id || "");
  });
}

const sameRef = (a: BoardRef | undefined, b: BoardRef) => !!a && a.provider === b.provider && a.project === b.project && a.board === b.board;
function draw() {
  if (!el?.isConnected || drag?.on) return;
  const e = h.esc;
  const pick = (id: string, opts: Opt[], cur: string, empty: string, always = false) =>
    `<select id="${id}" class="kbsel">${cur && !always ? "" : `<option value="">${empty}</option>`}${opts.map(o => `<option value="${e(o.id)}"${o.id === cur ? " selected" : ""}>${e(o.name)}</option>`).join("")}</select>`;
  const card = (c: Card) => `<div class="kcard" data-card="${e(c.id)}"><div class="kt">${e(c.title)}</div>
    <div class="km">${c.number ? `<span>#${e(c.number)}</span>` : ""}${c.who ? `<span>${e(c.who)}</span>` : ""}${c.due ? `<span>${e(c.due.split("-").reverse().slice(0, 2).map(Number).join("/"))}</span>` : ""}</div></div>`;
  const col = (l: Column) => { const cs = s.cards.filter(c => c.column === l.id).sort((a, b) => a.placement - b.placement);
    return `<div class="kcol" data-list="${e(l.id)}"><div class="kh"><span>${e(l.name)}</span><span class="count">${cs.length}</span></div><div class="kcards">${cs.map(card).join("")}</div></div>`; };
  // which vault project this board belongs to: a vault project has at most one board
  const vps = h.vaultProjects(), cur = Object.entries(h.linked()).find(([, r]) => sameRef(r, ref()))?.[0] ?? "";
  const link = s.board && vps.length ? `<span class="kblink" title="${t("kb.linkHelp")}">${t("kb.link")}</span>${pick("kblink", vps.map(([id, name]) => ({ id, name })), cur, t("kb.linkNone"), true)}` : "";
  // a redraw replaces the columns, keep where the board and each column were scrolled to
  const sx = el.querySelector(".kb")?.scrollLeft ?? 0;
  const sy = new Map([...el.querySelectorAll<HTMLElement>(".kcol")].map(c => [c.dataset.list, c.querySelector(".kcards")!.scrollTop]));
  el.innerHTML = `<div class="kbhead">${pick("pvproj", s.projects || [], s.project, s.projects ? t("kb.pickProject") : t("pr.loading"))}`
    + (s.project ? pick("pvboard", s.boards, s.board, t("kb.noBoards")) : "")
    + `<span class="sp"></span>${link}${busy ? '<span class="spin"></span>' : ""}<button class="btn" data-kb="reload">${t("pr.reload")}</button></div>`
    + (err ? `<div class="err">${e(err)}</div>` : "")
    + (s.board && s.columns.length ? `<div class="kb">${s.columns.map(col).join("")}</div>` : s.board && !busy && !err ? `<div class="note">${t("kb.noCols")}</div>` : "");
  const kb = el.querySelector(".kb"); if (kb) kb.scrollLeft = sx;
  el.querySelectorAll<HTMLElement>(".kcol").forEach(c => { c.querySelector(".kcards")!.scrollTop = sy.get(c.dataset.list) ?? 0; });
}

document.addEventListener("change", e => {
  const x = e.target as HTMLSelectElement;
  if (!el || !x.closest("#kb")) return;
  if (x.id === "pvproj") {
    const p = x.value;
    run(async live => {
      const bs = p ? await pv.boards(h.ctx(), p) : []; if (!live()) return;
      s.project = p; s.boards = bs; s.columns = []; s.cards = [];
      await loadCards(live, bs[0]?.id || "");
    });
  } else if (x.id === "pvboard") {
    const b = x.value;
    run(live => loadCards(live, b).then(() => {}));
  } else if (x.id === "kblink") {
    h.link(x.value, ref());
  }
});
document.addEventListener("click", e => {
  if ((e.target as HTMLElement).closest("#kb [data-kb=reload]") && el) { s.projects = null; showBoard(el, pv, h); }
});

// dragging a card: pointer events, the Mac webview does not deliver HTML drag and drop reliably
let drag: { id: string; x: number; y: number; dx: number; dy: number; on: boolean; ghost?: HTMLElement; over?: string } | null = null;
document.addEventListener("pointerdown", e => {
  const c = (e.target as HTMLElement).closest<HTMLElement>("#kb .kcard");
  if (!c || e.button !== 0) return;
  e.preventDefault();
  const r = c.getBoundingClientRect();
  drag = { id: c.dataset.card!, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, on: false };
});
window.addEventListener("pointermove", e => {
  if (!drag) return;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    const c = document.querySelector<HTMLElement>(`#kb .kcard[data-card="${CSS.escape(drag.id)}"]`);
    if (!c) { drag = null; return; }
    drag.on = true;
    drag.ghost = c.cloneNode(true) as HTMLElement;
    drag.ghost.classList.add("kghost"); drag.ghost.style.width = `${c.offsetWidth}px`;
    document.body.append(drag.ghost); c.classList.add("dragging"); document.body.classList.add("reordering");
  }
  drag.ghost!.style.transform = `translate(${e.clientX - drag.dx}px,${e.clientY - drag.dy}px)`;
  const col = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("#kb .kcol");
  document.querySelectorAll("#kb .kcol.over").forEach(x => x.classList.remove("over"));
  drag.over = col?.dataset.list; col?.classList.add("over");
});
window.addEventListener("pointerup", () => {
  const d = drag; drag = null;
  if (!d) return;
  if (!d.on) { h.open(d.id, ref()); return; }
  d.ghost?.remove(); document.body.classList.remove("reordering");
  const c = s.cards.find(x => x.id === d.id);
  if (c && d.over && d.over !== c.column) move(c, d.over); else draw();
});

// shown in the new column at once, back where it was when the tracker refuses
async function move(c: Card, to: string) {
  const from = c.column, was = c.placement;
  c.column = to; c.placement = Math.max(0, ...s.cards.filter(x => x.column === to && x !== c).map(x => x.placement)) + 1; err = ""; draw();
  try {
    const placed = await pv.move(h.ctx(), ref(), c, to);
    if (placed != null) c.placement = placed;
  } catch (x) { c.column = from; c.placement = was; err = t("kb.moveFailed", { e: String(x) }); }
  draw();
}
