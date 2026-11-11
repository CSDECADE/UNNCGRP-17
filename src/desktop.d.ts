export {};
declare global {
  interface Window {
    p15Desktop?: {
      platform: string;
      openFile(
        kind: "project" | "plan",
      ): Promise<{ text: string; token: string } | null>;
      acceptOpen(token: string): Promise<void>;
      resetDocument(): Promise<void>;
      saveFile(request: {
        kind: "project" | "export";
        name: string;
        text: string;
        saveAs?: boolean;
      }): Promise<{ name: string } | null>;
      onCommand(
        callback: (
          command:
            "new" | "open" | "save" | "saveAs" | "help" | "undo" | "redo",
        ) => void,
      ): () => void;
    };
  }
}
