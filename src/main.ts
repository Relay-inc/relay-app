// The main window: <relay-app> (src/ui/app.ts) draws it from the state in src/app/, boot() starts the app.
import "./styles/base.css";
import "./ui/app";
import { boot } from "./app/boot";

await boot();
