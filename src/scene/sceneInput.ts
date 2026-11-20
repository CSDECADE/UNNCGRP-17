import { createContext, createElement, useCallback, useContext, useRef, type ReactNode } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import type { Selection } from "../core/types";
type Pick = NonNullable<Selection>;
type Field = "position" | "target";
export type SceneInput = {
  begin: (event: ThreeEvent<PointerEvent>, selection: Pick, field?: Field) => void;
  suppressClick: () => boolean;
  blockClicks?: (dragging: boolean) => void;
};
export const InputContext = createContext<SceneInput>({ begin: () => {}, suppressClick: () => false });
export const useSceneInput = () => useContext(InputContext);

/** Compose with an installed manual module rather than replacing its drag handlers. */
export function ObjectInputBoundary({ children }: { children: ReactNode }) {
  const parent = useSceneInput(), blockedUntil = useRef(0);
  const blockClicks = useCallback((dragging: boolean) => {
    blockedUntil.current = dragging ? Infinity : performance.now() + 150;
  }, []);
  return createElement(InputContext.Provider, { value: { ...parent, blockClicks,
    suppressClick: () => performance.now() < blockedUntil.current || parent.suppressClick() } }, children);
}

