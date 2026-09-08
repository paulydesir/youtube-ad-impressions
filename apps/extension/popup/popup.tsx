import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { AuthProvider } from "../src/auth/AuthProvider.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Missing popup root.");
createRoot(root).render(<AuthProvider><App /></AuthProvider>);
