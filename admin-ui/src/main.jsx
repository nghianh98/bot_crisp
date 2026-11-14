// Entry point of the admin (/admin). Built by Vite into build/admin/, served by the Worker (src/admin/ui.js).
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(<App />);
