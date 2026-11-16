// The record nudge (src-tauri/src/notify.rs): a meeting started and nothing records it. Stays until Record or Skip.
import "./ui/styles/tailwind.css";
import "./ui/styles/base.css";
import { createRoot } from "react-dom/client";
import { RecordNudge } from "./ui/app/RecordNudge";
import { initLanguage } from "./application/settings/settings";
import { listenToNudgeWindow } from "./application/calendar/nudge-window";

await initLanguage();
await listenToNudgeWindow();
createRoot(document.getElementById("root")!).render(<RecordNudge />);
