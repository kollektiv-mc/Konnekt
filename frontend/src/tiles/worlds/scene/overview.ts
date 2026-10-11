import * as THREE from 'three'

// The galaxy overview's camera pose. SceneController flies back to it, and
// Galaxy's zoom-to-fit measures the visible extent from it rather than from the
// live camera, which mid-flight is still close to the planet it just left.
// Shared instances: copy from them, never mutate them.
export const OVERVIEW_EYE = new THREE.Vector3(0, 14, 5)
export const OVERVIEW_TARGET = new THREE.Vector3(0, 0, 0)
