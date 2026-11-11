export type Vec3 = [number, number, number];
export type ModelKind = "box" | "cylinder" | "building";
export type Model = {
  id: string;
  kind: ModelKind;
  name: string;
  position: Vec3;
  rotation: number;
  size: Vec3;
  color: string;
  visible: boolean;
  locked: boolean;
};
export type Drone = {
  id: string;
  name: string;
  position: Vec3;
  rotation: number;
  color: string;
  fov: number;
  visible: boolean;
};
export type Viewpoint = {
  id: string;
  droneId: string;
  name: string;
  position: Vec3;
  target: Vec3;
  time?: number;
};
export type Source = "内置示例" | "用户手动编排" | "导入的算法结果";
export type SceneBackground = {
  mode: "color" | "image";
  color: string;
  grid: boolean;
  image?: {
    name: string;
    dataUrl: string;
    width: number;
    height: number;
  };
};
export type Project = {
  version: 1;
  name: string;
  models: Model[];
  drones: Drone[];
  viewpoints: Viewpoint[];
  source: Source;
  background?: SceneBackground;
};
export type Selection = {
  type: "model" | "drone" | "viewpoint";
  id: string;
} | null;
export type Tool =
  "select" | "translate" | "rotate" | "scale" | "point" | "target";
export type CameraView = "perspective" | "top" | "side" | "front" | "drone";
