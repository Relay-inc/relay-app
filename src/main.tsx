// The main window: <App> (src/ui/app) draws it from the stores in src/application, boot() starts the app.
import "./ui/styles/tailwind.css";
import "./ui/styles/base.css";
import "./ui/styles/md-defaults.css";
import "./ui/styles/app.css";
import { createRoot } from "react-dom/client";
import { App } from "./ui/app/App";
import { boot } from "./application/boot";

createRoot(document.getElementById("root")!).render(<App />);
await boot();
