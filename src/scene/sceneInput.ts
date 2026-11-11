import { createContext, useContext } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import type { Selection } from "../core/types";
type Pick = NonNullable<Selection>;
type Field = "position" | "target";
export type SceneInput = {
  begin: (event: ThreeEvent<PointerEvent>, selection: Pick, field?: Field) => void;
  suppressClick: () => boolean;
};
export const InputContext = createContext<SceneInput>({ begin: () => {}, suppressClick: () => false });
export const useSceneInput = () => useContext(InputContext);

