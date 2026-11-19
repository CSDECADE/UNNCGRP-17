import { useEffect, useMemo } from "react";
import { DoubleSide } from "three";
import type { ObjMesh, ObjResource } from "../../core/types";
import { createObjGeometry } from "./geometry";

export function ImportedMesh({ resource, mesh, color }: { resource: ObjResource; mesh: ObjMesh; color: string }) {
  const geometry = useMemo(() => createObjGeometry(resource, mesh), [resource, mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} castShadow receiveShadow>
    <meshStandardMaterial color={color} roughness={0.8} side={DoubleSide} />
  </mesh>;
}
