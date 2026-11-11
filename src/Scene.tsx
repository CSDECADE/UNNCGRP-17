import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  Component,
  Fragment,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  Canvas,
  events as canvasEvents,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import {
  Edges,
  Line,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  useGLTF,
  useProgress,
} from "@react-three/drei";
import {
  CanvasTexture,
  MOUSE,
  Group,
  SRGBColorSpace,
  Vector3,
  PerspectiveCamera as PreviewCamera,
  type Sprite,
  type Object3D,
  type Mesh,
} from "three";
import type { OrbitControls as OrbitImpl } from "three-stdlib";
import { useEditor } from "./core/editor";
import { poseAt, routeFor } from "./core/project";
import type { Drone, Model, Selection, Vec3, Viewpoint } from "./core/types";
import { useSceneInput } from "./scene/sceneInput";
import { cameraUp } from "./scene/dragMath";
import { DEFAULT_SCENE_BACKGROUND } from "./core/background";
import { SceneBackground } from "./scene/SceneBackground";
import { fitBackground } from "./scene/backgroundTexture";

function Label({
  text,
  position,
  color = "#e7e9ee",
  selected = false,
}: {
  text: string;
  position: Vec3;
  color?: string;
  selected?: boolean;
}) {
  const { camera, viewport, size } = useThree();
  const ref = useRef<Sprite>(null);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d")!;
    ctx.font = "500 26px sans-serif";
    canvas.width = Math.ceil(ctx.measureText(text).width) + 28;
    canvas.height = 44;
    ctx.font = "500 26px sans-serif";
    ctx.fillStyle = selected ? "#174773" : "#2c2c2c";
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, 44, 7);
    ctx.fill();
    ctx.strokeStyle = selected ? "#4d9dff" : "#59616d";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(text, 14, 23);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }, [text, color, selected]);
  useEffect(() => () => texture.dispose(), [texture]);
  const ratio = texture.image.width / texture.image.height;
  useFrame(() => {
    if (!ref.current) return;
    const height = viewport.getCurrentViewport(camera, ref.current.getWorldPosition(new Vector3())).height / size.height * 22;
    ref.current.scale.set(height * ratio, height, 1);
  });
  return (
    <sprite
      position={position}
      ref={ref}
      renderOrder={20}
      userData={{ editorOverlay: true, pickPriority: 1 }}
    >
      <spriteMaterial
        map={texture}
        transparent
        depthTest={false}
        sizeAttenuation
      />
    </sprite>
  );
}

