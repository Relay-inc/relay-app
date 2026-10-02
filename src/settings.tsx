// The settings window: Tailwind with the settings palette, base.css for the tokens and the body, settings-theme.css
// for the window's own palette, and the shell.
import "./ui/styles/settings-tailwind.css";
import "./ui/styles/base.css";
import "./ui/styles/settings-theme.css";
import { createRoot } from "react-dom/client";
import { SettingsShell } from "./ui/app/SettingsShell";

createRoot(document.getElementById("root")!).render(<SettingsShell />);
