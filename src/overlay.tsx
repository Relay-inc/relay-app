// The dictation pill (src-tauri/src/anywhere.rs): a small window at the bottom of the screen while dictating into any
// app. It never takes the focus and lets clicks through; the backend shows, fills and hides it.
import "./ui/styles/tailwind.css";
import "./ui/styles/base.css";
import { createRoot } from "react-dom/client";
import { DictationPill } from "./ui/app/DictationPill";
import { initLanguage } from "./application/settings/settings";
import { listenToPill } from "./application/conversations/pill";

await initLanguage();
await listenToPill();
createRoot(document.getElementById("root")!).render(<DictationPill />);
