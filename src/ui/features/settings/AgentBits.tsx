import { agent } from "../../../shared/plugins";
import type { AgentStatus } from "../../../domain/agents/types";
import { Glyph } from "../../components/Glyph";
import { useT } from "../../hooks/useT";
import { TILE } from "./blocks";
import { StatusLine } from "./StatusLine";

/** An agent's own glyph, `className` sizes it. */
export function AgentGlyph({ id, className = TILE }: { id: string; className?: string }) {
  const provider = agent(id);
  return provider ? <Glyph svg={provider.glyph} className={className} /> : null;
}

/** What the check found: installed (version), not found, and whether it is signed in. */
export function AgentStatusLine({ detect }: Pick<AgentStatus, "detect">) {
  const { t } = useT();
  const found = !detect.installed
    ? t("ag.missing", { bin: detect.bin })
    : detect.version
      ? t("ag.installed", { version: detect.version })
      : t("ag.installedNoVersion");
  const login = detect.loggedIn == null ? "" : ` · ${detect.loggedIn ? t("ag.loggedIn") : t("ag.loggedOut")}`;
  const level = !detect.installed ? "off" : detect.loggedIn === false ? "warn" : "ok";
  return <StatusLine level={level}>{found + login}</StatusLine>;
}
