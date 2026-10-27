import * as THREE from 'three';
import { createRenderer } from './render/renderer';
import { setVoxelPalette, WATER, SKY, LIGHT, GRADE, VOXEL_PALETTES } from './core/palette';
import { Atmosphere } from './render/lighting';
import { FPCamera } from './render/fp-camera';
import { createPostFX } from './render/postfx';
import { buildWorld } from './world/world';
import { createWater, makeDepthMap, DEPTH_RANGE } from './world/water';
import { createParticles } from './fx/particles';
import { createCharacter } from './player/character';
import { setVoxelWaterline } from './core/voxel';
import { updatePlanetUniforms } from './render/planet.glsl';
import { DayNight } from './render/day-night';
import { Controller, Input } from './player/controller';
import { createPathNavigator } from './player/pathfinding';
import { createDog } from './player/dog';
import { createBubbles } from './ui/bubbles';
import { createMap } from './ui/map';
import { createPause } from './ui/pause';
import { createSettings, DEFAULTS as SETTINGS_DEFAULTS } from './ui/settings';
import { createHud } from './ui/hud';
import { makeRng, genSeedWord, hashSeedWord } from './core/rng';
import { createDroneMode } from './player/drone';
import { createFlyMode } from './player/fly';
import { detectGpuTier, TIER_SETTINGS } from './render/gpu-tier';
import { createTouchControls, isTouchDevice } from './ui/touch-controls';

export let currentSeedWord = 'LusaliBenoruLezagi';
const urlWord = new URLSearchParams(location.search).get('seed');
if (urlWord) currentSeedWord = urlWord;
const SEED = hashSeedWord(currentSeedWord);
export function pushSeedUrl(word: string) {
  const p = new URLSearchParams(location.search);
  p.set('seed', word);
  history.replaceState(null, '', '?' + p.toString());
}
pushSeedUrl(currentSeedWord);

// Scratch vectors — reused every frame to avoid GC pressure.
const _sunWorld = new THREE.Vector3();
const _sunNDC = new THREE.Vector3();
let _lastPlanetX = Infinity,
  _lastPlanetZ = Infinity;

const container = document.getElementById('app')!;
const bootEl = document.getElementById('boot')!;
const barEl = bootEl.querySelector('.ls-bar span')!;
const subEl = bootEl.querySelector('.ls-sub')!;
const ctrlEl = bootEl.querySelector('.ls-controls') as HTMLElement;

const setProgress = (p: number, s?: string): void => {
  (barEl as HTMLElement).style.width = `${Math.round(p * 100)}%`;
  if (s && p < 1) ctrlEl.textContent = s;
  if (p >= 1) ctrlEl.textContent = '';
};

