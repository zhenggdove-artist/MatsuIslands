import * as THREE from "three";

const STORAGE_KEY = "matsu-islands.world.v1";
const MAX_STRUCTURES = 40;
const PLAYER_RADIUS = 0.38;
const UP = new THREE.Vector3(0, 1, 0);
const SUPPORTS_DESKTOP_POINTER = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? true;

const ui = {
  canvas: document.querySelector("#game-canvas"),
  startScreen: document.querySelector("#start-screen"),
  startButton: document.querySelector("#start-button"),
  buildPanel: document.querySelector("#build-panel"),
  closeBuild: document.querySelector("#close-build"),
  modeLabel: document.querySelector("#mode-label"),
  signalCount: document.querySelector("#signal-count"),
  signalProgress: document.querySelector("#signal-progress"),
  interactionPrompt: document.querySelector("#interaction-prompt"),
  buildPosition: document.querySelector("#build-position"),
  toast: document.querySelector("#toast"),
  placeObject: document.querySelector("#place-object"),
  rotateObject: document.querySelector("#rotate-object"),
  removeObject: document.querySelector("#remove-object"),
  saveWorld: document.querySelector("#save-world"),
  exportWorld: document.querySelector("#export-world"),
  resetWorld: document.querySelector("#reset-world"),
  toolButtons: [...document.querySelectorAll("[data-build-type]")],
  movePad: document.querySelector("#move-pad"),
  moveKnob: document.querySelector("#move-knob"),
  mobileJump: document.querySelector("#mobile-jump"),
  mobileInteract: document.querySelector("#mobile-interact"),
  mobileBuild: document.querySelector("#mobile-build"),
};

const state = {
  started: false,
  buildMode: false,
  buildType: "wall",
  buildRotation: 0,
  structures: [],
  activeSignals: new Set(),
  nearbySignal: null,
  elapsed: 0,
  toastTimer: 0,
  player: {
    velocityY: 0,
    grounded: true,
    moving: false,
    running: false,
  },
};

const keys = new Set();
const colliders = [];
const structureMeshes = new Map();
const signals = [];
const tempVec = new THREE.Vector3();
const tempVec2 = new THREE.Vector3();
const tempColor = new THREE.Color();

let cameraYaw = 0;
let cameraPitch = 0.3;
let cameraDistance = 7.4;
let playerYaw = 0;
let previewObject = null;
let previewValid = true;
let lighthouseBeam = null;
let toastTimeout = null;
let mobileMove = { x: 0, y: 0 };
let touchLookId = null;
let lastTouchLook = null;
let externallySteppedUntil = 0;

const renderer = new THREE.WebGLRenderer({
  canvas: ui.canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x78918d);
scene.fog = new THREE.FogExp2(0x78918d, 0.0135);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
const worldGroup = new THREE.Group();
const buildGroup = new THREE.Group();
const atmosphereGroup = new THREE.Group();
scene.add(worldGroup, buildGroup, atmosphereGroup);

const hemiLight = new THREE.HemisphereLight(0xc7ddd6, 0x334035, 2.25);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xfff2cf, 3.15);
sun.position.set(-24, 34, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.left = -48;
sun.shadow.camera.right = 48;
sun.shadow.camera.top = 48;
sun.shadow.camera.bottom = -48;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0007;
scene.add(sun);

const fillLight = new THREE.DirectionalLight(0x8ab6b4, 0.8);
fillLight.position.set(22, 12, -26);
scene.add(fillLight);

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dampAngle(current, target, speed, dt) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-speed * dt));
}

function islandRadiusAt(angle) {
  const ellipseRadius = 1 / Math.sqrt(
    (Math.cos(angle) ** 2) / (31 ** 2) +
    (Math.sin(angle) ** 2) / (25 ** 2)
  );
  return ellipseRadius * (
    1 +
    Math.sin(angle * 3 + 0.7) * 0.055 +
    Math.sin(angle * 7 - 1.1) * 0.035 +
    Math.cos(angle * 11 + 0.2) * 0.018
  );
}

function islandRatioAt(x, z) {
  const angle = Math.atan2(z, x);
  return Math.hypot(x, z) / islandRadiusAt(angle);
}

function groundHeightAt(x, z) {
  const ratio = islandRatioAt(x, z);
  if (ratio > 1.02) return -1.5;
  const rolling =
    Math.sin(x * 0.21 + 0.8) * 0.42 +
    Math.cos(z * 0.25 - 0.4) * 0.34 +
    Math.sin((x + z) * 0.13) * 0.28;
  const inlandRise = Math.max(0, 1 - ratio) * 2.15;
  return 0.28 + inlandRise + rolling * (0.3 + 0.7 * Math.max(0, 1 - ratio));
}

function makeTexture(base, fleck, seed = 1) {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 128;
  textureCanvas.height = 128;
  const context = textureCanvas.getContext("2d");
  const random = mulberry32(seed);
  context.fillStyle = base;
  context.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i += 1) {
    context.globalAlpha = 0.05 + random() * 0.16;
    context.fillStyle = fleck;
    const size = 0.4 + random() * 2.4;
    context.fillRect(random() * 128, random() * 128, size, size);
  }
  context.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 8);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const grassTexture = makeTexture("#687555", "#b4bd83", 17);
const stoneTexture = makeTexture("#6e7168", "#c0bda8", 29);
const woodTexture = makeTexture("#785f42", "#d1ae73", 43);

