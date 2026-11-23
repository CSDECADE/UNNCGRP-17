import type { SparseCloud } from "../core/capture/sparseCloud";

/** Display the already aligned point cloud without participating in scene picking. */
export function SparsePoints({ cloud }: { cloud: SparseCloud }) {
  return (
    <points userData={{ editorOverlay: true }} raycast={() => {}}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[cloud.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[cloud.colors, 3]} />
      </bufferGeometry>
      <pointsMaterial vertexColors size={2.5} sizeAttenuation={false} toneMapped={false} />
    </points>
  );
}
