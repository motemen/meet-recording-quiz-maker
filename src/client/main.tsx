import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/index.css";

// Get server-side data from window
declare global {
  interface Window {
    __INITIAL_DATA__?: {
      serviceAccountEmail: string;
    };
  }
}

const initialData = window.__INITIAL_DATA__;

if (!initialData) {
  throw new Error("Initial data not found");
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <App serviceAccountEmail={initialData.serviceAccountEmail} />
  </StrictMode>,
);
