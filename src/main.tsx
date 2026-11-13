// The main window: <App> (src/ui/app) draws it from the stores in src/application, boot() starts the app.
// settings-tailwind.css is the app's Tailwind plus the settings palette, which Organisations and servers uses (.s-palette)
import "./ui/styles/settings-tailwind.css";
import "./ui/styles/base.css";
import "./ui/styles/settings-theme.css";
import "./ui/styles/md-defaults.css";
import "./ui/styles/app.css";
import { createRoot } from "react-dom/client";
import { App } from "./ui/app/App";
import { boot } from "./application/boot";
import { isMac } from "./shared/platform";

// Windows has no sidebar material behind the window: the css paints the sidebar itself (base.css, navigation.css)
if (!isMac()) document.documentElement.dataset.os = "windows";
createRoot(document.getElementById("root")!).render(<App />);
await boot();
