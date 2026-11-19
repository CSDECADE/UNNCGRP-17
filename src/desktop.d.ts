export {};
declare global {
  type DesktopDocument =
    | { kind: "package"; bytes: Uint8Array; fileName: string; token: string }
    | { kind: "json"; text: string; fileName: string; token: string };
  type RecentProject = {
    id: string;
    name: string;
    fileName: string;
    folder: string;
    openedAt: number;
    missing: boolean;
  };
  interface Window {
    p15Desktop?: {
      platform: string;
      openFile(
        kind: "project" | "plan",
      ): Promise<{ text: string; token: string } | null>;
      acceptOpen(token: string): Promise<void>;
      resetDocument(): Promise<void>;
      /** Open an .aeproj package (or a legacy .json project). */
      openProject(): Promise<DesktopDocument | null>;
      openRecent(id: string): Promise<DesktopDocument>;
      /** Make the opened file the current document once its content passed validation. */
      acceptProject(token: string, name: string): Promise<{ fileName: string | null }>;
      savePackage(request: { name: string; bytes: Uint8Array; saveAs?: boolean }): Promise<{ fileName: string } | null>;
      recentProjects(): Promise<RecentProject[]>;
      removeRecent(id: string): Promise<void>;
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
