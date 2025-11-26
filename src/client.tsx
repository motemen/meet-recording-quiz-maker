import { hydrateRoot } from "react-dom/client";
import { App, type AppProps } from "./components/App";

const data: AppProps = (window as { __SSR_DATA__?: AppProps }).__SSR_DATA__ || {
  serviceAccountEmail: "",
};

const root = document.getElementById("root");
if (root) {
  hydrateRoot(root, <App {...data} />);
}
