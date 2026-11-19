import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./platform";
import { installAndroidShellBridge } from "./platform/android/bridge";
import { installAndroidImageBridge } from "./platform/imageInput";
import "./index.css";

installAndroidShellBridge();
installAndroidImageBridge();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