function createIsland() {
  const segments = 72;
  const rings = 24;
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];

  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const edge = islandRadiusAt(angle);
      const x = Math.cos(angle) * edge * t;
      const z = Math.sin(angle) * edge * t;
      const y = groundHeightAt(x, z);
      positions.push(x, y, z);
      const highland = clamp((y - 0.3) / 2.3, 0, 1);
      tempColor.set(0x647052).lerp(new THREE.Color(0x889169), highland * 0.65);
      colors.push(tempColor.r, tempColor.g, tempColor.b);
      uvs.push(x / 18, z / 18);
    }
  }

  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = ring * segments + segment;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + segment;
      const d = (ring + 1) * segments + next;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    map: grassTexture,
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });
  const island = new THREE.Mesh(geometry, material);
  island.receiveShadow = true;
  worldGroup.add(island);

  const cliffPositions = [];
  const cliffIndices = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const angle = (segment / segments) * Math.PI * 2;
    const edge = islandRadiusAt(angle);
    const x = Math.cos(angle) * edge;
    const z = Math.sin(angle) * edge;
    const y = groundHeightAt(x, z);
    cliffPositions.push(x, y + 0.05, z, x * 0.985, -2.15, z * 0.985);
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    const top = segment * 2;
    const bottom = top + 1;
    const nextTop = next * 2;
    const nextBottom = nextTop + 1;
    cliffIndices.push(top, bottom, nextTop, nextTop, bottom, nextBottom);
  }
  const cliffGeometry = new THREE.BufferGeometry();
  cliffGeometry.setAttribute("position", new THREE.Float32BufferAttribute(cliffPositions, 3));
  cliffGeometry.setIndex(cliffIndices);
  cliffGeometry.computeVertexNormals();
  const cliffs = new THREE.Mesh(
    cliffGeometry,
    new THREE.MeshStandardMaterial({ color: 0x4a5149, roughness: 1, flatShading: true })
  );
  cliffs.castShadow = true;
  cliffs.receiveShadow = true;
  worldGroup.add(cliffs);
}

function createWater() {
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(190, 128),
    new THREE.MeshPhysicalMaterial({
      color: 0x315f63,
      roughness: 0.26,
      metalness: 0.12,
      transparent: true,
      opacity: 0.92,
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.8;
  water.receiveShadow = true;
  water.userData.water = true;
  worldGroup.add(water);

  const horizon = new THREE.Mesh(
    new THREE.CylinderGeometry(192, 192, 0.4, 128, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x6e8985, side: THREE.BackSide })
  );
  horizon.position.y = -0.95;
  worldGroup.add(horizon);
}

function addCollider(id, x, z, width, depth, rotation = 0, source = "world") {
  const quarterTurn = Math.round(rotation / (Math.PI / 2)) % 2 !== 0;
  colliders.push({
    id,
    x,
    z,
    halfX: (quarterTurn ? depth : width) / 2,
    halfZ: (quarterTurn ? width : depth) / 2,
    source,
  });
}

function removeCollider(id) {
  for (let i = colliders.length - 1; i >= 0; i -= 1) {
    if (colliders[i].id === id) colliders.splice(i, 1);
  }
}

function groundY(x, z, offset = 0) {
  return groundHeightAt(x, z) + offset;
}

function createStoneHouse(x, z, rotation, width = 5.2, depth = 3.8) {
  const group = new THREE.Group();
  group.position.set(x, groundY(x, z), z);
  group.rotation.y = rotation;

  const wallMaterial = new THREE.MeshStandardMaterial({ map: stoneTexture, color: 0xa6a79a, roughness: 0.94 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x3f4640, roughness: 0.88 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x17211f, roughness: 1 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(width, 2.8, depth), wallMaterial);
  body.position.y = 1.4;
  body.castShadow = body.receiveShadow = true;
  group.add(body);

  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0, width * 0.74, 2.15, 4), roofMaterial);
  roof.position.y = 3.28;
  roof.rotation.y = Math.PI / 4;
  roof.scale.z = depth / width;
  roof.castShadow = true;
  group.add(roof);

  const door = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.85, 0.12), darkMaterial);
  door.position.set(0, 0.93, depth / 2 + 0.065);
  group.add(door);

  const windowMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a660, emissive: 0xc68037, emissiveIntensity: 0.45 });
  for (const side of [-1, 1]) {
    const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.7, 0.12), windowMaterial);
    windowMesh.position.set(side * 1.55, 1.55, depth / 2 + 0.07);
    group.add(windowMesh);
  }

  const id = `house-${x}-${z}`;
  addCollider(id, x, z, width, depth, rotation);
  worldGroup.add(group);
}

function createBunker(x, z, rotation = 0) {
  const group = new THREE.Group();
  group.position.set(x, groundY(x, z), z);
  group.rotation.y = rotation;
  const concrete = new THREE.MeshStandardMaterial({ color: 0x687068, roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x101a18, roughness: 1 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(5.8, 2.2, 4.5), concrete);
  body.position.y = 1.05;
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  const crown = new THREE.Mesh(new THREE.BoxGeometry(6.35, 0.5, 5), concrete);
  crown.position.y = 2.22;
  crown.castShadow = crown.receiveShadow = true;
  group.add(crown);
  const slit = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.36, 0.12), dark);
  slit.position.set(0, 1.25, 2.31);
  group.add(slit);
  addCollider(`bunker-${x}-${z}`, x, z, 5.8, 4.5, rotation);
  worldGroup.add(group);
}

