import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

import { AuthProvider, useAuth } from "../src/auth/AuthProvider.tsx";
import { AuthPanel } from "./AuthPanel.tsx";

function Dashboard() {
  const { user, isLoading } = useAuth();
  return !isLoading && user ? <App key={user.id} /> : <p>Sign in to load and save impressions.</p>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing popup root.");
createRoot(root).render(<AuthProvider><AuthPanel /><Dashboard /></AuthProvider>);
