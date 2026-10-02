import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { useTerminalsStore } from "../../../application/terminals/store";
import {
  addTerminal,
  allScreens,
  closeTerminal,
  screenOf,
  showTerminal,
} from "../../../application/terminals/terminals";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

// the app's colours, read where they resolve, so light/dark and the pinned theme in the settings both land
function applyTheme(from: HTMLElement) {
  const style = getComputedStyle(from);
  const color = (name: string) => style.getPropertyValue(name).trim();
  for (const { xterm } of allScreens())
    xterm.options.theme = {
      background: color("--bg"),
      foreground: color("--label"),
      cursor: color("--label"),
      selectionBackground: color("--fill-2"),
    };
}

/** The project's shells as tabs, the shown one filling the rest. The terminals outlive this view
 *  (application/terminals): it only re-attaches them. */
export function TerminalsPanel({ project }: { project: string }) {
  const { t } = useT();
  const entry = useTerminalsStore(s => s.byProject[project]);
  const screen = useRef<HTMLDivElement>(null);
  const shown = useRef<number>(0);
  const active = entry?.active ?? 0;
  const empty = !entry?.tabs.length;

  // the first time a project shows terminals it gets one; closing the last tab leaves it empty
  useEffect(() => {
    if (project && empty) addTerminal(project);
    // only when the project changes: closing the last tab must not start another
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // attach the shown terminal; the ResizeObserver keeps it fitted
  useEffect(() => {
    const host = screen.current!;
    const fit = () => {
      if (host.clientWidth > 0 && host.clientHeight > 0) screenOf(shown.current)?.fit.fit();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    const recolor = () => applyTheme(host);
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", recolor);
    const theme = new MutationObserver(recolor);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      observer.disconnect();
      scheme.removeEventListener("change", recolor);
      theme.disconnect();
      shown.current = 0; // the xterm stays alive in the application; the next view attaches it again
    };
  }, []);
  useEffect(() => {
    const host = screen.current!;
    const term = screenOf(active);
    shown.current = active;
    host.replaceChildren(...(term ? [term.el] : []));
    if (!term) return;
    if (!term.xterm.element) term.xterm.open(term.el);
    applyTheme(host);
    if (host.clientWidth > 0 && host.clientHeight > 0) term.fit.fit();
    term.xterm.focus();
  }, [active]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-separator">
        {entry?.tabs.map(tab => (
          <div
            key={tab.id}
            className={`group flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-md text-xs cursor-pointer select-none ${
              tab.id === active ? "bg-fill-2 text-label" : "text-secondary hover:bg-fill"
            } ${tab.exited ? "opacity-60" : ""}`}
            onClick={() => showTerminal(project, tab.id)}
          >
            {tab.title}
            <button
              className="btn-icon cursor-pointer"
              title={t("term.close")}
              aria-label={t("term.close")}
              onClick={e => {
                e.stopPropagation();
                closeTerminal(project, tab.id);
              }}
            >
              <Icon name="close" className="glyph size-3 stroke-current!" />
            </button>
          </div>
        ))}
        <button
          className="btn-icon cursor-pointer"
          title={t("term.new")}
          aria-label={t("term.new")}
          onClick={() => addTerminal(project)}
        >
          <Icon name="plus" className="glyph size-3.75 stroke-current!" />
        </button>
      </div>
      <div ref={screen} className="flex-1 min-h-0 py-1.5 pl-2.5" />
    </div>
  );
}
