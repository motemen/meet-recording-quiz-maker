import { renderToString } from "react-dom/server";
import { App } from "./ssr/App.js";
import type { AppState, RenderResult } from "./ssr/types.js";

export function render(_url: string, state: AppState): RenderResult {
  const html = renderToString(<App initialState={state} />);
  return {
    html,
    state,
  };
}
