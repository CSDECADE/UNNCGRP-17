import { memo, useEffect, useMemo } from "react";
import { DoubleSide } from "three";
import type { ObjMesh, ObjResource } from "../../core/types";
import { createObjGeometry } from "./geometry";
import { meshGeometryUnchanged } from "../../core/mesh-edit";

export const ImportedMesh = memo(function ImportedMesh({ resource, mesh, color }: { resource: ObjResource; mesh: ObjMesh; color: string }) {
  const geometry = useMemo(() => createObjGeometry(resource, mesh), [resource, mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} userData={{ objMeshId: mesh.id }} castShadow receiveShadow>
    <meshStandardMaterial color={color} roughness={0.8} side={DoubleSide} />
  </mesh>;
}, (before, after) => before.color === after.color && before.mesh === after.mesh &&
  meshGeometryUnchanged(before.resource, after.resource, before.mesh));