function createLighthouse(x, z) {
  const group = new THREE.Group();
  group.position.set(x, groundY(x, z), z);
  const white = new THREE.MeshStandardMaterial({ color: 0xe2dfcf, roughness: 0.72 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb9503d, roughness: 0.72 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xffd58b,
    emissive: 0xff9e3d,
    emissiveIntensity: 0.7,
    transparent: true,
    opacity: 0.84,
  });

  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.48, 7.8, 16), white);
  tower.position.y = 3.9;
  tower.castShadow = tower.receiveShadow = true;
  group.add(tower);
  for (const y of [2.1, 5.1]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.3 - y * 0.035, 1.38 - y * 0.035, 0.7, 16), red);
    band.position.y = y;
    band.castShadow = true;
    group.add(band);
  }
  const lanternRoom = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.2, 12), glass);
  lanternRoom.position.y = 8.15;
  group.add(lanternRoom);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.25, 12), red);
  roof.position.y = 9.38;
  roof.castShadow = true;
  group.add(roof);

  lighthouseBeam = new THREE.Group();
  lighthouseBeam.position.y = 8.2;
  lighthouseBeam.visible = false;
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd38b,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(5.6, 28, 24, 1, true), beamMaterial);
  beam.rotation.z = -Math.PI / 2;
  beam.position.x = 14;
  lighthouseBeam.add(beam);
  group.add(lighthouseBeam);

  addCollider("lighthouse", x, z, 2.8, 2.8, 0);
  worldGroup.add(group);
}

function createShrub(x, z, scale, tone) {
  const group = new THREE.Group();
  group.position.set(x, groundY(x, z), z);
  const material = new THREE.MeshStandardMaterial({ color: tone, roughness: 1, flatShading: true });
  for (let i = 0; i < 3; i += 1) {
    const clump = new THREE.Mesh(new THREE.DodecahedronGeometry((0.42 + i * 0.08) * scale, 0), material);
    clump.position.set((i - 1) * 0.38 * scale, 0.34 * scale + (i % 2) * 0.15, (i % 2) * 0.18);
    clump.scale.y = 0.75;
    clump.castShadow = true;
    group.add(clump);
  }
  worldGroup.add(group);
}

function createRock(x, z, scale, tone = 0x59605a) {
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(scale, 0),
    new THREE.MeshStandardMaterial({ color: tone, roughness: 1, flatShading: true })
  );
  rock.position.set(x, groundY(x, z, scale * 0.48), z);
  rock.scale.set(1.35, 0.68, 1);
  rock.rotation.set(0.2, x * 0.13, -0.12);
  rock.castShadow = rock.receiveShadow = true;
  worldGroup.add(rock);
}

function createPath(points) {
  const material = new THREE.MeshStandardMaterial({ color: 0xb3a684, roughness: 1 });
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const length = Math.hypot(dx, dz);
    const centerX = (from[0] + to[0]) / 2;
    const centerZ = (from[1] + to[1]) / 2;
    const path = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.05, length + 0.25), material);
    path.position.set(centerX, groundY(centerX, centerZ, 0.08), centerZ);
    path.rotation.y = Math.atan2(dx, dz);
    path.receiveShadow = true;
    worldGroup.add(path);
  }
}

function createWorldDetails() {
  createPath([[0, 8], [2, 4], [6, 0], [10, -6], [13, -11]]);
  createPath([[1, 5], [-4, 3], [-10, 5], [-15, 6]]);
  createPath([[6, 0], [2, -5], [-3, -10], [-9, -15]]);

  createStoneHouse(-5.5, 1.8, 0.18, 5.4, 3.7);
  createStoneHouse(5.4, -3.4, -0.34, 4.5, 3.4);
  createStoneHouse(1.7, -9.2, 0.1, 4.8, 3.5);
  createBunker(10.8, 3.6, -0.24);
  createLighthouse(-18.2, -10.8);

  const random = mulberry32(731);
  for (let i = 0; i < 68; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * islandRadiusAt(angle) * 0.88;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const protectedArea = Math.hypot(x, z - 5) < 7 || Math.hypot(x + 6, z - 2) < 5;
    if (protectedArea) continue;
    if (i % 4 === 0) createRock(x, z, 0.35 + random() * 0.72);
    else createShrub(x, z, 0.7 + random() * 0.8, random() > 0.45 ? 0x53694d : 0x6f7650);
  }
}

function createSkyParticles() {
  const random = mulberry32(92);
  const positions = [];
  for (let i = 0; i < 210; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 10 + random() * 66;
    positions.push(Math.cos(angle) * radius, 1 + random() * 16, Math.sin(angle) * radius);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0xe8eee4, size: 0.075, transparent: true, opacity: 0.34, depthWrite: false });
  atmosphereGroup.add(new THREE.Points(geometry, material));
}

function createSignal(id, x, z, label) {
  const group = new THREE.Group();
  group.position.set(x, groundY(x, z), z);
  const stone = new THREE.MeshStandardMaterial({ color: 0x77796e, roughness: 0.96 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x303c3a, roughness: 0.48, metalness: 0.7 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x6e766b, emissive: 0x111711, emissiveIntensity: 0.15 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.15, 0.48, 8), stone);
  base.position.y = 0.24;
  base.castShadow = base.receiveShadow = true;
  group.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 3.2, 8), metal);
  pole.position.y = 2.02;
  pole.castShadow = true;
  group.add(pole);
  const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.75, 10, 1, true), metal);
  cage.position.y = 3.45;
  cage.castShadow = true;
  group.add(cage);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), lens);
  lamp.position.y = 3.45;
  group.add(lamp);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.68, 0.025, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xffbc63, transparent: true, opacity: 0 })
  );
  ring.position.y = 3.45;
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const light = new THREE.PointLight(0xffb45d, 0, 8, 2);
  light.position.y = 3.45;
  group.add(light);

  group.userData = { id, label, active: false, lamp, lens, ring, light };
  signals.push(group);
  worldGroup.add(group);
}

