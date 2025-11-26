import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./ssr/App.js";

const container = document.getElementById("root");
const initialStateElement = document.getElementById("initial-state");
const initialState = initialStateElement?.textContent
  ? JSON.parse(initialStateElement.textContent)
  : undefined;

if (!container || !initialState) {
  throw new Error("Root container or initial state missing");
}

if (container.hasChildNodes()) {
  hydrateRoot(container, <App initialState={initialState} />);
} else {
  createRoot(container).render(<App initialState={initialState} />);
}
