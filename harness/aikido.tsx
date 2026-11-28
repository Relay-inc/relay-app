// Harness only: the Security panel (src/ui/features/aikido/AikidoPanel.tsx) in a 460px drawer, for its screenshots
// while the app has no drawer tab for it yet (it is mounted once the drawer's tabs land). Not part of the app build:
// only the harness's Vite server serves it, with the mock backend first like every page. ?fixture=aikido(-nl, -dark)
import "../src/ui/styles/settings-tailwind.css";
import "../src/ui/styles/base.css";
import "../src/ui/styles/settings-theme.css";
import "../src/ui/styles/md-defaults.css";
import "../src/ui/styles/app.css";
import { createRoot } from "react-dom/client";
import { AikidoPanel } from "../src/ui/features/aikido/AikidoPanel";
import { initLanguage, setSettingsState, settings } from "../src/application/settings/settings";
import * as backend from "../src/infrastructure/backend";
import { applyTheme } from "../src/infrastructure/window";

setSettingsState(await backend.getSettings());
await initLanguage();
await applyTheme(settings().theme, settings().accent);
const project = new URLSearchParams(location.search).get("project") ?? "Orchard Health";
createRoot(document.getElementById("root")!).render(
  <div style={{ display: "flex", height: "100vh", background: "var(--bg)", color: "var(--label)" }}>
    <div style={{ flex: 1 }} />
    <aside
      aria-label="Security"
      style={{ width: 460, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--separator)" }}
    >
      {/* the drawer's own tab bar stands here (feat/drawer-tabs) */}
      <div style={{ height: 48, flex: "none", borderBottom: "1px solid var(--separator)" }} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <AikidoPanel project={project} />
      </div>
    </aside>
  </div>,
);