function activateSignal(signal) {
  if (!signal || signal.userData.active) return;
  signal.userData.active = true;
  state.activeSignals.add(signal.userData.id);
  signal.userData.lens.color.set(0xffcc75);
  signal.userData.lens.emissive.set(0xff8a26);
  signal.userData.lens.emissiveIntensity = 3.6;
  signal.userData.light.intensity = 8;
  signal.userData.ring.material.opacity = 0.72;
  updateMissionUI();
  saveWorld(false);
  if (state.activeSignals.size === signals.length) {
    if (lighthouseBeam) lighthouseBeam.visible = true;
    showToast("三座信號台已連線——東引燈塔重新回應了。", 4200);
  } else {
    showToast(`${signal.userData.label}已恢復，海霧中的訊號更清楚了。`);
  }
}

function restoreActiveSignals() {
  for (const signal of signals) {
    if (!state.activeSignals.has(signal.userData.id)) continue;
    signal.userData.active = true;
    signal.userData.lens.color.set(0xffcc75);
    signal.userData.lens.emissive.set(0xff8a26);
    signal.userData.lens.emissiveIntensity = 3.6;
    signal.userData.light.intensity = 8;
    signal.userData.ring.material.opacity = 0.72;
  }
  if (state.activeSignals.size === signals.length && lighthouseBeam) lighthouseBeam.visible = true;
  updateMissionUI();
}

function createPlayer() {
  const group = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: 0xd36b37, roughness: 0.82 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x283936, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9aa80, roughness: 0.82 });
  const pack = new THREE.MeshStandardMaterial({ color: 0x4e5b43, roughness: 1 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.62, 5, 10), jacket);
  torso.position.y = 1.18;
  torso.scale.z = 0.78;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 10), skin);
  head.position.y = 1.86;
  head.castShadow = true;
  group.add(head);

  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.31, 0.18, 12), pants);
  hat.position.y = 2.05;
  hat.castShadow = true;
  group.add(hat);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.7, 0.25), pack);
  backpack.position.set(0, 1.22, 0.31);
  backpack.castShadow = true;
  group.add(backpack);

  const limbs = [];
  for (const side of [-1, 1]) {
    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.17, 0.82, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.52, 4, 8), pants);
    leg.position.y = -0.38;
    leg.castShadow = true;
    legPivot.add(leg);
    group.add(legPivot);
    limbs.push(legPivot);

    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.43, 1.48, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.47, 4, 8), jacket);
    arm.position.y = -0.3;
    arm.castShadow = true;
    armPivot.add(arm);
    group.add(armPivot);
    limbs.push(armPivot);
  }

  group.userData.limbs = limbs;
  group.position.set(0, groundY(0, 8, 0.03), 8);
  scene.add(group);
  return group;
}

const player = createPlayer();

function buildSpec(type) {
  return {
    wall: { width: 4, depth: 0.34, height: 1.85 },
    platform: { width: 3.2, depth: 3.2, height: 0.22 },
    pillar: { width: 0.9, depth: 0.9, height: 2.5 },
    lantern: { width: 0.52, depth: 0.52, height: 2.15 },
  }[type] || { width: 1, depth: 1, height: 1 };
}

function setMeshPreview(mesh, invalid = false) {
  mesh.traverse((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.transparent = true;
      material.opacity = 0.52;
      material.depthWrite = false;
      if (material.color) material.color.lerp(new THREE.Color(invalid ? 0xff5c52 : 0xf2c66f), 0.48);
      if ("emissive" in material) {
        material.emissive = new THREE.Color(invalid ? 0x50100c : 0x5c4513);
        material.emissiveIntensity = 0.6;
      }
    }
  });
}

function createBuildObject(data, preview = false) {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ map: stoneTexture, color: 0xaaa897, roughness: 0.95 });
  const timber = new THREE.MeshStandardMaterial({ map: woodTexture, color: 0x9b7851, roughness: 0.88 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x394745, roughness: 0.55, metalness: 0.4 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xffd27b, emissive: 0xff922f, emissiveIntensity: 2.8 });
  const spec = buildSpec(data.type);

  if (data.type === "wall") {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(spec.width, spec.height, spec.depth), stone);
    wall.position.y = spec.height / 2;
    wall.castShadow = wall.receiveShadow = true;
    group.add(wall);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(spec.width + 0.12, 0.12, spec.depth + 0.08), timber);
    cap.position.y = spec.height + 0.02;
    cap.castShadow = true;
    group.add(cap);
  } else if (data.type === "platform") {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(spec.width, spec.height, spec.depth), timber);
    deck.position.y = spec.height / 2;
    deck.castShadow = deck.receiveShadow = true;
    group.add(deck);
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.38, 0.16), metal);
        foot.position.set(x * 1.35, -0.08, z * 1.35);
        group.add(foot);
      }
    }
  } else if (data.type === "pillar") {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, spec.height, 8), stone);
    pillar.position.y = spec.height / 2;
    pillar.castShadow = pillar.receiveShadow = true;
    group.add(pillar);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.18, 0.86), stone);
    top.position.y = spec.height;
    top.castShadow = true;
    group.add(top);
  } else {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 1.75, 8), metal);
    pole.position.y = 0.9;
    pole.castShadow = true;
    group.add(pole);
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), glow);
    lantern.position.y = 1.83;
    group.add(lantern);
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.28, 10), metal);
    hood.position.y = 2.1;
    hood.castShadow = true;
    group.add(hood);
    if (!preview) {
      const point = new THREE.PointLight(0xffb45e, 4.2, 7.5, 2);
      point.position.y = 1.84;
      group.add(point);
    }
  }

  group.position.set(data.x, groundY(data.x, data.z, data.type === "platform" ? 0.04 : 0), data.z);
  group.rotation.y = data.rotation || 0;
  group.userData.structure = data;
  if (preview) setMeshPreview(group, false);
  return group;
}

