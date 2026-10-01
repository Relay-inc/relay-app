// The main window: <relay-app> (src/features/shell) draws it from the state in src/domain/, boot() starts the app.
import "./core/styles/base.css";
import "./features/shell/relay-app";
import { boot } from "./app/boot";

await boot();
