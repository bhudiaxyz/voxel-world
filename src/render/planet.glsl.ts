import * as THREE from 'three';

export const PLANET_RADIUS_DEFAULT = 350.0;

/**
 * Paste into the top of any vertex shader that needs curvature.
 * uPlayerXZ is updated every frame to the player's (x, z) position.
 */
export const PLANET_UNIFORMS_GLSL = /* glsl */ `
  uniform float uPlanetRadius;
  uniform vec2  uPlayerXZ;
`;

/**
 * Call AFTER transforming position to world space, BEFORE multiplying by
 * viewMatrix. Drops worldPos.y by r²/(2R), simulating a sphere of radius R.
 * Corrects the normal so lighting stays consistent on curved surfaces.
 */
export const PLANET_BEND_GLSL = /* glsl */ `
  void applyPlanetBend(inout vec3 worldPos, inout vec3 worldNormal) {
    vec2  d2   = worldPos.xz - uPlayerXZ;
    float r2   = dot(d2, d2);
    float drop = r2 / (2.0 * uPlanetRadius);
    worldPos.y -= drop;
    // Rotate normal by the same angle: atan(r / R) ≈ r/R for small angles
    float r    = sqrt(r2);
    float ang  = r / uPlanetRadius;
    if (r > 0.001) {
      vec2  axis = d2 / r;           // unit vector pointing away from player
      // tilt normal toward player centre to compensate for the surface drop
      worldNormal.xz -= axis * ang * worldNormal.y;
      worldNormal = normalize(worldNormal);
    }
  }
`;

/**
 * Returns Three.ts uniform objects ready to spread into a ShaderMaterial.
 * Call once; update .value each frame (see updatePlanetUniforms).
 */
export function planetUniformValues(playerPos: THREE.Vector3): {
  uPlanetRadius: { value: number };
  uPlayerXZ: { value: THREE.Vector2 };
} {
  return {
    uPlanetRadius: { value: PLANET_RADIUS_DEFAULT },
    uPlayerXZ: { value: new THREE.Vector2(playerPos.x, playerPos.z) },
  };
}

/**
 * Call each frame after the player moves.
 * unis = the object returned by planetUniformValues (or the material.uniforms).
 */
export function updatePlanetUniforms(
  unis: { uPlanetRadius: { value: number }; uPlayerXZ: { value: THREE.Vector2 } },
  playerPos: THREE.Vector3,
  radius?: number,
): void {
  unis.uPlayerXZ.value.set(playerPos.x, playerPos.z);
  if (radius !== undefined) unis.uPlanetRadius.value = radius;
}