function rebuildPreview() {
  if (previewObject) {
    previewObject.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => material.dispose());
      }
    });
    scene.remove(previewObject);
  }
  previewObject = createBuildObject({ type: state.buildType, x: player.position.x, z: player.position.z, rotation: state.buildRotation }, true);
  previewObject.visible = state.buildMode;
  scene.add(previewObject);
  updateBuildPreview();
}

function updateBuildPreview() {
  if (!previewObject) return;
  const forward = tempVec.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
  const distance = state.buildType === "wall" ? 4.1 : 3.3;
  const x = Math.round(player.position.x + forward.x * distance);
  const z = Math.round(player.position.z + forward.z * distance);
  previewObject.position.set(x, groundY(x, z, state.buildType === "platform" ? 0.04 : 0), z);
  previewObject.rotation.y = state.buildRotation;
  previewObject.visible = state.buildMode;
  previewValid = islandRatioAt(x, z) < 0.91 && Math.hypot(x - player.position.x, z - player.position.z) > 1.2;
  ui.buildPosition.textContent = `X ${x} · Z ${z}`;
  previewObject.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material.color && material.userData.previewBase === undefined) {
        material.userData.previewBase = `#${material.color.getHexString()}`;
      }
      if (material.color) {
        material.color.set(material.userData.previewBase);
        material.color.lerp(new THREE.Color(previewValid ? 0xf2c66f : 0xff5c52), 0.52);
      }
    }
  });
}

function registerStructure(data) {
  const mesh = createBuildObject(data, false);
  buildGroup.add(mesh);
  structureMeshes.set(data.id, mesh);
  const spec = buildSpec(data.type);
  if (data.type !== "platform") addCollider(data.id, data.x, data.z, spec.width, spec.depth, data.rotation, "structure");
}