function Asset({ kind }: { kind: "building" | "drone" }) {
  const { scene } = useGLTF(`/models/${kind}.glb`);
  const instance = useMemo(() => {
    const g = scene.clone(true);
    g.traverse((o) => {
      if ("isMesh" in o) {
        (o as Mesh).castShadow = true;
        (o as Mesh).receiveShadow = true;
      }
    });
    return g;
  }, [scene]);
  return <primitive object={instance} dispose={null} />;
}
function Transformable({
  selection,
  position,
  rotation = 0,
  size,
  locked = false,
  children,
}: {
  selection: NonNullable<Selection>;
  position: Vec3;
  rotation?: number;
  size?: Vec3;
  locked?: boolean;
  children: ReactNode;
}) {
  const e = useEditor(), input = useSceneInput();
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta > 2 || input.suppressClick()) return;
    if (e.tool === "target") {
      if (e.selection?.type === "viewpoint") {
        e.patch("viewpoint", e.selection.id, { target: event.point.toArray() });
        e.setTool("select");
      }
      return;
    }
    if (e.tool === "point") {
      e.addPoint([
        event.point.x,
        Math.max(12, event.point.y + 5),
        event.point.z,
      ]);
      return;
    }
    e.select(selection);
  };
  return (
    <>
      <group
        position={position}
        rotation={[0, (rotation * Math.PI) / 180, 0]}
        userData={{ editorOverlay: selection.type !== "model", pickPriority: selection.type === "viewpoint" ? 2 : 0 }}
        onPointerDown={(event) => { if (!locked) input.begin(event, selection); }}
        onClick={click}
        onDoubleClick={(ev) => {
          ev.stopPropagation();
          e.select(selection);
          e.focus();
        }}
      >
        {children}
      </group>
    </>
  );
}
function ModelObject({ model: m }: { model: Model }) {
  const e = useEditor(),
    selected = e.selection?.id === m.id;
  if (!m.visible) return null;
  return (
    <Transformable
      selection={{ type: "model", id: m.id }}
      position={m.position}
      rotation={m.rotation}
      size={m.size}
      locked={m.locked}
    >
      {m.kind === "building" ? (
        <group scale={[m.size[0] / 24, m.size[1] / 18, m.size[2] / 14]}>
          <Asset kind="building" />
        </group>
      ) : (
        <mesh
          position={[0, m.size[1] / 2, 0]}
          scale={
            m.kind === "cylinder" ? [1, 1, m.size[2] / m.size[0]] : [1, 1, 1]
          }
          castShadow
          receiveShadow
        >
          {m.kind === "cylinder" ? (
            <cylinderGeometry
              args={[m.size[0] / 2, m.size[0] / 2, m.size[1], 48]}
            />
          ) : (
            <boxGeometry args={m.size} />
          )}
          <meshStandardMaterial color={m.color} roughness={0.8} />
        </mesh>
      )}
      {selected && (
        <>
          <mesh position={[0, m.size[1] / 2, 0]} raycast={() => null}>
            <boxGeometry args={m.size.map((n) => n + 0.15) as Vec3} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            <Edges color="#4d9dff" depthTest={false} userData={{ editorOverlay: true }} />
          </mesh>
          <Label
            text={`${m.name} · ${m.size[1].toFixed(1)} m`}
            position={[0, m.size[1] + 1.5, 0]}
            selected
          />
        </>
      )}
    </Transformable>
  );
}
function CameraFrustum({
  position,
  target,
  fov,
  color,
}: {
  position: Vec3;
  target: Vec3;
  fov: number;
  color: string;
}) {
  const aspect = 16 / 9;
  const line = useMemo(() => {
    const p = new Vector3(...position),
      towards = new Vector3(...target).sub(p);
    const distance = Math.min(12, towards.length());
    if (distance < 0.01) return [position, position] as Vec3[];
    const direction = towards.normalize(),
      up = cameraUp(position, target);
    const right = new Vector3().crossVectors(direction, up).normalize(),
      vertical = new Vector3().crossVectors(right, direction).normalize();
    const height = Math.tan((fov * Math.PI) / 360) * distance,
      center = p.clone().addScaledVector(direction, distance);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(
      ([x, y]) =>
        center
          .clone()
          .addScaledVector(right, x * height * aspect)
          .addScaledVector(vertical, y * height)
          .toArray() as Vec3,
    );
    return [
      position,
      corners[0],
      corners[1],
      position,
      corners[2],
      corners[1],
      corners[2],
      corners[3],
      position,
      corners[0],
      corners[3],
    ];
  }, [position, target, fov, aspect]);
  return (
    <Line
      userData={{ editorOverlay: true }}
      points={line}
      color={color}
      lineWidth={1}
      transparent
      opacity={0.45}
      raycast={() => null}
    />
  );
}
function DroneObject({ drone: d }: { drone: Drone }) {
  const e = useEditor(),
    pose = poseAt(e.project, d, e.progress),
    selected = e.selection?.id === d.id;
  const position = e.preview ? pose.position : d.position;
  const yaw = e.preview
    ? (Math.atan2(
        pose.position[0] - pose.target[0],
        pose.position[2] - pose.target[2],
      ) *
        180) /
      Math.PI
    : d.rotation;
  if (!d.visible || (e.view === "drone" && e.chosenDrone()?.id === d.id))
    return null;
  return (
    <>
      <Transformable
        selection={{ type: "drone", id: d.id }}
        position={position}
        rotation={yaw}
      >
        <Asset kind="drone" />
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -0.5, 0]}
          raycast={() => null}
        >
          <ringGeometry args={[2.3, selected ? 2.5 : 2.37, 64]} />
          <meshBasicMaterial color={d.color} transparent opacity={0.8} />
        </mesh>
        <Label
          text={d.name}
          position={[0, 2, 0]}
          color={d.color}
          selected={selected}
        />
      </Transformable>
      {(selected || e.preview) && (
        <CameraFrustum
          position={position}
          target={pose.target}
          fov={d.fov}
          color={d.color}
        />
      )}
    </>
  );
}
function PointMarker({ color, selected = false }: { color: string; selected?: boolean }) {
  const ref = useRef<Group>(null);
  const { camera, viewport, size } = useThree();
  useFrame(() => {
    if (!ref.current) return;
    const pixel = viewport.getCurrentViewport(camera, ref.current.getWorldPosition(new Vector3())).height / size.height;
    ref.current.scale.setScalar(pixel * (selected ? 7 : 5));
  });
  return <group ref={ref} userData={{ editorOverlay: true }}>
    <mesh><sphereGeometry args={[1, 16, 12]} /><meshBasicMaterial color={color} depthTest={false} /></mesh>
    <mesh><sphereGeometry args={[2.1, 12, 8]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh>
  </group>;
}
function PointObject({
  point: v,
  index,
  color,
}: {
  point: Viewpoint;
  index: number;
  color: string;
}) {
  const e = useEditor(), input = useSceneInput(),
    selected = e.selection?.id === v.id,
    d = e.project.drones.find((d) => d.id === v.droneId)!;
  return (
    <>
      <Transformable
        selection={{ type: "viewpoint", id: v.id }}
        position={v.position}
      >
        <PointMarker selected={selected} color={selected ? "#fff" : color} />
        <Label
          text={String(index + 1).padStart(2, "0")}
          position={[0, 1.5, 0]}
          color={color}
          selected={selected}
        />
      </Transformable>
      {selected && (
        <>
          <CameraFrustum
            position={v.position}
            target={v.target}
            fov={d.fov}
            color={color}
          />
          <Line
            userData={{ editorOverlay: true }}
            points={[v.position, v.target]}
            color={color}
            dashed
            dashSize={0.6}
            gapSize={0.5}
            raycast={() => null}
          />
          <group position={v.target} userData={{ editorOverlay: true, pickPriority: 2 }}
            onPointerDown={(event) => input.begin(event, { type: "viewpoint", id: v.id }, "target")}
            onClick={(event) => { event.stopPropagation(); if (!input.suppressClick() && event.delta < 2) e.setTransformTarget("target"); }}>
            <PointMarker selected={e.transformTarget === "target"} color="#f0be65" />
            <Label text="镜头目标" position={[0, 1.8, 0]} color="#f0be65" selected={e.transformTarget === "target"} />
          </group>
        </>
      )}
    </>
  );
}
function CameraRig() {
  const e = useEditor(),
    { camera, size } = useThree(),
    controls = useRef<OrbitImpl>(null);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const selected = e.selection?.type === "model" ? e.project.models.find(x => x.id === e.selection?.id)
      : e.selection?.type === "drone" ? e.project.drones.find(x => x.id === e.selection?.id)
      : e.project.viewpoints.find(x => x.id === e.selection?.id);
    const center = new Vector3(...(selected?.position ?? [0, 6, 0] as Vec3));
    camera.up.set(0, 1, 0);
    if (e.view === "top") {
      camera.position.copy(center).add(new Vector3(0, 100, 0));
      camera.up.set(0, 0, -1);
    } else if (e.view === "side") camera.position.copy(center).add(new Vector3(100, 0, 0));
    else if (e.view === "front") camera.position.copy(center).add(new Vector3(0, 0, 100));
    else camera.position.copy(center).add(new Vector3(68, 50, 76));
    c.target.copy(center);
    camera.lookAt(c.target);
    camera.updateProjectionMatrix();
    c.update();
  }, [camera, e.view]);
  useEffect(() => {
    if (!e.focusTick || !controls.current) return;
    const item =
      e.selection?.type === "model"
        ? e.project.models.find((x) => x.id === e.selection?.id)
        : e.selection?.type === "drone"
          ? e.project.drones.find((x) => x.id === e.selection?.id)
          : e.project.viewpoints.find((x) => x.id === e.selection?.id);
    const pos = item && "target" in item && e.transformTarget === "target" ? item.target : item?.position ?? [0, 6, 0];
    const center = new Vector3(...pos);
    const radius = item && "size" in item ? Math.max(...item.size) : 12;
    if (item && "size" in item) center.y += item.size[1] / 2;
    const direction = camera.position.clone().sub(controls.current.target).normalize();
    controls.current.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, Math.max(25, radius * 3));
    if ("zoom" in camera && camera.type === "OrthographicCamera") {
      camera.zoom = Math.min(size.width, size.height) / (radius * 3);
      camera.updateProjectionMatrix();
    }
    controls.current.update();
  }, [e.focusTick]);
  useFrame(() => {
    if (e.view !== "drone") return;
    const d = e.chosenDrone();
    if (!d) return;
    const selectedPoint = e.selection?.type === "viewpoint" ? e.project.viewpoints.find(v => v.id === e.selection?.id) : undefined;
    const pose = !e.preview && selectedPoint ? selectedPoint : poseAt(e.project, d, e.progress);
    camera.position.set(...pose.position);
    camera.up.copy(cameraUp(pose.position, pose.target));
    camera.lookAt(...pose.target);
    if ("fov" in camera) {
      (camera as import("three").PerspectiveCamera).fov = d.fov;
      camera.updateProjectionMatrix();
    }
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={e.view !== "drone" && !e.isTransforming}
      enableRotate={e.view === "perspective"}
      enableDamping={false}
      mouseButtons={{ LEFT: e.view === "perspective" ? MOUSE.ROTATE : MOUSE.PAN, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN }}
      minDistance={3}
      maxDistance={350}
      maxPolarAngle={e.view === "perspective" ? Math.PI / 2 - 0.04 : Math.PI}
    />
  );
}
function World() {
  const e = useEditor(), input = useSceneInput();
  return (
    <>
      <SceneBackground />
      {e.view === "top" || e.view === "side" || e.view === "front" ? (
        <OrthographicCamera
          makeDefault
          position={[0, 100, 0]}
          zoom={7}
          near={0.1}
          far={1000}
        />
      ) : (
        <PerspectiveCamera
          makeDefault
          position={[68, 56, 76]}
          fov={45}
          near={0.1}
          far={1000}
        />
      )}
      <CameraRig />
      <ambientLight intensity={1.2} />
      <hemisphereLight args={["#d6e5ff", "#505562", 1.3]} />
      <directionalLight
        position={[25, 60, 30]}
        intensity={2.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-bias={-0.0005}
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={(ev) => {
          ev.stopPropagation();
          if (ev.delta > 2 || input.suppressClick()) return;
          if (e.tool === "point") e.addPoint([ev.point.x, 15, ev.point.z]);
          else if (e.tool === "target" && e.selection?.type === "viewpoint") {
            e.patch("viewpoint", e.selection.id, {
              target: ev.point.toArray(),
            });
            e.setTool("select");
          } else e.select(null);
        }}
      >
        <planeGeometry args={[600, 600]} />
        <shadowMaterial transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <gridHelper
        visible={(e.project.background ?? DEFAULT_SCENE_BACKGROUND).grid}
        userData={{ editorOverlay: true }}
        args={[400, 200, "#4c5159", "#343941"]}
        position={[0, 0.04, 0]}
        raycast={() => null}
      />
      <Suspense fallback={null}>
        {e.project.models.map((m) => (
          <ModelObject key={m.id} model={m} />
        ))}
        {e.project.drones.map((d) => (
          <DroneObject key={d.id} drone={d} />
        ))}
      </Suspense>
      {e.project.drones
        .filter((d) => d.visible)
        .map((d) => {
          const route = routeFor(e.project, d.id);
          return (
            <group key={d.id}>
              {route.length > 1 && (
                <Line
                  userData={{ editorOverlay: true }}
                  points={route.map((v) => v.position)}
                  color={d.color}
                  lineWidth={1.3}
                  transparent
                  opacity={0.7}
                  dashed
                  dashSize={0.6}
                  gapSize={0.4}
                  raycast={() => null}
                />
              )}
              {!e.playing &&
                route.map((v, i) => (
                  <PointObject key={v.id} point={v} index={i} color={d.color} />
                ))}
            </group>
          );
        })}
    </>
  );
}
function CameraPreview() {
  const e = useEditor();
  const previewCamera = useMemo(() => new PreviewCamera(60, 16 / 9, 0.1, 1000), []);
  useFrame(({ gl, scene, camera, size }) => {
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
    fitBackground(scene.background, size.width, size.height);
    gl.render(scene, camera);
    const point = e.selection?.type === "viewpoint" && !e.preview && e.view !== "drone"
      ? e.project.viewpoints.find(v => v.id === e.selection?.id) : undefined;
    const drone = point && e.project.drones.find(d => d.id === point.droneId);
    if (!point || !drone) return;
    previewCamera.position.set(...point.position);
    previewCamera.up.copy(cameraUp(point.position, point.target));
    previewCamera.lookAt(...point.target);
    previewCamera.fov = drone.fov;
    previewCamera.updateProjectionMatrix();
    const hidden: Object3D[] = [];
    scene.traverse(object => {
      if (object.visible && object.userData.editorOverlay) { hidden.push(object); object.visible = false; }
    });
    const width = Math.min(240, size.width * 0.32), height = width * 9 / 16;
    gl.setViewport(size.width - width - 16, size.height - height - 66, width, height);
    gl.setScissor(size.width - width - 16, size.height - height - 66, width, height);
    gl.setScissorTest(true);
    try {
      fitBackground(scene.background, width, height);
      gl.render(scene, previewCamera);
    }
    finally {
      fitBackground(scene.background, size.width, size.height);
      hidden.forEach(object => { object.visible = true; });
      gl.setScissorTest(false);
      gl.setScissor(0, 0, size.width, size.height);
      gl.setViewport(0, 0, size.width, size.height);
    }
  }, 1);
  return null;
}
class CanvasBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: Error) {
    console.error("Scene rendering failed", error);
  }
  render() {
    return this.state.error ? (
      <div className="scene-error">
        <strong>场景暂时无法显示</strong>
        <p>请重新加载场景。若仍无法显示，请保存项目后重启应用。</p>
        <button onClick={() => this.setState({ error: false })}>
          重新加载场景
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function Scene({ Controls = Fragment }: { Controls?: ComponentType<{ children: ReactNode }> }) {
  const { active } = useProgress();
  const e = useEditor();
  const currentTool = useRef(e.tool);
  currentTool.current = e.tool;
  return (
    <CanvasBoundary>
      <Canvas shadows="basic" dpr={[1, 1.8]} gl={{ antialias: true }} events={(state) => ({
        ...canvasEvents(state),
        filter: (hits) => {
          if (currentTool.current === "point" || currentTool.current === "target") return hits.filter(hit => {
            for (let node: Object3D | null = hit.object; node; node = node.parent)
              if (node.userData.editorOverlay) return false;
            return true;
          });
          const priority = (object: Object3D | null): number => {
            let value = 0;
            for (let node = object; node; node = node.parent) value = Math.max(value, node.userData.pickPriority ?? 0);
            return value;
          };
          return hits.sort((a, b) => priority(b.object) - priority(a.object) || a.distance - b.distance);
        },
      })}>
        <Controls><World /><CameraPreview /></Controls>
      </Canvas>
      {e.selection?.type === "viewpoint" && !e.preview && e.view !== "drone" && (
        <><div className="camera-preview-label">拍摄点取景 · 16:9</div>
          <div className="camera-preview-surface" role="img" aria-label="当前拍摄点的相机取景"
            onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} />
        </>
      )}
      {active && (
        <div className="scene-loading-status" role="status">
          正在加载模型…
        </div>
      )}
    </CanvasBoundary>
  );
}
