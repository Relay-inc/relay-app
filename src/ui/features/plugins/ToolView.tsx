import { useEffect, useRef, useState } from "react";
import type { Item } from "../../../domain/conversations/types";
import { INLINE_HEIGHT, viewFor } from "../../../domain/plugins/rules";
import { useSettingsStore } from "../../../application/settings/store";
import { Icon } from "../../components/Icon";
import { PluginFrame } from "./PluginView";

/** The view of a plugin under the agent's call to one of its tools (Claude Code's `mcp__<server>__<tool>`), fed with the
 *  call's input and result. Nothing for a call that has no view. The frame starts when the view comes near the screen
 *  and then stays, so a long conversation with many calls does not start a server and a frame for each; folding it
 *  only hides it. */
export function ToolView({ item }: { item: Item }) {
  const plugins = useSettingsStore(s => s.settings.plugins);
  const found = item.tool ? viewFor(plugins, item.tool.name) : null;
  const [open, setOpen] = useState(true);
  const [near, setNear] = useState(false);
  const [height, setHeight] = useState(INLINE_HEIGHT);
  const [attempt, setAttempt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const mounted = !!found;
  useEffect(() => {
    if (!mounted || near || !box.current) return;
    const watch = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setNear(true);
        watch.disconnect();
      },
      { rootMargin: "400px" },
    );
    watch.observe(box.current);
    return () => watch.disconnect();
  }, [mounted, near]);
  if (!found || !item.tool) return null;
  const { plugin, uri } = found;
  const input = typeof item.tool.input === "object" && item.tool.input ? item.tool.input : {};
  return (
    <div ref={box} className="mt-1 mb-1.5 overflow-hidden rounded-lg border border-separator">
      <button
        className="flex h-7 w-full cursor-pointer items-center gap-1.5 border-0 bg-fill px-2.5 text-left text-xs text-secondary hover:text-label"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon
          name="right"
          className={`glyph size-3 stroke-2 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        {plugin.name}
      </button>
      <div className={open ? "block" : "hidden"}>
        {near ? (
          <PluginFrame
            key={`${plugin.id}:${uri}:${attempt}`}
            id={plugin.id}
            uri={uri}
            className="block"
            style={{ height }}
            inline={{
              input: input as Record<string, unknown>,
              output: item.output,
              error: item.state === "err",
              onHeight: setHeight,
            }}
            retry={() => setAttempt(attempt + 1)}
          />
        ) : (
          <div style={{ height }} />
        )}
      </div>
    </div>
  );
}
