// The quick capture window (src-tauri/src/anywhere.rs): one text field, a mic and Save to Inbox. It opens over any app.
import "./ui/styles/tailwind.css";
import "./ui/styles/base.css";
import { createRoot } from "react-dom/client";
import { CaptureWindow } from "./ui/app/CaptureWindow";

createRoot(document.getElementById("root")!).render(<CaptureWindow />);
