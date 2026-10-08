// The phone's webview (mobile.html, mobile/src-tauri): <PhoneApp> (src/ui/mobile) on the desktop's stores, bootPhone()
// starts it against the phone's backend.
import "../ui/styles/tailwind.css";
import "../ui/styles/base.css";
import "../ui/styles/md-defaults.css";
import "../ui/styles/app.css";
import { createRoot } from "react-dom/client";
import { PhoneApp } from "../ui/mobile/PhoneApp";
import { bootPhone } from "../application/mobile/phone";

createRoot(document.getElementById("root")!).render(<PhoneApp />);
await bootPhone();