async function start(): Promise<void> {
  const tier = detectGpuTier();
  const renderer = createRenderer(container, tier);
  const scene = new THREE.Scene();

  const ts = TIER_SETTINGS[tier];
  const world = await buildWorld(SEED, setProgress, ts.streamRadius);
  scene.add(world.group);

  const fpCam = new FPCamera(container.clientWidth / container.clientHeight, renderer.domElement, ts.cameraFar);
  const atmo = new Atmosphere(scene, world.size, tier);
  const dayNight = new DayNight(atmo, renderer);

  const waterDepth = makeDepthMap(world);
  const water = createWater(world.size, waterDepth, tier, ts.waterSubdivision);
  scene.add(water.mesh);
  setVoxelWaterline(world.meshes.material, waterDepth, world.size, DEPTH_RANGE);
  dayNight.voxelUniforms = world.meshes.material.userData.uniforms;
  // Seed _windBase from localStorage if available, otherwise from DEFAULTS.
  {
    let storedWind = SETTINGS_DEFAULTS.windStrength;
    try {
      const raw = localStorage.getItem('VoxelWorld.settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        const n = Number(parsed.windStrength);
        if (Number.isFinite(n)) storedWind = n;
      }
    } catch { /* ignore */ }
    world.meshes.material.userData.uniforms._windBase = storedWind;
  }

  const particles = createParticles(world.size, makeRng(SEED ^ 0x1234), ts.particleCount);
  scene.add(particles.group);

  // Register water + particle planet uniforms so they all bend together.
  world.allPlanetUnis.push(water.planetUnis);
  for (const pUnis of particles.planetUnisList) world.allPlanetUnis.push(pUnis);

  const character = createCharacter(world.meshes.edgeMaterial);
  scene.add(character.root);

  // Hide character from first-person view
  character.root.traverse((o: THREE.Object3D) => {
    if ((o as THREE.Mesh).isMesh) o.layers.set(1);
  });
  fpCam.camera.layers.disable(1);

  const controller = new Controller(world.grid, world.spawn);
  const drone = createDroneMode(world.grid);
  const fly = createFlyMode(world.grid);
  const input = new Input(renderer.domElement);
  const canAct = () => fpCam.isLocked || fpCam.touchActive;
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // L: land — allowed even without pointer lock so Escape-then-L still lands.
    if (e.code === 'KeyL' && !e.repeat && drone.active) {
      drone.beginLanding();
      return;
    }
    if (!canAct()) return;
    // F: toggle fly mode
    if (e.code === 'KeyF' && !e.repeat && !drone.active) {
      if (fly.active) {
        fly.exit();
        fpCam.flyActive = false;
        fpCam.yaw = fpCam.camera.rotation.y;
        fpCam.pitch = 0;
        // Sync controller to the camera's ground position so walk resumes here.
        controller.pos.x = fpCam.camera.position.x;
        controller.pos.z = fpCam.camera.position.z;
        controller.pos.y = world.grid.surfaceY(controller.pos.x, controller.pos.z);
        controller.vel.set(0, 0, 0);
      } else {
        fly.enter(fpCam.camera);
        fpCam.flyActive = true;
      }
    }
    // G: enter drone (works from fly mode too — skip rise, hold current altitude)
    if (e.code === 'KeyG' && !e.repeat && !drone.active) {
      const fromFly = fly.active;
      if (fromFly) { fly.exit(); fpCam.flyActive = false; }
      drone.enter(fpCam.camera, fromFly);
      fpCam.droneActive = true;
    }
    if (e.code === 'KeyE' && !e.repeat) {
      const g = post.grade.uniforms;
      const on = g['uEdgeDarkOpacity'].value === 0;
      g['uEdgeDarkOpacity'].value = on ? 0.64 : 0;
      g['uEdgeLightOpacity'].value = on ? 0.3 : 0;
    }
    // [ / ] — step time of day back/forward by 3 hours for transition testing
    if (e.code === 'BracketLeft'  && !e.repeat) dayNight.timeOfDay = (dayNight.timeOfDay - 0.125 + 1) % 1;
    if (e.code === 'BracketRight' && !e.repeat) dayNight.timeOfDay = (dayNight.timeOfDay + 0.125) % 1;
  });

  const navigator = createPathNavigator({
    world,
    controller,
    camera: fpCam.camera,
    dom: renderer.domElement,
    input,
  });
  const map = createMap({ world, controller, input, fpCam });
  const bubbles = createBubbles({
    camera: fpCam.camera,
    container,
    viewport: renderer.domElement as any,
  });

  const dog = createDog({
    world,
    surface: navigator.surface,
    player: controller,
    input: input as any,
    edgeMaterial: world.meshes.edgeMaterial,
    rng: makeRng(SEED ^ 0xd06),
    onCommand: ((name: string) => bubbles.say(character.root, name, { height: 3.35 })) as any,
  });
  scene.add(dog.root);

  const touch = createTouchControls(fpCam, renderer.domElement);

  const post = createPostFX(renderer, scene, fpCam.camera, world.meshes.edgeMaterial, tier);
  // FPCamera has no zoom range; pass a stub so settings.js compiles cleanly
  const settings = createSettings({
    rig: { setZoomRange: () => {} },
    atmo,
    input,
    world,
    dayNight,
    seed: { currentWord: () => currentSeedWord, push: pushSeedUrl, gen: genSeedWord },
  });
  const hud = createHud({ dayNight, drone, camera: fpCam.camera });
  hud.onSettingsClick(() => { if (!settings.open) settings.toggle(); });
  const pause = createPause({ input, map, onNewWorld: () => { pushSeedUrl(genSeedWord()); location.reload(); } });
  settings.onPaletteChange((name) => {
    setVoxelPalette(name);

    // Water uniforms were cloned at material creation — push updated palette colours.
    const wu = water.planetUnis;
    wu.uShoal.value.copy(WATER.shoal);
    wu.uShallow.value.copy(WATER.shallow);
    wu.uDeep.value.copy(WATER.deep);

    // Sky dome uniforms
    if (atmo.sky?.material?.uniforms) {
      const su = atmo.sky.material.uniforms;
      if (su.uSkyZenith)  su.uSkyZenith.value.copy(SKY.zenith).lerp(SKY.haze, 0.3);
      if (su.uSkyHorizon) su.uSkyHorizon.value.copy(SKY.horizon).lerp(SKY.haze, 0.22);
      if (su.uSkyNadir)   su.uSkyNadir.value.copy(SKY.ground).lerp(SKY.haze, 0.45).multiplyScalar(0.94);
      if (su.uSunGlow)    su.uSunGlow.value.copy(SKY.sunTint).multiplyScalar(0.16);
    }

    // Fog / haze (hazeColor drives scene fog)
    if (atmo.hazeColor) {
      atmo.hazeColor.copy(SKY.haze).lerp(SKY.horizon, 0.35);
      if (atmo.scene?.fog?.color) atmo.scene.fog.color.copy(atmo.hazeColor);
    }

    // Day-night noon keyframes — these override sky uniforms every frame, so
    // they must be updated or the palette change has no lasting sky effect.
    const pd = VOXEL_PALETTES[name];
    if (pd) dayNight.applyNoonSky(pd.sky, pd.light.sunColor);

    // Hemisphere light colours (intensity is driven by DayNight; colours are static)
    if (atmo.hemi) {
      atmo.hemi.color.copy(LIGHT.skyColor);
      atmo.hemi.groundColor.copy(LIGHT.groundColor);
    }

    // Water sky-reflection uniforms (cloned at creation, not live)
    const wmu = (water.material as any)?.uniforms;
    if (wmu) {
      wmu.uHorizon?.value.copy(SKY.horizon);
      wmu.uSky?.value.copy(SKY.zenith);
    }

    // Petal particle colours (baked into vertex buffer at creation)
    particles.recolorPetals();

    // Post-processing grade
    if (post.grade?.uniforms) {
      const gu = post.grade.uniforms;
      if (gu.uLift)     gu.uLift.value.copy(GRADE.lift);
      if (gu.uGamma)    gu.uGamma.value.copy(GRADE.gamma);
      if (gu.uGain)     gu.uGain.value.copy(GRADE.gain);
      if (gu.uSat)      gu.uSat.value     = GRADE.saturation;
      if (gu.uContrast) gu.uContrast.value = GRADE.contrast;
      if (gu.uVignette) gu.uVignette.value = GRADE.vignette;
      if (gu.toneMappingExposure) gu.toneMappingExposure.value = GRADE.exposure;
    }
    if (post.bloom) {
      post.bloom.strength  = GRADE.bloom.strength;
      post.bloom.radius    = GRADE.bloom.radius;
      post.bloom.threshold = GRADE.bloom.threshold;
    }

    world.streaming.invalidateAll();
    map.invalidateTerrain();
  });

  touch.onFly(() => {
    if (fly.active) {
      fly.exit();
      fpCam.flyActive = false;
      fpCam.yaw = fpCam.camera.rotation.y;
      fpCam.pitch = 0;
      controller.pos.x = fpCam.camera.position.x;
      controller.pos.z = fpCam.camera.position.z;
      controller.pos.y = world.grid.surfaceY(controller.pos.x, controller.pos.z);
      controller.vel.set(0, 0, 0);
    } else if (!drone.active) {
      fly.enter(fpCam.camera);
      fpCam.flyActive = true;
    }
  });
  touch.onDrone(() => {
    if (!drone.active) {
      const fromFly = fly.active;
      if (fromFly) { fly.exit(); fpCam.flyActive = false; }
      drone.enter(fpCam.camera, fromFly);
      fpCam.droneActive = true;
    }
  });
  touch.onLand(() => {
    if (drone.active) drone.beginLanding();
  });
  touch.onEdgeToggle(() => {
    const g = post.grade.uniforms;
    const on = g['uEdgeDarkOpacity'].value === 0;
    g['uEdgeDarkOpacity'].value = on ? 0.64 : 0;
    g['uEdgeLightOpacity'].value = on ? 0.3 : 0;
  });
  touch.onTimeBack(    () => { dayNight.timeOfDay = (dayNight.timeOfDay - 0.125 + 1) % 1; });
  touch.onTimeForward( () => { dayNight.timeOfDay = (dayNight.timeOfDay + 0.125) % 1; });
  touch.onMap(() => map.toggle());

  // frame the spawn before the veil lifts
  fpCam.update(1 / 60, controller.pos, 0, true);
  world.streaming.update(controller.pos, fpCam.camera.position);
  atmo.followTarget(controller.pos.x, controller.pos.z);

  scene.updateMatrixWorld(true);
  scene.matrixWorldAutoUpdate = false;

  addEventListener('resize', () => {
    const w = container.clientWidth,
      h = container.clientHeight;
    (renderer as any).resizeTo(w, h);
    fpCam.resize(w / h);
    post.setSize(w, h);
    bubbles.resize();
  });

  const clock = new THREE.Timer();
  let started = false;
  let perfTime = 0;
  let perfFrames = 0;

  // Wrap-flash: spike aberration + vignette when the camera teleports across a
  // world edge, then decay back to normal over ~0.35 s.
  let wrapFlash = 0; // 0..1, decays to 0
  let prevCamX = 0, prevCamZ = 0;

  // Wind state — slowly varying direction + gust envelope
  let windTime = 0.0;
  const windDir = new THREE.Vector2(1.0, 0.3).normalize();
  let windAngle = Math.atan2(windDir.y, windDir.x);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__fps = 0;

  function frame(): void {
    requestAnimationFrame(frame);
    clock.update();
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 1 / 20);

    if (rawDt < 0.5) {
      perfTime += rawDt;
      perfFrames++;
      if (perfTime >= 0.75) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__fps = Math.round(perfFrames / perfTime);
        perfTime = 0;
        perfFrames = 0;
      }
    }

    const wish = fpCam.getWish();
    const jumpEdge = fpCam.getJumpEdge();
    const jumpHeld = fpCam.getJumpHeld();

    const manualMovement = wish.lengthSq() > 1e-4 || jumpEdge;
    navigator.update(dt, wish, manualMovement, input.paused);

    const STEP = 1 / 60;
    let remaining = dt;
    let jumped = false,
      landed = 0,
      stepped = 0;
    while (remaining > 1e-5) {
      const h = Math.min(remaining, STEP);
      const e = controller.update(h, wish, jumpEdge && remaining === dt, jumpHeld);
      if (e.jumped) jumped = true;
      if (e.landed > landed) landed = e.landed;
      if (e.stepped && e.stepRise > stepped) stepped = e.stepRise;
      remaining -= h;
    }
    if (jumped) character.jump();
    if (stepped > 0) character.step(stepped);
    if (landed > 0) character.land(landed);

    character.root.position.set(controller.pos.x, controller.visualY, controller.pos.z);
    character.update(dt, {
      speed01: controller.speed01,
      grounded: controller.grounded,
      vy: controller.vel.y,
      heading: controller.heading,
      groundY: controller.groundY,
      swimming: controller.swimming,
    });
    character.root.updateMatrixWorld(true);
    dog.update(dt);

    if (fly.active) {
      fly.update(dt, fpCam.camera, fpCam._keys, fpCam.yaw, fpCam.pitch, fpCam.drainDroneAltDelta(dt), fpCam._joyX, fpCam._joyY);
    } else if (drone.active) {
      const done = drone.update(
        dt,
        fpCam.camera,
        fpCam._keys,
        fpCam.drainDroneMX(),
        fpCam.drainDroneAltDelta(dt),
        fpCam._joyX,
        fpCam._joyY,
      );
      if (done) {
        controller.pos.x = fpCam.camera.position.x;
        controller.pos.z = fpCam.camera.position.z;
        controller.pos.y = world.grid.surfaceY(controller.pos.x, controller.pos.z);
        fpCam.droneActive = false;
        fpCam.yaw = fpCam.camera.rotation.y;
        fpCam.pitch = 0;
      }
    } else {
      fpCam.update(dt, controller.pos, controller.speed01, controller.grounded);
    }
    world.streaming.update(controller.pos, fpCam.camera.position, false, dt);
    // Only update fog origin when the player is actually moving — saves a
    // uniform write + fog-origin recalculation on every idle frame.
    if (manualMovement || fly.active || drone.active)
      atmo.followTarget(controller.pos.x, controller.pos.z);
    dayNight.update(dt);

    // Wind: slowly rotate direction + gust envelope, push to voxel shader.
    // Skipped on very-low (no particles, sparse trees) and when strength is 0.
    if (tier !== 'very-low') {
      const wu = world.meshes.material.userData.uniforms;
      if (wu._windBase > 0) {
        windTime += dt;
        windAngle += dt * 0.04 * (Math.sin(windTime * 0.11) * 0.5 + 0.5);
        windDir.set(Math.cos(windAngle), Math.sin(windAngle));
        const gust = 0.5 + Math.sin(windTime * 0.7) * 0.3 + Math.sin(windTime * 1.3) * 0.2;
        wu.uWindTime.value     = windTime;
        wu.uWindDir.value.copy(windDir);
        wu.uWindStrength.value = wu._windBase * gust;
      }
    }

    // Project sun to screen for crepuscular rays — active only near horizon.
    {
      const sunDir = dayNight.sunDir; // read-only reference, no allocation
      _sunWorld.copy(sunDir).multiplyScalar(500).add(fpCam.camera.position);
      _sunNDC.copy(_sunWorld).project(fpCam.camera);
      const sunVisible =
        sunDir.y > -0.1 && Math.abs(_sunNDC.x) < 1.2 && Math.abs(_sunNDC.y) < 1.2
          ? Math.pow(Math.max(0, 0.25 - sunDir.y) / 0.35, 1.5)
          : 0;
      post.setSunScreenPos(_sunNDC.x * 0.5 + 0.5, -_sunNDC.y * 0.5 + 0.5, sunVisible);
    }
    atmo.update(dt, fpCam.camera);
    water.update(dt);
    particles.update(dt, fpCam.camera);
    for (const d of world.animated) d.update(dt, fpCam.camera);
    bubbles.update(dt);
    touch.update(drone.active, drone.landing, fly.active);
    map.update();
    hud.update();
    settings.update();

    // Update planet-bend uniforms only when the player has moved (saves an
    // iteration over all materials every frame while standing still or hovering).
    const bendOrigin = fpCam.droneActive || fpCam.flyActive ? fpCam.camera.position : controller.pos;
    if (Math.abs(bendOrigin.x - _lastPlanetX) + Math.abs(bendOrigin.z - _lastPlanetZ) > 0.1) {
      _lastPlanetX = bendOrigin.x;
      _lastPlanetZ = bendOrigin.z;
      for (const unis of world.allPlanetUnis) updatePlanetUniforms(unis, bendOrigin);
    }

    // Detect world-edge wrap (camera teleports > 50 units in one frame) and
    // spike chromatic aberration + vignette for a brief warp-flash effect.
    const camX = fpCam.camera.position.x, camZ = fpCam.camera.position.z;
    if (Math.abs(camX - prevCamX) > 50 || Math.abs(camZ - prevCamZ) > 50) wrapFlash = 1;
    prevCamX = camX; prevCamZ = camZ;
    wrapFlash = Math.max(0, wrapFlash - dt * 3);
    if (wrapFlash > 0 && post.grade?.uniforms) {
      const gu = post.grade.uniforms;
      if (gu.uAberration) gu.uAberration.value = 0.0008 + wrapFlash * 0.025;
      if (gu.uVignette)   gu.uVignette.value   = GRADE.vignette + wrapFlash * 1.2;
    }

    post.render(dt);

    if (!started) {
      started = true;
      ctrlEl.textContent = isTouchDevice
        ? 'Left stick · move   Swipe right · look   ↑ · jump/ascend   ↓ · descend   ⚡ · sprint   ✈ · fly   🚁 · drone   🛬 · land'
        : 'WASD · move   Mouse · look   Space · jump   F · fly   G · drone   L · land   E · edges   M · map';
      bootEl.classList.add('ready');
      bootEl.addEventListener(
        'click',
        () => {
          hud.showSettingsBtn();
          bootEl.classList.add('dismissed');
          bootEl.addEventListener('transitionend', () => bootEl.classList.add('gone'), {
            once: true,
          });
          // Boot overlay sits above the canvas, so the click never reaches it —
          // request pointer lock here so the player can act immediately.
          renderer.domElement.requestPointerLock();
        },
        { once: true },
      );
    }
  }

  frame();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__game = {
    scene,
    renderer,
    fpCam,
    world,
    controller,
    character,
    post,
    atmo,
    water,
    particles,
    navigator,
    map,
    pause,
    settings,
    hud,
    input,
    dog,
    bubbles,
    tier,
    dayNight,
  };
}

start().catch((err: unknown) => {
  console.error(err);
  (subEl as HTMLElement).textContent = 'Unable to start';
  (subEl as HTMLElement).classList.add('error');
});
