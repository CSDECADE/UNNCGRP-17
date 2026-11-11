import React from "react";
import { createRoot } from "react-dom/client";
import { EditorProvider } from "./core/editor";
import { DocumentProvider } from "./core/documents";
import { App } from "./App";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <EditorProvider>
      <DocumentProvider>
        <App />
      </DocumentProvider>
    </EditorProvider>
  </React.StrictMode>,
);