function placeStructure() {
  if (!state.buildMode || !previewObject) return;
  if (!previewValid) {
    showToast("這裡太靠近海岸，無法穩定放置物件。");
    return;
  }
  if (state.structures.length >= MAX_STRUCTURES) {
    showToast(`已達 ${MAX_STRUCTURES} 件物件上限。`);
    return;
  }
  const data = {
    id: `structure-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: state.buildType,
    x: Math.round(previewObject.position.x),
    z: Math.round(previewObject.position.z),
    rotation: state.buildRotation,
  };
  state.structures.push(data);
  registerStructure(data);
  saveWorld(false);
  showToast(`已放置${buildTypeLabel(data.type)}。`);
}

function removeNearestStructure() {
  if (!state.buildMode || state.structures.length === 0) {
    showToast("附近沒有可移除的自建物件。");
    return;
  }
  const target = previewObject?.position || player.position;
  let nearest = null;
  let nearestDistance = 5.2;
  for (const structure of state.structures) {
    const distance = Math.hypot(structure.x - target.x, structure.z - target.z);
    if (distance < nearestDistance) {
      nearest = structure;
      nearestDistance = distance;
    }
  }
  if (!nearest) {
    showToast("預覽位置附近沒有自建物件。");
    return;
  }
  const mesh = structureMeshes.get(nearest.id);
  if (mesh) buildGroup.remove(mesh);
  structureMeshes.delete(nearest.id);
  removeCollider(nearest.id);
  state.structures = state.structures.filter((item) => item.id !== nearest.id);
  saveWorld(false);
  showToast(`已移除${buildTypeLabel(nearest.type)}。`);
}

function buildTypeLabel(type) {
  return { wall: "防風牆", platform: "觀景台", pillar: "石柱", lantern: "引路燈" }[type] || "物件";
}

function setBuildType(type) {
  if (!buildSpec(type)) return;
  state.buildType = type;
  ui.toolButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.buildType === type));
  rebuildPreview();
}

function toggleBuildMode(force) {
  state.buildMode = typeof force === "boolean" ? force : !state.buildMode;
  document.body.classList.toggle("build-mode", state.buildMode);
  ui.buildPanel.hidden = !state.buildMode;
  ui.modeLabel.textContent = state.buildMode ? "建造模式" : "探索模式";
  if (previewObject) previewObject.visible = state.buildMode;
  if (state.buildMode && document.pointerLockElement) document.exitPointerLock?.();
  showToast(state.buildMode ? "建造模式：選擇物件，Enter 放置。" : "已回到探索模式。", 1600);
}

function saveWorld(showFeedback = true) {
  const payload = {
    version: 1,
    structures: state.structures,
    activeSignals: [...state.activeSignals],
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  if (showFeedback) showToast("場景已儲存在這台裝置。", 1600);
}

function loadWorld() {
  let payload = null;
  try {
    payload = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch (error) {
    console.warn("Could not parse saved world", error);
  }
  if (!payload || payload.version !== 1) return;
  const safeTypes = new Set(["wall", "platform", "pillar", "lantern"]);
  state.structures = (Array.isArray(payload.structures) ? payload.structures : [])
    .filter((item) => safeTypes.has(item?.type) && Number.isFinite(item.x) && Number.isFinite(item.z))
    .slice(0, MAX_STRUCTURES)
    .map((item) => ({
      id: String(item.id || `structure-${Math.random().toString(36).slice(2)}`),
      type: item.type,
      x: clamp(Math.round(item.x), -28, 28),
      z: clamp(Math.round(item.z), -24, 24),
      rotation: Math.round((Number(item.rotation) || 0) / (Math.PI / 2)) * (Math.PI / 2),
    }));
  state.activeSignals = new Set(Array.isArray(payload.activeSignals) ? payload.activeSignals.map(String) : []);
}

function clearBuiltWorld() {
  for (const mesh of structureMeshes.values()) buildGroup.remove(mesh);
  structureMeshes.clear();
  for (let index = colliders.length - 1; index >= 0; index -= 1) {
    if (colliders[index].source === "structure") colliders.splice(index, 1);
  }
  state.structures = [];
  state.activeSignals.clear();
  for (const signal of signals) {
    signal.userData.active = false;
    signal.userData.lens.color.set(0x6e766b);
    signal.userData.lens.emissive.set(0x111711);
    signal.userData.lens.emissiveIntensity = 0.15;
    signal.userData.light.intensity = 0;
    signal.userData.ring.material.opacity = 0;
  }
  if (lighthouseBeam) lighthouseBeam.visible = false;
  localStorage.removeItem(STORAGE_KEY);
  updateMissionUI();
  showToast("自建場景與任務進度已重設。", 2200);
}

function exportWorld() {
  const payload = {
    title: "Matsu Islands custom space",
    exportedAt: new Date().toISOString(),
    structures: state.structures,
    activeSignals: [...state.activeSignals],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "matsu-islands-space.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast("場景 JSON 已匯出。", 1600);
}

function showToast(message, duration = 2600) {
  ui.toast.textContent = message;
  ui.toast.classList.add("is-visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => ui.toast.classList.remove("is-visible"), duration);
}

function updateMissionUI() {
  const count = state.activeSignals.size;
  ui.signalCount.textContent = `${count} / ${signals.length || 3}`;
  ui.signalProgress.style.width = `${(count / (signals.length || 3)) * 100}%`;
}

function isPositionBlocked(x, z) {
  if (islandRatioAt(x, z) > 0.94) return true;
  for (const collider of colliders) {
    if (
      Math.abs(x - collider.x) < collider.halfX + PLAYER_RADIUS &&
      Math.abs(z - collider.z) < collider.halfZ + PLAYER_RADIUS
    ) return true;
  }
  return false;
}

function jump() {
  if (!state.started || !state.player.grounded) return;
  state.player.velocityY = 6.4;
  state.player.grounded = false;
}

function interact() {
  if (!state.started) return;
  if (state.nearbySignal && !state.nearbySignal.userData.active) activateSignal(state.nearbySignal);
  else showToast("附近沒有可互動的信號台。", 1200);
}

function updatePlayer(dt) {
  let forwardInput = 0;
  let rightInput = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) forwardInput += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) forwardInput -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) rightInput += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) rightInput -= 1;
  forwardInput += -mobileMove.y;
  rightInput += mobileMove.x;

  const magnitude = Math.hypot(forwardInput, rightInput);
  const moving = magnitude > 0.05;
  state.player.moving = moving;
  state.player.running = moving && (keys.has("ShiftLeft") || keys.has("ShiftRight"));

  if (moving) {
    forwardInput /= Math.max(1, magnitude);
    rightInput /= Math.max(1, magnitude);
    const forward = tempVec.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    const right = tempVec2.set(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    const direction = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(rightInput)).normalize();
    const speed = state.player.running ? 7.2 : 4.35;
    const nextX = player.position.x + direction.x * speed * dt;
    const nextZ = player.position.z + direction.z * speed * dt;
    if (!isPositionBlocked(nextX, player.position.z)) player.position.x = nextX;
    if (!isPositionBlocked(player.position.x, nextZ)) player.position.z = nextZ;
    const desiredYaw = Math.atan2(-direction.x, -direction.z);
    playerYaw = dampAngle(playerYaw, desiredYaw, 13, dt);
    player.rotation.y = playerYaw;
  }

  state.player.velocityY -= 16.5 * dt;
  player.position.y += state.player.velocityY * dt;
  const floor = groundY(player.position.x, player.position.z, 0.03);
  if (player.position.y <= floor) {
    player.position.y = floor;
    state.player.velocityY = 0;
    state.player.grounded = true;
  }

  const gait = state.elapsed * (state.player.running ? 13 : 8.5);
  const swing = moving && state.player.grounded ? Math.sin(gait) * (state.player.running ? 0.68 : 0.43) : 0;
  const limbs = player.userData.limbs;
  limbs[0].rotation.x = swing;
  limbs[1].rotation.x = -swing * 0.75;
  limbs[2].rotation.x = -swing;
  limbs[3].rotation.x = swing * 0.75;
  const bob = moving && state.player.grounded ? Math.abs(Math.sin(gait)) * 0.035 : 0;
  player.children[0].position.y = 1.18 + bob;
}

function updateSignals() {
  let nearby = null;
  let nearestDistance = 2.45;
  for (let index = 0; index < signals.length; index += 1) {
    const signal = signals[index];
    const distance = Math.hypot(signal.position.x - player.position.x, signal.position.z - player.position.z);
    if (!signal.userData.active && distance < nearestDistance) {
      nearby = signal;
      nearestDistance = distance;
    }
    if (signal.userData.active) {
      const pulse = 1 + Math.sin(state.elapsed * 2.8 + index) * 0.13;
      signal.userData.ring.scale.setScalar(pulse);
      signal.userData.ring.rotation.z = state.elapsed * 0.35;
      signal.userData.light.intensity = 7.2 + Math.sin(state.elapsed * 3.1 + index) * 1.3;
    }
  }
  state.nearbySignal = nearby;
  ui.interactionPrompt.hidden = !nearby || state.buildMode;
  if (lighthouseBeam?.visible) lighthouseBeam.rotation.y = state.elapsed * 0.19;
}

function updateCamera() {
  const target = tempVec.set(player.position.x, player.position.y + 1.28, player.position.z);
  const cosPitch = Math.cos(cameraPitch);
  const desired = tempVec2.set(
    target.x + Math.sin(cameraYaw) * cosPitch * cameraDistance,
    target.y + Math.sin(cameraPitch) * cameraDistance,
    target.z + Math.cos(cameraYaw) * cosPitch * cameraDistance
  );
  camera.position.lerp(desired, 0.16);
  camera.lookAt(target);
}

function updateAtmosphere(dt) {
  atmosphereGroup.rotation.y += dt * 0.004;
  const water = worldGroup.children.find((child) => child.userData.water);
  if (water) {
    water.material.roughness = 0.26 + Math.sin(state.elapsed * 0.22) * 0.025;
    water.position.y = -0.8 + Math.sin(state.elapsed * 0.35) * 0.025;
  }
}

function fixedUpdate(dt) {
  if (!state.started) return;
  state.elapsed += dt;
  updatePlayer(dt);
  updateSignals();
  updateBuildPreview();
  updateCamera();
  updateAtmosphere(dt);
}

function render() {
  renderer.render(scene, camera);
}

function startGame() {
  if (state.started) return;
  state.started = true;
  ui.startScreen.classList.add("is-hidden");
  showToast("找到並啟動島上的三座信號台。", 3000);
  // Pointer lock must be requested inside the original click/key gesture.
  // Delaying it causes browsers to discard the user activation token.
  if (!state.buildMode && SUPPORTS_DESKTOP_POINTER) {
    try { ui.canvas.requestPointerLock?.(); } catch (error) { console.debug("Pointer lock unavailable", error); }
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

function onKeyDown(event) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  keys.add(event.code);
  if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
  }
  if (!state.started && (event.code === "Enter" || event.code === "Space")) {
    startGame();
    return;
  }
  if (event.repeat && !["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) return;
  if (event.code === "Space") jump();
  if (event.code === "KeyE") interact();
  if (event.code === "KeyB") toggleBuildMode();
  if (event.code === "KeyF") toggleFullscreen();
  if (event.code === "Escape" && state.buildMode) toggleBuildMode(false);
  if (!state.buildMode) return;
  if (event.code === "Digit1") setBuildType("wall");
  if (event.code === "Digit2") setBuildType("platform");
  if (event.code === "Digit3") setBuildType("pillar");
  if (event.code === "Digit4") setBuildType("lantern");
  if (event.code === "KeyR") {
    state.buildRotation = (state.buildRotation + Math.PI / 2) % (Math.PI * 2);
    updateBuildPreview();
  }
  if (event.code === "Enter") placeStructure();
  if (event.code === "KeyX" || event.code === "Delete") removeNearestStructure();
}

function onKeyUp(event) {
  keys.delete(event.code);
}

function bindDesktopInput() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => keys.clear());
  document.addEventListener("mousemove", (event) => {
    if (!state.started || state.buildMode || document.pointerLockElement !== ui.canvas) return;
    cameraYaw -= event.movementX * 0.0023;
    cameraPitch = clamp(cameraPitch - event.movementY * 0.0018, -0.05, 0.82);
  });
  ui.canvas.addEventListener("click", () => {
    if (SUPPORTS_DESKTOP_POINTER && state.started && !state.buildMode && document.pointerLockElement !== ui.canvas) {
      ui.canvas.requestPointerLock?.();
    }
  });
  ui.canvas.addEventListener("wheel", (event) => {
    cameraDistance = clamp(cameraDistance + event.deltaY * 0.008, 3.6, 12.5);
    event.preventDefault();
  }, { passive: false });
}

function bindTouchInput() {
  let movePointerId = null;
  const updatePad = (event) => {
    const rect = ui.movePad.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    const max = rect.width * 0.31;
    const length = Math.hypot(x, y) || 1;
    const scale = Math.min(1, max / length);
    const clampedX = x * scale;
    const clampedY = y * scale;
    mobileMove = { x: clampedX / max, y: clampedY / max };
    ui.moveKnob.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
  };
  const releasePad = (event) => {
    if (movePointerId !== event.pointerId) return;
    movePointerId = null;
    mobileMove = { x: 0, y: 0 };
    ui.moveKnob.style.transform = "translate(0, 0)";
  };
  ui.movePad.addEventListener("pointerdown", (event) => {
    movePointerId = event.pointerId;
    ui.movePad.setPointerCapture?.(event.pointerId);
    updatePad(event);
  });
  ui.movePad.addEventListener("pointermove", (event) => {
    if (movePointerId === event.pointerId) updatePad(event);
  });
  ui.movePad.addEventListener("pointerup", releasePad);
  ui.movePad.addEventListener("pointercancel", releasePad);

  ui.mobileJump.addEventListener("pointerdown", jump);
  ui.mobileInteract.addEventListener("pointerdown", interact);
  ui.mobileBuild.addEventListener("pointerdown", () => toggleBuildMode());

  ui.canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" || state.buildMode) return;
    touchLookId = event.pointerId;
    lastTouchLook = { x: event.clientX, y: event.clientY };
    ui.canvas.setPointerCapture?.(event.pointerId);
  });
  ui.canvas.addEventListener("pointermove", (event) => {
    if (touchLookId !== event.pointerId || !lastTouchLook) return;
    cameraYaw -= (event.clientX - lastTouchLook.x) * 0.008;
    cameraPitch = clamp(cameraPitch - (event.clientY - lastTouchLook.y) * 0.006, -0.05, 0.82);
    lastTouchLook = { x: event.clientX, y: event.clientY };
  });
  const endLook = (event) => {
    if (touchLookId !== event.pointerId) return;
    touchLookId = null;
    lastTouchLook = null;
  };
  ui.canvas.addEventListener("pointerup", endLook);
  ui.canvas.addEventListener("pointercancel", endLook);
}

function bindUI() {
  ui.startButton.addEventListener("click", startGame);
  ui.closeBuild.addEventListener("click", () => toggleBuildMode(false));
  ui.toolButtons.forEach((button) => button.addEventListener("click", () => setBuildType(button.dataset.buildType)));
  ui.placeObject.addEventListener("click", placeStructure);
  ui.rotateObject.addEventListener("click", () => {
    state.buildRotation = (state.buildRotation + Math.PI / 2) % (Math.PI * 2);
    updateBuildPreview();
  });
  ui.removeObject.addEventListener("click", removeNearestStructure);
  ui.saveWorld.addEventListener("click", () => saveWorld(true));
  ui.exportWorld.addEventListener("click", exportWorld);
  ui.resetWorld.addEventListener("click", clearBuiltWorld);
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });
}

function renderGameToText() {
  const nearby = signals
    .map((signal) => ({
      id: signal.userData.id,
      label: signal.userData.label,
      active: signal.userData.active,
      x: Number(signal.position.x.toFixed(1)),
      z: Number(signal.position.z.toFixed(1)),
      distance: Number(Math.hypot(signal.position.x - player.position.x, signal.position.z - player.position.z).toFixed(1)),
    }))
    .sort((a, b) => a.distance - b.distance);
  return JSON.stringify({
    coordinateSystem: "x=east/right, y=up, z=south/down; island center=(0,0)",
    mode: state.started ? (state.buildMode ? "build" : "explore") : "start",
    objective: `activate signal stations (${state.activeSignals.size}/3)`,
    player: {
      x: Number(player.position.x.toFixed(2)),
      y: Number(player.position.y.toFixed(2)),
      z: Number(player.position.z.toFixed(2)),
      velocityY: Number(state.player.velocityY.toFixed(2)),
      grounded: state.player.grounded,
      moving: state.player.moving,
      running: state.player.running,
    },
    camera: {
      yawDegrees: Number(THREE.MathUtils.radToDeg(cameraYaw).toFixed(1)),
      pitchDegrees: Number(THREE.MathUtils.radToDeg(cameraPitch).toFixed(1)),
      distance: Number(cameraDistance.toFixed(1)),
      pointerLocked: document.pointerLockElement === ui.canvas,
    },
    nearbySignals: nearby,
    interactionAvailable: state.nearbySignal?.userData.label || null,
    build: {
      selectedType: state.buildType,
      rotationDegrees: Math.round(THREE.MathUtils.radToDeg(state.buildRotation)),
      preview: previewObject ? {
        x: Number(previewObject.position.x.toFixed(1)),
        z: Number(previewObject.position.z.toFixed(1)),
        valid: previewValid,
      } : null,
      placedCount: state.structures.length,
      placed: state.structures.map(({ id, type, x, z, rotation }) => ({
        id,
        type,
        x,
        z,
        rotationDegrees: Math.round(THREE.MathUtils.radToDeg(rotation)),
      })),
    },
    controls: "WASD move, Shift run, Space jump, E interact, B build, 1-4 select, R rotate, Enter place, X remove, F fullscreen",
  });
}

window.render_game_to_text = renderGameToText;
window.advanceTime = (milliseconds) => {
  // Once an external harness starts stepping time, keep the regular RAF loop
  // paused long enough for a complete multi-action choreography. This avoids
  // movement being counted twice when automation calls this hook frame-by-frame.
  externallySteppedUntil = performance.now() + 60_000;
  const steps = Math.max(1, Math.round(milliseconds / (1000 / 60)));
  for (let index = 0; index < steps; index += 1) fixedUpdate(1 / 60);
  render();
};

function init() {
  createWater();
  createIsland();
  createWorldDetails();
  createSkyParticles();
  createSignal("north-signal", 15, 9, "北坡信號台");
  createSignal("west-signal", -14, 6, "西崖信號台");
  createSignal("south-signal", -8, -16, "南岸信號台");
  loadWorld();
  state.structures.forEach(registerStructure);
  restoreActiveSignals();
  rebuildPreview();
  bindDesktopInput();
  bindTouchInput();
  bindUI();
  updateCamera();
  render();
  window.__matsuGameReady = true;
}

let previousTime = performance.now();
function animationLoop(now) {
  requestAnimationFrame(animationLoop);
  const dt = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;
  if (performance.now() > externallySteppedUntil) fixedUpdate(dt);
  render();
}

init();
requestAnimationFrame(animationLoop);
