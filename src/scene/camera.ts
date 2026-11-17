import * as THREE from 'three';

/**
 * Seated over the desk, looking steeply down: the desk fills the lower screen, the monitor and the
 * rainy window fill the top. On a portrait phone the vertical field of view widens just enough to
 * keep about 40 degrees horizontally, so the desk never feels like a keyhole.
 */
export const CAMERA_HOME = {
  position: new THREE.Vector3(0, 1.4, 0.3),
  target: new THREE.Vector3(0, 0.9, -0.42),
  minHorizontalFov: 40,
  maxVerticalFov: 76,
};

export function frameCamera(camera: THREE.PerspectiveCamera): void {
  const hHalf = THREE.MathUtils.degToRad(CAMERA_HOME.minHorizontalFov / 2);
  const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hHalf) / camera.aspect));
  camera.fov = THREE.MathUtils.clamp(vfov, 50, CAMERA_HOME.maxVerticalFov);
  camera.position.copy(CAMERA_HOME.position);
  camera.lookAt(CAMERA_HOME.target);
  camera.updateProjectionMatrix();
}
