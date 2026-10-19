import { useEffect, useRef, useState } from "react";
import {
  designBounds,
  designHide,
  designLink,
  designPlaced,
  onDesignLink,
  designShow,
  setDesignLink,
  useDesignStore,
} from "../../../application/design/design";
import { useT } from "../../hooks/useT";

/** A project's Claude Design canvas: its claude.ai artifact link in a native webview that sits over the empty div
 *  below (design.rs), sized to it. No link yet, or "Change link": a field for it. */
export function DesignPanel({ project }: { project: string }) {
  return <Design key={project} project={project} />;
}

function Design({ project }: { project: string }) {
  const { t } = useT();
  const [saved, setLink] = useState<string | null>(null); // null while it loads
  // a design an agent is making has no link until claude.ai opened it: the page it starts from stands in (design.rs)
  const start = useDesignStore(s => s.start[project]);
  const link = saved === null ? null : saved || start || "";
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const live = link && !editing;

  useEffect(() => {
    designLink(project).then(setLink);
    return onDesignLink(created => created.project === project && setLink(created.url));
  }, [project]);

  useEffect(() => {
    const el = box.current;
    if (!live || !el) return;
    let shown = false;
    const place = () => {
      const r = el.getBoundingClientRect();
      (shown ? designBounds(r) : designShow(link, r))
        .then(() => designPlaced(project, true))
        .catch(e => setError(String(e)));
      shown = true;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    // the drawer column slides in (and the sidebar collapses) by a grid transition: the box moves without
    // resizing, so a ResizeObserver alone keeps the native view where it was mid-slide
    document.addEventListener("transitionend", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("transitionend", place);
      designHide();
      designPlaced(project, false);
    };
  }, [live, link, project]);

  const save = async (value: string) => {
    try {
      await setDesignLink(project, value);
      setError("");
      setLink(value.trim());
      setEditing(false);
    } catch {
      setError(t("design.invalid"));
    }
  };

  if (link === null) return null;
  if (!live) {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={e => {
          e.preventDefault();
          save(String(new FormData(e.currentTarget).get("url") ?? ""));
        }}
      >
        <p className="text-xs text-secondary">{t("design.hint")}</p>
        <input
          name="url"
          defaultValue={saved ?? ""}
          placeholder="https://claude.ai/artifact/…"
          spellCheck={false}
          autoFocus
          className="h-8 w-full rounded-md border border-s-input bg-transparent px-2.5 text-sm placeholder:text-s-subtle focus-visible:outline-none focus-visible:ring-1 ring-s-primary"
        />
        {error ? <p className="text-xs text-s-err">{error}</p> : null}
        <button type="submit" className="btn btn-primary self-start">
          {t("design.save")}
        </button>
      </form>
    );
  }
  return (
    <>
      <div className="flex-none flex items-center pb-2">
        <button className="text-xs text-secondary hover:text-label" onClick={() => setEditing(true)}>
          {t("design.change")}
        </button>
        {error ? <span className="ml-2 text-xs text-s-err truncate">{error}</span> : null}
      </div>
      <div ref={box} className="flex-1 min-h-0" />
    </>
  );
}
