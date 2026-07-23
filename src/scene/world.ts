import * as THREE from 'three';
import type { E235Formation, TrainQuality } from './e235';
import { calculateCameraRig } from './cameraRig';

const FORWARD = new THREE.Vector3(0, 0, 1);
export const JOURNEY_RAIL_START = 0.31;
export const JOURNEY_RAIL_END = 0.835;
export const BIRTHDAY_STATION_RAIL = 0.865;

interface StationDisplay {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
}

interface ConfettiState {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  velocity: Float32Array;
  life: number;
}

export interface RailwayWorldOptions {
  quality: TrainQuality;
  reducedMotion: boolean;
}

function initialPixelRatio(quality: TrainQuality): number {
  const deviceRatio = window.devicePixelRatio || 1;
  if (quality === 'low') return Math.min(deviceRatio, 1);
  if (quality === 'balanced') {
    // Four-car phone scenes stay crisp at this density while shading about
    // 23% fewer pixels than the previous 1.35 cap.
    const cap = window.innerWidth < 700 ? 1.18 : 1.3;
    return Math.min(deviceRatio, cap);
  }
  return Math.min(deviceRatio, 1.7);
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0xffffffff;
  };
}

export function createRailCurve(): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.5, 0.18, -72),
    new THREE.Vector3(-2.35, 0.17, -55),
    new THREE.Vector3(-2.2, 0.16, -38),
    new THREE.Vector3(-1.4, 0.08, -25),
    new THREE.Vector3(2.3, 0.04, -12),
    new THREE.Vector3(0.5, 0.02, 2),
    new THREE.Vector3(-2.5, 0.04, 16),
    new THREE.Vector3(1.8, 0.08, 31),
    new THREE.Vector3(0.2, 0.12, 46),
  ], false, 'centripetal', 0.5);
}

function offsetCurve(
  source: THREE.Curve<THREE.Vector3>,
  offset: number,
  height = 0,
): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = [];
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let index = 0; index <= 72; index += 1) {
    const amount = index / 72;
    const point = source.getPointAt(amount);
    source.getTangentAt(amount, tangent).normalize();
    normal.set(-tangent.z, 0, tangent.x).normalize();
    point.addScaledVector(normal, offset);
    point.y += height;
    points.push(point);
  }
  return new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
}

function createSkyEnvironmentTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    const sky = context.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, '#75a9cb');
    sky.addColorStop(0.46, '#d6edf2');
    sky.addColorStop(0.54, '#f5e8c5');
    sky.addColorStop(0.57, '#78977a');
    sky.addColorStop(1, '#314a42');
    context.fillStyle = sky;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const glow = context.createRadialGradient(382, 76, 3, 382, 76, 74);
    glow.addColorStop(0, 'rgba(255,250,214,.95)');
    glow.addColorStop(1, 'rgba(255,239,192,0)');
    context.fillStyle = glow;
    context.fillRect(290, 0, 190, 160);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}

function createBallastTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const random = seededRandom(235235);
  if (context) {
    context.fillStyle = '#77736b';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const palette = ['#414442', '#686862', '#8d887f', '#575b58', '#aaa297', '#77726a'];
    for (let index = 0; index < 1500; index += 1) {
      const radius = 1 + random() * 3.1;
      const x = random() * canvas.width;
      const y = random() * canvas.height;
      context.fillStyle = palette[Math.floor(random() * palette.length)];
      context.beginPath();
      for (let corner = 0; corner < 5; corner += 1) {
        const angle = corner / 5 * Math.PI * 2 + random() * 0.5;
        const distance = radius * (0.65 + random() * 0.7);
        const px = x + Math.cos(angle) * distance;
        const py = y + Math.sin(angle) * distance * 0.72;
        if (corner === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.needsUpdate = true;
  return texture;
}

function createBallastBumpTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const random = seededRandom(235236);
  if (context) {
    context.fillStyle = '#686868';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 1700; index += 1) {
      const value = 92 + Math.floor(random() * 140);
      const radius = 0.8 + random() * 3;
      context.fillStyle = `rgb(${value},${value},${value})`;
      context.beginPath();
      context.ellipse(
        random() * canvas.width,
        random() * canvas.height,
        radius,
        radius * (0.5 + random() * 0.45),
        random() * Math.PI,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createGrassTexture(bump = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const random = seededRandom(bump ? 235402 : 235401);
  if (context) {
    context.fillStyle = bump ? '#777777' : '#91a67e';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 2300; index += 1) {
      const x = random() * canvas.width;
      const y = random() * canvas.height;
      const length = 1 + random() * 5;
      if (bump) {
        const value = 78 + Math.floor(random() * 118);
        context.strokeStyle = `rgb(${value},${value},${value})`;
      } else {
        const palette = ['#68885e', '#779269', '#9aae82', '#6e8a60', '#a7b88d'];
        context.strokeStyle = palette[Math.floor(random() * palette.length)];
      }
      context.lineWidth = 0.55 + random() * 1.15;
      context.beginPath();
      context.moveTo(x, y + length);
      context.lineTo(x + (random() - 0.5) * 2.2, y);
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  if (!bump) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(13, 21);
  texture.needsUpdate = true;
  return texture;
}

function createBuildingTexture(kind: 'wall' | 'roof', bump = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const random = seededRandom((kind === 'roof' ? 235520 : 235510) + (bump ? 1 : 0));
  if (context) {
    const base = bump ? '#888888' : kind === 'roof' ? '#ad554a' : '#e7dec7';
    context.fillStyle = base;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 1100; index += 1) {
      const alpha = 0.025 + random() * 0.08;
      context.fillStyle = bump
        ? `rgba(255,255,255,${alpha})`
        : kind === 'roof'
          ? `rgba(74,43,38,${alpha})`
          : `rgba(104,92,72,${alpha})`;
      const size = 0.5 + random() * 2.4;
      context.fillRect(random() * canvas.width, random() * canvas.height, size, size);
    }
    context.strokeStyle = bump ? '#555555' : kind === 'roof' ? '#713d38' : '#c4b99e';
    context.lineWidth = kind === 'roof' ? 2 : 1;
    if (kind === 'roof') {
      for (let x = 0; x <= canvas.width; x += 32) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, canvas.height);
        context.stroke();
      }
    } else {
      for (let y = 32; y < canvas.height; y += 32) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(canvas.width, y);
        context.stroke();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  if (!bump) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === 'roof' ? 4 : 3, kind === 'roof' ? 2 : 3);
  texture.needsUpdate = true;
  return texture;
}

function createRailBedGeometry(
  curve: THREE.Curve<THREE.Vector3>,
  divisions: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let distance = 0;
  let previous = curve.getPointAt(0);
  for (let index = 0; index <= divisions; index += 1) {
    const amount = index / divisions;
    const point = curve.getPointAt(amount);
    if (index > 0) distance += point.distanceTo(previous);
    previous = point.clone();
    curve.getTangentAt(amount, tangent).normalize();
    normal.set(-tangent.z, 0, tangent.x).normalize();
    const topY = point.y + 0.002;
    const baseY = point.y - 0.13;
    const crossSection = [
      [-0.56, topY], [0.56, topY],
      [-0.56, topY], [-0.78, baseY],
      [0.56, topY], [0.78, baseY],
    ];
    crossSection.forEach(([lateral, y], vertex) => {
      const vertexPoint = point.clone().addScaledVector(normal, lateral);
      positions.push(vertexPoint.x, y, vertexPoint.z);
      const u = [0, 1, 0.18, 0, 0.82, 1][vertex];
      uvs.push(u * 1.4, distance * 1.35);
    });
  }
  for (let index = 0; index < divisions; index += 1) {
    const current = index * 6;
    const next = current + 6;
    indices.push(
      current, next + 1, next, current, current + 1, next + 1,
      // The slope faces wind outward so FrontSide ballast remains visible
      // from both sides of the railway corridor.
      current + 3, current + 2, next + 2, current + 3, next + 2, next + 3,
      current + 4, current + 5, next + 5, current + 4, next + 5, next + 4,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createStationDisplay(): StationDisplay {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 360;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.25, 0.78), material);
  return { canvas, texture, mesh };
}

function paintStationDisplay(display: StationDisplay, days: number, departure: boolean): void {
  const context = display.canvas.getContext('2d');
  if (!context) return;
  const { width, height } = display.canvas;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#fffdf4';
  context.beginPath();
  context.roundRect(15, 15, width - 30, height - 30, 34);
  context.fill();
  context.lineWidth = 22;
  context.strokeStyle = '#173f60';
  context.stroke();
  context.fillStyle = departure ? '#dfd2aa' : '#17658a';
  context.fillRect(34, 42, width - 68, 46);
  context.fillStyle = departure ? '#304557' : '#e9dfb8';
  context.fillRect(34, height - 88, width - 68, 42);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#173247';
  context.font = '800 54px "Noto Sans JP", "Yu Gothic", sans-serif';
  context.fillText(departure ? 'きのうの えき' : 'きょうの えき', width / 2, 126);
  const label = days === 0 ? 'たんじょうびえき' : `あと ${days} にちえき`;
  let fontSize = days === 0 ? 104 : 126;
  do {
    context.font = `950 ${fontSize}px "Noto Sans JP", "Yu Gothic", sans-serif`;
    fontSize -= 4;
  } while (context.measureText(label).width > width - 90 && fontSize > 64);
  context.fillStyle = days === 0 ? '#e55d46' : '#163b57';
  context.fillText(label, width / 2, 224);
  display.texture.needsUpdate = true;
}

function placeAlongCurve(
  object: THREE.Object3D,
  curve: THREE.Curve<THREE.Vector3>,
  amount: number,
  lateral = 0,
  height = 0,
): void {
  const point = curve.getPointAt(amount);
  const tangent = curve.getTangentAt(amount).normalize();
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  object.position.copy(point).addScaledVector(normal, lateral);
  object.position.y += height;
  object.quaternion.setFromUnitVectors(FORWARD, tangent);
}

export class RailwayWorld {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.03, 180);
  readonly renderer: THREE.WebGLRenderer;

  private readonly curve = createRailCurve();
  private readonly curveLength = this.curve.getLength();
  private readonly formation: E235Formation;
  private readonly formationOffsets: number[];
  private readonly carPoints: THREE.Vector3[];
  private readonly carTangents: THREE.Vector3[];
  private readonly carQuaternions: THREE.Quaternion[];
  private readonly stationDisplay = createStationDisplay();
  private readonly departureDisplay = createStationDisplay();
  private readonly stationRoot = new THREE.Group();
  private readonly stationGlow = new THREE.PointLight(0xffd773, 0, 14, 2);
  private readonly festiveDecorations: THREE.Object3D[] = [];
  private readonly reducedMotion: boolean;
  private readonly quality: TrainQuality;
  private readonly minimumPixelRatio: number;
  private readonly resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  private readonly clock = new THREE.Clock();
  private readonly lookTarget = new THREE.Vector3();
  private readonly desiredCamera = new THREE.Vector3();
  private readonly journeyPoint = new THREE.Vector3();
  private readonly journeyTangent = new THREE.Vector3();
  private readonly scratchNormal = new THREE.Vector3();
  private readonly scratchDirection = new THREE.Vector3();
  private readonly scratchCameraTarget = new THREE.Vector3();
  private readonly scratchStationPoint = new THREE.Vector3();
  private readonly scratchDesiredDirection = new THREE.Vector3();
  private readonly confetti: ConfettiState;
  private animationFrame = 0;
  private started = false;
  private journeyProgress = 0;
  private speed = 0;
  private running = false;
  private suspended = false;
  private pixelRatio: number;
  private frameIntervalAverage = 1000 / 60;
  private continuousFrameCount = 0;
  private previousFrameTime = 0;
  private stationRangeKey = '';
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, formation: E235Formation, options: RailwayWorldOptions) {
    this.formation = formation;
    this.formationOffsets = formation.cars.map((car) => Math.max(0, -car.position.z));
    this.carPoints = formation.cars.map(() => new THREE.Vector3());
    this.carTangents = formation.cars.map(() => new THREE.Vector3());
    this.carQuaternions = formation.cars.map(() => new THREE.Quaternion());
    this.reducedMotion = options.reducedMotion;
    this.quality = options.quality;
    this.pixelRatio = initialPixelRatio(options.quality);
    this.minimumPixelRatio = Math.min(this.pixelRatio, options.quality === 'high' ? 1.25 : 1);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: options.quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = options.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.fog = new THREE.FogExp2(0xbfd9d5, 0.018);
    for (const display of [this.stationDisplay, this.departureDisplay]) {
      this.resources.add(display.texture);
      this.resources.add(display.mesh.geometry);
      this.resources.add(display.mesh.material);
    }
    this.createLighting(options.quality);
    this.createLandscape(options.quality);
    this.createTrack(options.quality);
    this.createCatenary(options.quality);
    this.createScenicDetails(options.quality);
    this.createStations(options.quality);
    this.scene.add(formation.root);
    this.confetti = this.createConfetti(options.quality);
    this.scene.add(this.confetti.points);
    formation.setDestination('たんじょうび号');
    formation.setLights(false);
    this.setStations(1, 0);
    this.setProgress(0);
    this.resize();
    // Prepare every scene material while the loading cover is still visible,
    // including the station and decorations that enter the frustum later.
    // This prevents a first-use shader compilation pause during the journey.
    this.renderer.compile(this.scene, this.camera);
  }

  private trackResource<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(resource: T): T {
    this.resources.add(resource);
    return resource;
  }

  private createLighting(quality: TrainQuality): void {
    const environment = this.trackResource(createSkyEnvironmentTexture());
    environment.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.environment = environment;
    this.scene.environmentIntensity = quality === 'low' ? 0.68 : 0.86;

    const hemisphere = new THREE.HemisphereLight(0xcce9ff, 0x4c6545, quality === 'low' ? 1.75 : 1.62);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xfff0ce, quality === 'low' ? 2.45 : 3.05);
    sun.position.set(-9, 15, -7);
    sun.castShadow = quality !== 'low';
    sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -16;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 55;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.018;
    this.scene.add(sun);
    this.stationGlow.position.set(0, 4, 32);
    this.scene.add(this.stationGlow);
  }

  private createLandscape(quality: TrainQuality): void {
    const grassTexture = this.trackResource(createGrassTexture());
    const grassBumpTexture = this.trackResource(createGrassTexture(true));
    const maxAnisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    grassTexture.anisotropy = maxAnisotropy;
    grassBumpTexture.anisotropy = maxAnisotropy;
    const groundGeometry = this.trackResource(new THREE.PlaneGeometry(92, 144, 34, 54));
    const groundPositions = groundGeometry.getAttribute('position') as THREE.BufferAttribute;
    const groundColors = new Float32Array(groundPositions.count * 3);
    const grassDark = new THREE.Color(0x78966d);
    const grassLight = new THREE.Color(0xa3b88d);
    const grassColor = new THREE.Color();
    for (let index = 0; index < groundPositions.count; index += 1) {
      const x = groundPositions.getX(index);
      const z = -groundPositions.getY(index) - 10;
      const corridor = Math.max(0, Math.abs(x) - 5.2);
      const coastalDrop = x > 13 ? -0.22 : 0;
      const ripple = Math.sin(x * 0.31 + z * 0.08) * 0.09 + Math.sin(z * 0.17) * 0.055;
      const height = coastalDrop || THREE.MathUtils.clamp(corridor * 0.035 + ripple, -0.04, 1.45);
      groundPositions.setZ(index, height);
      const mix = THREE.MathUtils.clamp(0.42 + height * 0.25 + Math.sin(index * 2.17) * 0.12, 0, 1);
      grassColor.copy(grassDark).lerp(grassLight, mix);
      groundColors[index * 3] = grassColor.r;
      groundColors[index * 3 + 1] = grassColor.g;
      groundColors[index * 3 + 2] = grassColor.b;
    }
    groundGeometry.setAttribute('color', new THREE.BufferAttribute(groundColors, 3));
    groundGeometry.computeVertexNormals();
    const groundMaterial = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: grassTexture,
      bumpMap: grassBumpTexture,
      bumpScale: 0.055,
      roughness: 0.91,
      metalness: 0,
    }));
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.12, -10);
    ground.receiveShadow = true;
    this.scene.add(ground);

    const water = new THREE.Mesh(
      this.trackResource(new THREE.PlaneGeometry(35, 144, 1, 1)),
      this.trackResource(new THREE.MeshPhysicalMaterial({
        color: 0x4f9dad,
        roughness: 0.2,
        metalness: 0.12,
        transparent: true,
        opacity: 0.86,
        clearcoat: 0.8,
        clearcoatRoughness: 0.16,
      })),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(29.5, -0.055, -10);
    this.scene.add(water);

    const random = seededRandom(2351000);
    const treeCount = quality === 'high' ? 92 : quality === 'balanced' ? 62 : 34;
    const crownGeometry = this.trackResource(new THREE.IcosahedronGeometry(0.48, quality === 'high' ? 2 : 1));
    const trunkGeometry = this.trackResource(new THREE.CylinderGeometry(0.07, 0.1, 0.8, 6));
    const crownMaterial = this.trackResource(new THREE.MeshStandardMaterial({ color: 0x3e7654, roughness: 0.95 }));
    const trunkMaterial = this.trackResource(new THREE.MeshStandardMaterial({ color: 0x73583d, roughness: 1 }));
    const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, treeCount);
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
    const dummy = new THREE.Object3D();
    let written = 0;
    while (written < treeCount) {
      const z = -70 + random() * 120;
      const side = random() > 0.5 ? 1 : -1;
      const x = side * (5.1 + random() * 29);
      const scale = 0.75 + random() * 1.9;
      dummy.position.set(x, 0.35 * scale, z);
      dummy.scale.set(scale * 0.42, scale, scale * 0.42);
      dummy.rotation.y = random() * Math.PI;
      dummy.updateMatrix();
      trunks.setMatrixAt(written, dummy.matrix);
      dummy.position.y = 0.9 * scale;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      crowns.setMatrixAt(written, dummy.matrix);
      written += 1;
    }
    crowns.instanceMatrix.needsUpdate = true;
    trunks.instanceMatrix.needsUpdate = true;
    crowns.castShadow = quality === 'high';
    crowns.receiveShadow = true;
    trunks.castShadow = quality === 'high';
    this.scene.add(trunks, crowns);

    const houseCount = quality === 'high' ? 30 : quality === 'balanced' ? 20 : 10;
    const walls = new THREE.InstancedMesh(
      this.trackResource(new THREE.BoxGeometry(0.72, 0.72, 0.8)),
      this.trackResource(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 })),
      houseCount,
    );
    const roofs = new THREE.InstancedMesh(
      this.trackResource(new THREE.ConeGeometry(0.58, 0.42, 4)),
      this.trackResource(new THREE.MeshStandardMaterial({ color: 0xa55745, roughness: 0.8 })),
      houseCount,
    );
    const housePalette = [new THREE.Color(0xe8dfc5), new THREE.Color(0xd6e2dc), new THREE.Color(0xe4cfc0), new THREE.Color(0xcbd7df)];
    for (let index = 0; index < houseCount; index += 1) {
      const x = -7.5 - random() * 17;
      const z = -60 + random() * 104;
      const scale = 0.72 + random() * 0.75;
      dummy.position.set(x, 0.36 * scale, z);
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.y = random() * Math.PI;
      dummy.updateMatrix();
      walls.setMatrixAt(index, dummy.matrix);
      walls.setColorAt(index, housePalette[index % housePalette.length]);
      dummy.position.y = 0.89 * scale;
      dummy.rotation.y += Math.PI / 4;
      dummy.updateMatrix();
      roofs.setMatrixAt(index, dummy.matrix);
    }
    walls.instanceMatrix.needsUpdate = true;
    roofs.instanceMatrix.needsUpdate = true;
    walls.instanceColor!.needsUpdate = true;
    walls.castShadow = quality === 'high';
    walls.receiveShadow = true;
    roofs.castShadow = quality === 'high';
    this.scene.add(walls, roofs);

    const rockCount = quality === 'low' ? 18 : 34;
    const rocks = new THREE.InstancedMesh(
      this.trackResource(new THREE.DodecahedronGeometry(0.38, quality === 'high' ? 1 : 0)),
      this.trackResource(new THREE.MeshBasicMaterial({ color: 0x7f9182, toneMapped: true })),
      rockCount,
    );
    for (let index = 0; index < rockCount; index += 1) {
      const scale = 0.55 + random() * 1.35;
      dummy.position.set(12.3 + random() * 2.8, 0.04, -66 + random() * 116);
      dummy.scale.set(scale * 1.4, scale * 0.65, scale);
      dummy.rotation.set(random(), random() * Math.PI, random());
      dummy.updateMatrix();
      rocks.setMatrixAt(index, dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    rocks.receiveShadow = false;
    this.scene.add(rocks);
  }

  private createTrack(quality: TrainQuality): void {
    const ballastTexture = this.trackResource(createBallastTexture());
    const ballastBumpTexture = this.trackResource(createBallastBumpTexture());
    ballastTexture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    ballastBumpTexture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const ballastMaterial = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: ballastTexture,
      bumpMap: ballastBumpTexture,
      bumpScale: 0.045,
      roughness: 0.93,
      metalness: 0,
    }));
    const railTopMaterial = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0xb9c2c4,
      roughness: 0.23,
      metalness: 0.92,
      envMapIntensity: 0.9,
    }));
    const railSideMaterial = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0x596367,
      roughness: 0.43,
      metalness: 0.84,
      envMapIntensity: 0.62,
    }));
    const sleeperMaterial = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0,
      vertexColors: true,
    }));
    const padMaterial = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0x292e2f,
      roughness: 0.72,
      metalness: 0.2,
    }));
    const ballast = new THREE.Mesh(
      this.trackResource(createRailBedGeometry(this.curve, quality === 'low' ? 110 : 210)),
      ballastMaterial,
    );
    ballast.receiveShadow = true;
    this.scene.add(ballast);

    const gauge = 0.31;
    const railSegments = quality === 'low' ? 110 : 210;
    const railRadialSegments = quality === 'low' ? 5 : 7;
    for (const side of [-1, 1] as const) {
      const railParts = [
        { height: 0.036, radius: 0.037, material: railSideMaterial },
        { height: 0.066, radius: 0.014, material: railSideMaterial },
        { height: 0.086, radius: 0.027, material: railTopMaterial },
      ];
      for (const part of railParts) {
        const rail = new THREE.Mesh(
          this.trackResource(new THREE.TubeGeometry(
            offsetCurve(this.curve, gauge * side, part.height),
            railSegments,
            part.radius,
            railRadialSegments,
            false,
          )),
          part.material,
        );
        rail.castShadow = quality !== 'low';
        rail.receiveShadow = true;
        this.scene.add(rail);
      }
    }

    const sleeperCount = quality === 'high' ? 320 : quality === 'balanced' ? 240 : 132;
    const sleeperGeometry = this.trackResource(new THREE.BoxGeometry(1.08, 0.055, 0.115));
    const sleepers = new THREE.InstancedMesh(sleeperGeometry, sleeperMaterial, sleeperCount);
    const pads = new THREE.InstancedMesh(
      this.trackResource(new THREE.BoxGeometry(0.14, 0.025, 0.098)),
      padMaterial,
      sleeperCount * 2,
    );
    const fastenerMaterial = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0x4b4038,
      roughness: 0.58,
      metalness: 0.62,
    }));
    const clips = new THREE.InstancedMesh(
      this.trackResource(new THREE.BoxGeometry(0.034, 0.045, 0.064)),
      fastenerMaterial,
      sleeperCount * 4,
    );
    const sleeperPalette = [
      new THREE.Color(0x9d9b94),
      new THREE.Color(0xaaa79f),
      new THREE.Color(0x8f918d),
      new THREE.Color(0xb2aea4),
    ];
    const dummy = new THREE.Object3D();
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (let index = 0; index < sleeperCount; index += 1) {
      const amount = index / (sleeperCount - 1);
      const point = this.curve.getPointAt(amount);
      this.curve.getTangentAt(amount, tangent).normalize();
      normal.set(-tangent.z, 0, tangent.x).normalize();
      dummy.position.copy(point);
      dummy.position.y += 0.024;
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.quaternion.setFromUnitVectors(FORWARD, tangent);
      dummy.updateMatrix();
      sleepers.setMatrixAt(index, dummy.matrix);
      sleepers.setColorAt(index, sleeperPalette[index % sleeperPalette.length]);
      for (const side of [-1, 1] as const) {
        dummy.position.copy(point).addScaledVector(normal, gauge * side);
        dummy.position.y += 0.058;
        dummy.updateMatrix();
        pads.setMatrixAt(index * 2 + (side === 1 ? 1 : 0), dummy.matrix);
        for (const clipSide of [-1, 1] as const) {
          dummy.position.copy(point).addScaledVector(
            normal,
            gauge * side + clipSide * 0.058,
          );
          dummy.position.y += 0.084;
          dummy.updateMatrix();
          const clipIndex = index * 4
            + (side === 1 ? 2 : 0)
            + (clipSide === 1 ? 1 : 0);
          clips.setMatrixAt(clipIndex, dummy.matrix);
        }
      }
    }
    sleepers.instanceColor!.needsUpdate = true;
    sleepers.receiveShadow = true;
    sleepers.castShadow = quality === 'high';
    pads.castShadow = quality === 'high';
    pads.receiveShadow = true;
    clips.castShadow = quality === 'high';
    clips.receiveShadow = true;
    this.scene.add(sleepers, pads, clips);

    const random = seededRandom(2350912);
    const stoneCount = quality === 'high' ? 1000 : quality === 'balanced' ? 700 : 280;
    const stoneGeometry = this.trackResource(new THREE.DodecahedronGeometry(0.038, 0));
    const stoneMaterial = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.96,
      metalness: 0,
    }));
    const stones = new THREE.InstancedMesh(stoneGeometry, stoneMaterial, stoneCount);
    const stonePalette = [
      new THREE.Color(0x545856),
      new THREE.Color(0x797870),
      new THREE.Color(0x969188),
      new THREE.Color(0x656763),
      new THREE.Color(0xaaa398),
    ];
    for (let index = 0; index < stoneCount; index += 1) {
      const amount = index < stoneCount * 0.82
        ? 0.22 + random() * 0.73
        : random();
      const point = this.curve.getPointAt(amount);
      this.curve.getTangentAt(amount, tangent).normalize();
      normal.set(-tangent.z, 0, tangent.x).normalize();
      dummy.position.copy(point).addScaledVector(normal, (random() - 0.5) * 1.08);
      dummy.position.y += 0.015 + random() * 0.036;
      dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      const scale = 0.58 + random() * 1.36;
      dummy.scale.set(scale * (0.68 + random() * 0.72), scale * 0.56, scale);
      dummy.updateMatrix();
      stones.setMatrixAt(index, dummy.matrix);
      stones.setColorAt(index, stonePalette[Math.floor(random() * stonePalette.length)]);
    }
    stones.instanceColor!.needsUpdate = true;
    stones.castShadow = quality === 'high';
    stones.receiveShadow = true;
    this.scene.add(stones);

    const ductCount = quality === 'high' ? 150 : quality === 'balanced' ? 112 : 68;
    const ductMaterial = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0x8b8f8c,
      roughness: 0.92,
      metalness: 0.02,
    }));
    const ducts = new THREE.InstancedMesh(
      this.trackResource(new THREE.BoxGeometry(0.19, 0.1, 0.86)),
      ductMaterial,
      ductCount,
    );
    for (let index = 0; index < ductCount; index += 1) {
      const amount = index / Math.max(1, ductCount - 1);
      const point = this.curve.getPointAt(amount);
      this.curve.getTangentAt(amount, tangent).normalize();
      normal.set(-tangent.z, 0, tangent.x).normalize();
      dummy.position.copy(point).addScaledVector(normal, -0.92);
      dummy.position.y -= 0.012;
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.quaternion.setFromUnitVectors(FORWARD, tangent);
      dummy.updateMatrix();
      ducts.setMatrixAt(index, dummy.matrix);
    }
    ducts.castShadow = quality === 'high';
    ducts.receiveShadow = true;
    this.scene.add(ducts);
  }

  private createCatenary(quality: TrainQuality): void {
    if (quality === 'low') return;
    const metal = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0x59696e,
      roughness: 0.53,
      metalness: 0.76,
    }));
    const concrete = this.trackResource(new THREE.MeshStandardMaterial({ color: 0x939996, roughness: 0.94 }));
    const ceramic = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0xc7d2ce,
      roughness: 0.3,
      metalness: 0.08,
    }));
    const poleGeometry = this.trackResource(new THREE.CylinderGeometry(0.035, 0.05, 3.2, 8));
    const armGeometry = this.trackResource(new THREE.BoxGeometry(1.55, 0.045, 0.045));
    const baseGeometry = this.trackResource(new THREE.CylinderGeometry(0.12, 0.14, 0.18, 8));
    const insulatorGeometry = this.trackResource(new THREE.CylinderGeometry(0.032, 0.032, 0.18, 10));
    insulatorGeometry.rotateZ(Math.PI / 2);
    const poleCount = quality === 'high' ? 19 : 14;
    const poles = new THREE.InstancedMesh(poleGeometry, metal, poleCount);
    const arms = new THREE.InstancedMesh(armGeometry, metal, poleCount);
    const bases = new THREE.InstancedMesh(baseGeometry, concrete, poleCount);
    const insulators = new THREE.InstancedMesh(insulatorGeometry, ceramic, poleCount);
    const baseMatrix = new THREE.Matrix4();
    const localMatrix = new THREE.Matrix4();
    const worldMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    for (let index = 0; index < poleCount; index += 1) {
      const amount = 0.03 + index / (poleCount - 1) * 0.94;
      this.curve.getPointAt(amount, position);
      this.curve.getTangentAt(amount, tangent).normalize();
      normal.set(-tangent.z, 0, tangent.x).normalize();
      position.addScaledVector(normal, 1.05);
      quaternion.setFromUnitVectors(FORWARD, tangent);
      baseMatrix.compose(position, quaternion, scale);
      localMatrix.makeTranslation(0, 0.09, 0);
      worldMatrix.multiplyMatrices(baseMatrix, localMatrix);
      bases.setMatrixAt(index, worldMatrix);
      localMatrix.makeTranslation(0, 1.58, 0);
      worldMatrix.multiplyMatrices(baseMatrix, localMatrix);
      poles.setMatrixAt(index, worldMatrix);
      // Local +X points from the lineside pole back toward the track centre.
      // Keep the cantilever and insulator over the contact wire, not outside
      // the railway corridor.
      localMatrix.makeTranslation(0.72, 3.05, 0);
      worldMatrix.multiplyMatrices(baseMatrix, localMatrix);
      arms.setMatrixAt(index, worldMatrix);
      localMatrix.makeTranslation(0.63, 3.035, 0);
      worldMatrix.multiplyMatrices(baseMatrix, localMatrix);
      insulators.setMatrixAt(index, worldMatrix);
    }
    poles.castShadow = quality === 'high';
    arms.castShadow = quality === 'high';
    bases.castShadow = quality === 'high';
    bases.receiveShadow = true;
    insulators.castShadow = quality === 'high';
    this.scene.add(bases, poles, arms, insulators);

    const contactPoints: THREE.Vector3[] = [];
    const messengerPoints: THREE.Vector3[] = [];
    const wireDivisions = quality === 'high' ? 120 : 90;
    for (let index = 0; index <= wireDivisions; index += 1) {
      const amount = index / wireDivisions;
      const contact = this.curve.getPointAt(amount);
      this.curve.getTangentAt(amount, tangent).normalize();
      normal.set(-tangent.z, 0, tangent.x).normalize();
      const spanPhase = (amount - 0.03) / 0.94 * (poleCount - 1);
      const stagger = Math.cos(spanPhase * Math.PI) * 0.042;
      contact.addScaledVector(normal, stagger);
      contact.y += 2.86;
      contactPoints.push(contact);
      const messenger = contact.clone();
      messenger.y += 0.24 + Math.cos(spanPhase * Math.PI * 2) * 0.045;
      messengerPoints.push(messenger);
    }
    const wireMaterial = this.trackResource(new THREE.MeshBasicMaterial({ color: 0x394e56 }));
    const contactWire = new THREE.Mesh(
      this.trackResource(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(contactPoints), 180, 0.008, 5, false)),
      wireMaterial,
    );
    const messengerWire = new THREE.Mesh(
      this.trackResource(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(messengerPoints), 180, 0.006, 5, false)),
      wireMaterial,
    );
    const dropperCount = (poleCount - 1) * 3;
    const dropperGeometry = this.trackResource(new THREE.CylinderGeometry(0.004, 0.004, 1, 5));
    const droppers = new THREE.InstancedMesh(dropperGeometry, wireMaterial, dropperCount);
    const dropperDummy = new THREE.Object3D();
    for (let index = 0; index < dropperCount; index += 1) {
      const amount = 0.035 + index / Math.max(1, dropperCount - 1) * 0.93;
      const contact = this.curve.getPointAt(amount);
      this.curve.getTangentAt(amount, tangent).normalize();
      normal.set(-tangent.z, 0, tangent.x).normalize();
      const spanPhase = (amount - 0.03) / 0.94 * (poleCount - 1);
      contact.addScaledVector(normal, Math.cos(spanPhase * Math.PI) * 0.042);
      contact.y += 2.86;
      const dropperHeight = 0.24 + Math.cos(spanPhase * Math.PI * 2) * 0.045;
      dropperDummy.position.copy(contact);
      dropperDummy.position.y += dropperHeight * 0.5;
      dropperDummy.rotation.set(0, 0, 0);
      dropperDummy.scale.set(1, dropperHeight, 1);
      dropperDummy.updateMatrix();
      droppers.setMatrixAt(index, dropperDummy.matrix);
    }
    this.scene.add(contactWire, messengerWire, droppers);
  }

  private createScenicDetails(quality: TrainQuality): void {
    const stone = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0x59645f,
      roughness: 0.98,
      metalness: 0,
    }));
    const portalShape = new THREE.Shape();
    portalShape.moveTo(-1.48, 0);
    portalShape.lineTo(-1.48, 1.34);
    portalShape.absarc(0, 1.34, 1.48, Math.PI, 0, false);
    portalShape.lineTo(1.48, 0);
    portalShape.closePath();
    const opening = new THREE.Path();
    opening.moveTo(-0.78, 0);
    opening.lineTo(-0.78, 1.26);
    opening.absarc(0, 1.26, 0.78, Math.PI, 0, true);
    opening.lineTo(0.78, 0);
    opening.closePath();
    portalShape.holes.push(opening);
    const portal = new THREE.Mesh(
      this.trackResource(new THREE.ExtrudeGeometry(portalShape, {
        depth: 0.5,
        bevelEnabled: true,
        bevelSize: 0.06,
        bevelThickness: 0.05,
        bevelSegments: quality === 'high' ? 3 : 2,
        curveSegments: quality === 'high' ? 18 : 10,
      })),
      stone,
    );
    portal.position.z = -0.25;
    portal.castShadow = quality !== 'low';
    const portalRoot = new THREE.Group();
    portalRoot.add(portal);
    placeAlongCurve(portalRoot, this.curve, 0.555, 0, -0.02);
    this.scene.add(portalRoot);

    const signalRoot = new THREE.Group();
    const signalPole = new THREE.Mesh(
      this.trackResource(new THREE.CylinderGeometry(0.035, 0.045, 2.25, 8)),
      this.trackResource(new THREE.MeshStandardMaterial({ color: 0x4d5b61, roughness: 0.62, metalness: 0.64 })),
    );
    signalPole.position.y = 1.12;
    const signalCase = new THREE.Mesh(
      this.trackResource(new THREE.BoxGeometry(0.34, 0.86, 0.18)),
      this.trackResource(new THREE.MeshStandardMaterial({ color: 0x182a31, roughness: 0.5 })),
    );
    signalCase.position.y = 2.12;
    signalRoot.add(signalPole, signalCase);
    const signalColors = [0x73e598, 0xf0c655, 0xe65e4a];
    signalColors.forEach((color, index) => {
      const lens = new THREE.Mesh(
        this.trackResource(new THREE.CircleGeometry(0.09, 16)),
        this.trackResource(new THREE.MeshBasicMaterial({ color, toneMapped: false })),
      );
      lens.position.set(0, 2.39 - index * 0.27, -0.095);
      lens.rotation.y = Math.PI;
      lens.visible = index === 0;
      signalRoot.add(lens);
    });
    placeAlongCurve(signalRoot, this.curve, 0.705, 1.02, 0);
    this.scene.add(signalRoot);
  }

  private createStations(quality: TrainQuality): void {
    const wallTexture = this.trackResource(createBuildingTexture('wall'));
    const wallBumpTexture = this.trackResource(createBuildingTexture('wall', true));
    const roofTexture = this.trackResource(createBuildingTexture('roof'));
    const roofBumpTexture = this.trackResource(createBuildingTexture('roof', true));
    const maxAnisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    for (const texture of [wallTexture, wallBumpTexture, roofTexture, roofBumpTexture]) {
      texture.anisotropy = maxAnisotropy;
    }
    const concrete = this.trackResource(new THREE.MeshStandardMaterial({ color: 0xbcbab1, roughness: 0.92 }));
    const darkConcrete = this.trackResource(new THREE.MeshStandardMaterial({ color: 0x747a78, roughness: 0.92 }));
    const canopy = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0x195c7a,
      roughness: 0.42,
      metalness: 0.32,
    }));
    const cream = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: wallTexture,
      bumpMap: wallBumpTexture,
      bumpScale: 0.018,
      roughness: 0.76,
    }));
    const trim = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0xe9ece7,
      roughness: 0.48,
      metalness: 0.38,
    }));
    const roofTile = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: roofTexture,
      bumpMap: roofBumpTexture,
      bumpScale: 0.026,
      roughness: 0.46,
      metalness: 0.18,
      envMapIntensity: 0.72,
    }));
    const tactileMaterial = this.trackResource(new THREE.MeshStandardMaterial({ color: 0xe8bd45, roughness: 0.7 }));
    const safetyLineMaterial = this.trackResource(new THREE.MeshStandardMaterial({ color: 0xf2f0df, roughness: 0.72 }));
    const stationGlass = this.trackResource(new THREE.MeshPhysicalMaterial({
      color: 0x28596a,
      roughness: 0.09,
      metalness: 0.08,
      transmission: quality === 'high' ? 0.18 : 0,
      transparent: true,
      opacity: 0.8,
      emissive: 0x123145,
      emissiveIntensity: 0.14,
      envMapIntensity: 1.05,
    }));

    const departureRoot = new THREE.Group();
    const departurePlatform = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(2.1, 0.18, 8.5)), concrete);
    departurePlatform.position.y = 0.05;
    departurePlatform.receiveShadow = true;
    const departureFascia = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(0.055, 0.24, 8.5)), canopy);
    departureFascia.position.set(1.04, 0.01, 0);
    const departureAccent = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(0.063, 0.055, 8.3)), cream);
    departureAccent.position.set(1.075, 0.055, 0);
    const departureTactile = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(0.13, 0.035, 8.25)), tactileMaterial);
    departureTactile.position.set(0.91, 0.16, 0);
    departureRoot.add(departurePlatform, departureFascia, departureAccent, departureTactile);
    this.departureDisplay.mesh.position.set(0, 1.25, 1.1);
    this.departureDisplay.mesh.rotation.y = -Math.PI / 2;
    departureRoot.add(this.departureDisplay.mesh);
    placeAlongCurve(departureRoot, this.curve, JOURNEY_RAIL_START, -1.55, 0);
    this.scene.add(departureRoot);

    const platform = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(2.35, 0.2, 10.5)), concrete);
    platform.position.set(-1.22, 0.02, 0);
    platform.receiveShadow = true;
    this.stationRoot.add(platform);
    const platformFascia = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(0.06, 0.25, 10.5)), canopy);
    platformFascia.position.set(-0.035, -0.005, 0);
    const platformAccent = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(0.068, 0.055, 10.25)), cream);
    platformAccent.position.set(-0.002, 0.045, 0);
    const safetyLine = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(0.045, 0.025, 10.1)), safetyLineMaterial);
    safetyLine.position.set(-0.28, 0.143, 0);
    this.stationRoot.add(platformFascia, platformAccent, safetyLine);
    const tactileEdge = new THREE.Mesh(
      this.trackResource(new THREE.BoxGeometry(0.13, 0.045, 10.2)),
      tactileMaterial,
    );
    tactileEdge.position.set(-0.08, 0.145, 0);
    this.stationRoot.add(tactileEdge);
    // Keep the architecture close to the stopping point and station board.
    // Grouping the complete building preserves every facade detail while
    // allowing the camera to stay intimate with the train on arrival.
    const stationBuildingRoot = new THREE.Group();
    stationBuildingRoot.position.x = 1.1;
    stationBuildingRoot.position.z = -0.8;
    const stationBody = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(3.5, 2.2, 3.6)), cream);
    stationBody.position.set(-2.55, 1.18, 1.1);
    stationBody.castShadow = true;
    stationBody.receiveShadow = true;
    const plinth = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(3.58, 0.34, 3.68)), darkConcrete);
    plinth.position.set(-2.55, 0.26, 1.1);
    const wallBand = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(0.055, 0.16, 3.45)), canopy);
    wallBand.position.set(-0.775, 0.56, 1.1);
    const tracksideWallBand = new THREE.Mesh(wallBand.geometry, canopy);
    tracksideWallBand.position.set(-4.325, 0.56, 1.1);

    const roofProfile = new THREE.Shape();
    roofProfile.moveTo(-2.08, 0);
    roofProfile.lineTo(0, 0.88);
    roofProfile.lineTo(2.08, 0);
    roofProfile.lineTo(1.97, -0.11);
    roofProfile.lineTo(0, 0.68);
    roofProfile.lineTo(-1.97, -0.11);
    roofProfile.closePath();
    const roof = new THREE.Mesh(
      this.trackResource(new THREE.ExtrudeGeometry(roofProfile, {
        depth: 4.18,
        bevelEnabled: true,
        bevelThickness: 0.025,
        bevelSize: 0.025,
        bevelSegments: 1,
        curveSegments: 1,
      })),
      roofTile,
    );
    roof.position.set(-2.55, 2.37, -0.99);
    roof.castShadow = true;
    roof.receiveShadow = true;
    const gutterGeometry = this.trackResource(new THREE.BoxGeometry(0.09, 0.11, 4.3));
    const tracksideGutter = new THREE.Mesh(gutterGeometry, trim);
    tracksideGutter.position.set(-0.5, 2.33, 1.1);
    const rearGutter = new THREE.Mesh(gutterGeometry, trim);
    rearGutter.position.set(-4.6, 2.33, 1.1);
    stationBuildingRoot.add(
      stationBody,
      plinth,
      wallBand,
      tracksideWallBand,
      roof,
      tracksideGutter,
      rearGutter,
    );

    const openingGeometry = this.trackResource(new THREE.BoxGeometry(0.032, 1, 1));
    const openings = [
      { y: 1.22, z: -0.12, height: 0.82, width: 0.72, door: false },
      { y: 1.02, z: 1.1, height: 1.46, width: 1.12, door: true },
      { y: 1.22, z: 2.35, height: 0.82, width: 0.68, door: false },
    ];
    const facadeXs = [-0.785, -4.315] as const;
    const glassPanels = new THREE.InstancedMesh(
      openingGeometry,
      stationGlass,
      openings.length * facadeXs.length,
    );
    const frameGeometry = this.trackResource(new THREE.BoxGeometry(0.04, 1, 1));
    const framePieces = new THREE.InstancedMesh(frameGeometry, trim, 36);
    const detailDummy = new THREE.Object3D();
    let frameIndex = 0;
    const addFramePiece = (
      x: number,
      y: number,
      z: number,
      height: number,
      width: number,
    ): void => {
      detailDummy.position.set(x, y, z);
      detailDummy.rotation.set(0, 0, 0);
      detailDummy.scale.set(1, height, width);
      detailDummy.updateMatrix();
      framePieces.setMatrixAt(frameIndex, detailDummy.matrix);
      frameIndex += 1;
    };
    openings.forEach((opening, openingIndex) => {
      facadeXs.forEach((facadeX, facadeIndex) => {
        const outward = facadeIndex === 0 ? 1 : -1;
        const frameX = facadeX + outward * 0.02;
        detailDummy.position.set(facadeX, opening.y, opening.z);
        detailDummy.scale.set(1, opening.height, opening.width);
        detailDummy.updateMatrix();
        glassPanels.setMatrixAt(openingIndex * facadeXs.length + facadeIndex, detailDummy.matrix);
        addFramePiece(frameX, opening.y, opening.z - opening.width * 0.5, opening.height + 0.1, 0.045);
        addFramePiece(frameX, opening.y, opening.z + opening.width * 0.5, opening.height + 0.1, 0.045);
        addFramePiece(frameX, opening.y - opening.height * 0.5, opening.z, 0.045, opening.width + 0.1);
        addFramePiece(frameX, opening.y + opening.height * 0.5, opening.z, 0.045, opening.width + 0.1);
        if (opening.door) addFramePiece(frameX, opening.y, opening.z, opening.height, 0.035);
        else addFramePiece(frameX, opening.y, opening.z, 0.035, opening.width);
      });
    });
    framePieces.count = frameIndex;
    glassPanels.castShadow = false;
    stationBuildingRoot.add(glassPanels, framePieces);

    const interiorMaterial = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0xf2bd76,
      emissive: 0xd4853c,
      emissiveIntensity: 0.42,
      roughness: 0.82,
    }));
    const interiorPanels = new THREE.InstancedMesh(
      openingGeometry,
      interiorMaterial,
      openings.length * facadeXs.length,
    );
    openings.forEach((opening, openingIndex) => {
      facadeXs.forEach((facadeX, facadeIndex) => {
        const outward = facadeIndex === 0 ? 1 : -1;
        detailDummy.position.set(facadeX - outward * 0.026, opening.y, opening.z);
        detailDummy.rotation.set(0, 0, 0);
        detailDummy.scale.set(1, opening.height * 0.82, opening.width * 0.84);
        detailDummy.updateMatrix();
        interiorPanels.setMatrixAt(
          openingIndex * facadeXs.length + facadeIndex,
          detailDummy.matrix,
        );
      });
    });

    const seamMaterial = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0xa9a087,
      roughness: 0.84,
    }));
    const wallSeams = new THREE.InstancedMesh(
      this.trackResource(new THREE.BoxGeometry(0.018, 0.014, 3.42)),
      seamMaterial,
      28,
    );
    let wallSeamIndex = 0;
    facadeXs.forEach((facadeX, facadeIndex) => {
      const outward = facadeIndex === 0 ? 1 : -1;
      for (let row = 0; row < 6; row += 1) {
        detailDummy.position.set(facadeX - outward * 0.008, 0.72 + row * 0.29, 1.1);
        detailDummy.scale.set(1, 1, 1);
        detailDummy.updateMatrix();
        wallSeams.setMatrixAt(wallSeamIndex, detailDummy.matrix);
        wallSeamIndex += 1;
      }
      for (let column = 0; column < 8; column += 1) {
        detailDummy.position.set(
          facadeX - outward * 0.012,
          0.26,
          -0.42 + column * 0.44,
        );
        detailDummy.scale.set(1, 20, 0.02);
        detailDummy.updateMatrix();
        wallSeams.setMatrixAt(wallSeamIndex, detailDummy.matrix);
        wallSeamIndex += 1;
      }
    });

    const roofRidge = new THREE.Mesh(
      this.trackResource(new THREE.BoxGeometry(0.12, 0.12, 4.28)),
      trim,
    );
    roofRidge.position.set(-2.55, 3.27, 1.1);
    const bargeboardGeometry = this.trackResource(new THREE.BoxGeometry(2.26, 0.085, 0.09));
    const bargeboards = new THREE.InstancedMesh(bargeboardGeometry, trim, 4);
    const roofAngle = Math.atan2(0.88, 2.08);
    let bargeboardIndex = 0;
    for (const z of [-1.025, 3.225]) {
      for (const side of [-1, 1] as const) {
        detailDummy.position.set(-2.55 + side * 1.04, 2.81, z);
        detailDummy.rotation.set(0, 0, side === -1 ? roofAngle : -roofAngle);
        detailDummy.scale.set(1, 1, 1);
        detailDummy.updateMatrix();
        bargeboards.setMatrixAt(bargeboardIndex, detailDummy.matrix);
        bargeboardIndex += 1;
      }
    }
    const soffits = new THREE.InstancedMesh(
      this.trackResource(new THREE.BoxGeometry(0.2, 0.07, 4.26)),
      trim,
      2,
    );
    for (const [index, x] of [-4.58, -0.52].entries()) {
      detailDummy.position.set(x, 2.3, 1.1);
      detailDummy.rotation.set(0, 0, 0);
      detailDummy.updateMatrix();
      soffits.setMatrixAt(index, detailDummy.matrix);
    }
    const downspouts = new THREE.InstancedMesh(
      this.trackResource(new THREE.CylinderGeometry(0.035, 0.035, 2.15, 8)),
      trim,
      4,
    );
    let downspoutIndex = 0;
    for (const x of [-4.56, -0.54]) {
      for (const z of [-0.82, 3.02]) {
        detailDummy.position.set(x, 1.18, z);
        detailDummy.rotation.set(0, 0, 0);
        detailDummy.updateMatrix();
        downspouts.setMatrixAt(downspoutIndex, detailDummy.matrix);
        downspoutIndex += 1;
      }
    }
    const doorHandles = new THREE.InstancedMesh(
      this.trackResource(new THREE.BoxGeometry(0.026, 0.34, 0.018)),
      trim,
      6,
    );
    let handleIndex = 0;
    facadeXs.forEach((facadeX, facadeIndex) => {
      const outward = facadeIndex === 0 ? 1 : -1;
      for (const zOffset of [-0.12, 0.12]) {
        detailDummy.position.set(facadeX + outward * 0.035, 1.02, 1.1 + zOffset);
        detailDummy.rotation.set(0, 0, 0);
        detailDummy.scale.set(1, 1, 1);
        detailDummy.updateMatrix();
        doorHandles.setMatrixAt(handleIndex, detailDummy.matrix);
        handleIndex += 1;
      }
      detailDummy.position.set(facadeX + outward * 0.035, 0.295, 1.1);
      detailDummy.rotation.set(Math.PI / 2, 0, 0);
      detailDummy.scale.set(1, 3.5, 1);
      detailDummy.updateMatrix();
      doorHandles.setMatrixAt(handleIndex, detailDummy.matrix);
      handleIndex += 1;
    });
    for (const detail of [bargeboards, soffits, downspouts, doorHandles]) {
      detail.castShadow = quality === 'high';
      detail.receiveShadow = true;
    }
    stationBuildingRoot.add(
      interiorPanels,
      wallSeams,
      roofRidge,
      bargeboards,
      soffits,
      downspouts,
      doorHandles,
    );

    const canopyRoof = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(1.82, 0.12, 5.8)), canopy);
    canopyRoof.position.set(-0.92, 1.9, -0.72);
    canopyRoof.rotation.z = -0.025;
    canopyRoof.castShadow = true;
    canopyRoof.receiveShadow = true;
    this.stationRoot.add(canopyRoof);
    const postGeometry = this.trackResource(new THREE.CylinderGeometry(0.035, 0.047, 1.82, 8));
    const canopyPosts = new THREE.InstancedMesh(postGeometry, canopy, 4);
    for (const [index, z] of [-3.25, -1.58, 0.08, 1.75].entries()) {
      detailDummy.position.set(-1.53, 0.92, z);
      detailDummy.rotation.set(0, 0, 0);
      detailDummy.scale.set(1, 1, 1);
      detailDummy.updateMatrix();
      canopyPosts.setMatrixAt(index, detailDummy.matrix);
    }
    const ribGeometry = this.trackResource(new THREE.BoxGeometry(1.78, 0.055, 0.07));
    const canopyRibs = new THREE.InstancedMesh(ribGeometry, trim, 7);
    for (let index = 0; index < 7; index += 1) {
      detailDummy.position.set(-0.93, 1.815, -3.35 + index * 0.88);
      detailDummy.updateMatrix();
      canopyRibs.setMatrixAt(index, detailDummy.matrix);
    }
    canopyPosts.castShadow = quality === 'high';
    canopyRibs.castShadow = quality === 'high';
    this.stationRoot.add(canopyPosts, canopyRibs);

    const platformJoints = new THREE.InstancedMesh(
      this.trackResource(new THREE.BoxGeometry(2.02, 0.012, 0.018)),
      seamMaterial,
      14,
    );
    for (let index = 0; index < 14; index += 1) {
      detailDummy.position.set(-1.22, 0.128, -4.65 + index * 0.72);
      detailDummy.rotation.set(0, 0, 0);
      detailDummy.scale.set(1, 1, 1);
      detailDummy.updateMatrix();
      platformJoints.setMatrixAt(index, detailDummy.matrix);
    }
    const fasciaRibs = new THREE.InstancedMesh(
      this.trackResource(new THREE.BoxGeometry(0.018, 0.18, 0.055)),
      trim,
      18,
    );
    for (let index = 0; index < 18; index += 1) {
      detailDummy.position.set(-0.072, -0.005, -4.82 + index * 0.57);
      detailDummy.updateMatrix();
      fasciaRibs.setMatrixAt(index, detailDummy.matrix);
    }
    platformJoints.receiveShadow = true;
    fasciaRibs.castShadow = quality === 'high';
    this.stationRoot.add(platformJoints, fasciaRibs);

    const benchSeatGeometry = this.trackResource(new THREE.BoxGeometry(0.48, 0.075, 1.08));
    const benchBackGeometry = this.trackResource(new THREE.BoxGeometry(0.075, 0.46, 1.08));
    const benches = new THREE.InstancedMesh(benchSeatGeometry, canopy, 2);
    const benchBacks = new THREE.InstancedMesh(benchBackGeometry, canopy, 2);
    for (const [index, z] of [-1.45, 0.45].entries()) {
      detailDummy.position.set(-0.5, 0.58, z);
      detailDummy.updateMatrix();
      benches.setMatrixAt(index, detailDummy.matrix);
      detailDummy.position.set(-0.71, 0.79, z);
      detailDummy.updateMatrix();
      benchBacks.setMatrixAt(index, detailDummy.matrix);
    }
    const noticeFrame = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(0.055, 0.78, 0.55)), trim);
    noticeFrame.position.set(-4.35, 1.25, 1.89);
    const noticePanel = new THREE.Mesh(
      this.trackResource(new THREE.BoxGeometry(0.064, 0.65, 0.43)),
      this.trackResource(new THREE.MeshStandardMaterial({ color: 0xe3d9ad, roughness: 0.72 })),
    );
    noticePanel.position.set(-4.386, 1.25, 1.89);
    const equipmentBox = new THREE.Mesh(
      this.trackResource(new THREE.BoxGeometry(0.72, 1.18, 0.55)),
      this.trackResource(new THREE.MeshStandardMaterial({ color: 0xd5d9d5, roughness: 0.54, metalness: 0.28 })),
    );
    equipmentBox.position.set(-4.02, 0.69, -0.88);
    this.stationRoot.add(benches, benchBacks);
    stationBuildingRoot.add(noticeFrame, noticePanel, equipmentBox);
    this.stationRoot.add(stationBuildingRoot);

    // Bring the platform sign close to the stopping point. This lets the final
    // portrait shot stay intimate with the cab while still reading the whole
    // station name, instead of pulling the camera so far back that the train
    // becomes a miniature.
    this.stationDisplay.mesh.position.set(-4, 2.1, -1.2);
    this.stationDisplay.mesh.rotation.y = -Math.PI / 2;
    this.stationDisplay.mesh.scale.setScalar(0.56);
    this.stationRoot.add(this.stationDisplay.mesh);

    const gateColumnGeometry = this.trackResource(new THREE.BoxGeometry(0.13, 2.55, 0.13));
    for (const x of [-1.62, 0.88]) {
      const column = new THREE.Mesh(gateColumnGeometry, canopy);
      column.position.set(x, 1.28, 2.92);
      this.stationRoot.add(column);
    }
    const gateBeam = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(2.72, 0.18, 0.18)), canopy);
    gateBeam.position.set(-0.37, 2.5, 2.92);
    const gateAccent = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(2.35, 0.075, 0.195)), cream);
    gateAccent.position.set(-0.37, 2.34, 2.92);
    this.stationRoot.add(gateBeam, gateAccent);

    const clockFace = new THREE.Mesh(
      this.trackResource(new THREE.CircleGeometry(0.36, 32)),
      this.trackResource(new THREE.MeshBasicMaterial({ color: 0xfff9df, toneMapped: false })),
    );
    clockFace.position.set(-4.32, 2.05, 1.1);
    clockFace.rotation.y = -Math.PI / 2;
    stationBuildingRoot.add(clockFace);

    const balloonGeometry = this.trackResource(new THREE.SphereGeometry(0.18, quality === 'high' ? 16 : 10, quality === 'high' ? 12 : 8));
    const balloonColors = [0xe76550, 0xf0c655, 0x2f8ab4, 0x6db783];
    for (let index = 0; index < 12; index += 1) {
      const material = this.trackResource(new THREE.MeshStandardMaterial({ color: balloonColors[index % balloonColors.length], roughness: 0.48 }));
      const balloon = new THREE.Mesh(balloonGeometry, material);
      const column = index % 6;
      const row = Math.floor(index / 6);
      // Keep the station name sacred: balloons form two bunting rows above
      // the board and sit behind its face instead of covering the day number.
      balloon.position.set(-0.35 + row * 0.24, 3.02 + row * 0.34 + (column % 2) * 0.08, -4.02 + column * 0.38);
      balloon.scale.y = 1.22;
      balloon.visible = false;
      this.stationRoot.add(balloon);
      this.festiveDecorations.push(balloon);
    }
    const lampMaterial = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0xffe8a0,
      emissive: 0xffbd58,
      emissiveIntensity: 1.1,
      roughness: 0.36,
      toneMapped: false,
    }));
    const lampGeometry = this.trackResource(new THREE.SphereGeometry(0.09, 10, 8));
    const platformLamps = new THREE.InstancedMesh(lampGeometry, lampMaterial, 6);
    for (const [index, z] of [-3.35, -2.3, -1.25, -0.2, 0.85, 1.9].entries()) {
      detailDummy.position.set(-0.48, 1.76, z);
      detailDummy.scale.set(1, 0.5, 1.5);
      detailDummy.updateMatrix();
      platformLamps.setMatrixAt(index, detailDummy.matrix);
    }
    this.stationRoot.add(platformLamps);
    placeAlongCurve(this.stationRoot, this.curve, BIRTHDAY_STATION_RAIL, -1.82, 0);
    this.stationRoot.updateMatrixWorld(true);
    this.stationRoot.getWorldPosition(this.stationGlow.position);
    this.stationGlow.position.y += 3.2;
    this.scene.add(this.stationRoot);
  }

  private createConfetti(quality: TrainQuality): ConfettiState {
    const count = quality === 'high' ? 220 : quality === 'balanced' ? 150 : 80;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocity = new Float32Array(count * 3);
    const palette = [new THREE.Color(0xf0c655), new THREE.Color(0xe76550), new THREE.Color(0x2f8ab4), new THREE.Color(0x6db783), new THREE.Color(0xfaf5db)];
    for (let index = 0; index < count; index += 1) {
      const color = palette[index % palette.length];
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    const geometry = this.trackResource(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = this.trackResource(new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    const points = new THREE.Points(geometry, material);
    points.visible = false;
    return { points, velocity, life: 0 };
  }

  setStations(fromDays: number, toDays: number): void {
    const rangeKey = `${fromDays}:${toDays}`;
    if (this.stationRangeKey === rangeKey) return;
    this.stationRangeKey = rangeKey;
    paintStationDisplay(this.departureDisplay, fromDays, true);
    paintStationDisplay(this.stationDisplay, toDays, false);
    const close = toDays <= 14;
    const veryClose = toDays <= 3;
    const visibleCount = toDays === 0 ? 12 : veryClose ? 9 : toDays <= 7 ? 6 : close ? 3 : 0;
    this.festiveDecorations.forEach((decoration, index) => {
      decoration.visible = index < visibleCount;
    });
    this.stationGlow.intensity = toDays === 0 ? 18 : veryClose ? 10 : toDays <= 7 ? 5 : close ? 2 : 0;
    this.renderer.shadowMap.needsUpdate = true;
    this.invalidate();
  }

  getJourneyDistance(): number {
    return this.curveLength * (JOURNEY_RAIL_END - JOURNEY_RAIL_START);
  }

  setProgress(value: number): void {
    this.journeyProgress = THREE.MathUtils.clamp(value, 0, 1);
    const railAmount = THREE.MathUtils.lerp(JOURNEY_RAIL_START, JOURNEY_RAIL_END, this.journeyProgress);
    // Reuse the leading-car route samples: setProgress runs every animation
    // tick, so allocating two vectors here would create avoidable GC pressure.
    const point = this.curve.getPointAt(railAmount, this.journeyPoint);
    const tangent = this.curve.getTangentAt(railAmount, this.journeyTangent).normalize();
    const normal = this.scratchNormal.set(-tangent.z, 0, tangent.x).normalize();
    this.formation.root.position.set(0, 0, 0);
    this.formation.root.quaternion.identity();
    this.formation.cars.forEach((_car, index) => {
      const carAmount = THREE.MathUtils.clamp(
        railAmount - this.formationOffsets[index] / this.curveLength,
        0,
        1,
      );
      const carPoint = this.curve.getPointAt(carAmount, this.carPoints[index]);
      const carTangent = this.curve.getTangentAt(carAmount, this.carTangents[index]).normalize();
      // The wheel bottom sits 0.008 units below each car origin. With the rail
      // head topping out near 0.113, a 0.102 lift gives a slight, stable visual
      // overlap instead of the old 0.1-unit air gap.
      carPoint.y += 0.102;
      this.carQuaternions[index].setFromUnitVectors(FORWARD, carTangent);
      this.formation.setCarPose(index, carPoint, this.carQuaternions[index]);
    });

    // A three-shot camera move: admire the leading cab, pace the consist,
    // then widen to hold both the train and the approaching station in frame.
    const rig = calculateCameraRig(this.journeyProgress);
    this.desiredCamera.copy(point)
      .addScaledVector(normal, rig.lateral)
      .addScaledVector(tangent, rig.longitudinal);
    this.desiredCamera.y += rig.height;
    this.lookTarget.copy(point).addScaledVector(
      tangent,
      rig.targetForward,
    );
    if (rig.approachBlend > 0) {
      this.curve.getPointAt(BIRTHDAY_STATION_RAIL, this.scratchStationPoint);
      this.lookTarget.lerp(this.scratchStationPoint, rig.stationBlend);
    }
    this.lookTarget.addScaledVector(normal, rig.targetLateral);
    this.lookTarget.y += rig.targetHeight;
    if (!this.running) {
      this.camera.position.copy(this.desiredCamera);
      this.camera.lookAt(this.lookTarget);
    }
    this.invalidate();
  }

  setMotion(running: boolean, speed: number): void {
    this.running = running;
    this.speed = Math.max(0, speed);
    this.formation.setLights(running || this.journeyProgress > 0.9);
    this.invalidate();
  }

  celebrate(): void {
    const geometry = this.confetti.points.geometry;
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const origin = this.curve.getPointAt(BIRTHDAY_STATION_RAIL);
    const random = seededRandom(Date.now());
    for (let index = 0; index < positions.count; index += 1) {
      positions.setXYZ(index, origin.x, origin.y + 2.6, origin.z);
      this.confetti.velocity[index * 3] = (random() - 0.5) * 5.5;
      this.confetti.velocity[index * 3 + 1] = 2.5 + random() * 4.8;
      this.confetti.velocity[index * 3 + 2] = (random() - 0.5) * 5.2;
    }
    positions.needsUpdate = true;
    this.confetti.life = 3.2;
    this.confetti.points.visible = true;
    this.invalidate();
  }

  private updateConfetti(delta: number): void {
    if (this.confetti.life <= 0) return;
    const positions = this.confetti.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index += 1) {
      this.confetti.velocity[index * 3 + 1] -= 4.8 * delta;
      positions.setXYZ(
        index,
        positions.getX(index) + this.confetti.velocity[index * 3] * delta,
        positions.getY(index) + this.confetti.velocity[index * 3 + 1] * delta,
        positions.getZ(index) + this.confetti.velocity[index * 3 + 2] * delta,
      );
    }
    positions.needsUpdate = true;
    this.confetti.life -= delta;
    if (this.confetti.life <= 0) this.confetti.points.visible = false;
  }

  private adaptRenderScale(frameTime: number): void {
    if (!this.running || this.quality === 'low') {
      this.previousFrameTime = 0;
      this.continuousFrameCount = 0;
      this.frameIntervalAverage = 1000 / 60;
      return;
    }
    if (this.previousFrameTime > 0) {
      const interval = Math.min(50, frameTime - this.previousFrameTime);
      this.frameIntervalAverage += (interval - this.frameIntervalAverage) * 0.08;
      this.continuousFrameCount += 1;
    }
    this.previousFrameTime = frameTime;

    // Step down once after a sustained sub-50-fps interval. A single buffer
    // reallocation is less disruptive than several small reallocations during
    // the same journey, while the floor still preserves the scene's detail.
    if (
      this.continuousFrameCount >= 48
      && this.frameIntervalAverage > 20
      && this.pixelRatio > this.minimumPixelRatio
    ) {
      this.pixelRatio = this.minimumPixelRatio;
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.domElement.dataset.renderScale = this.pixelRatio.toFixed(2);
      this.continuousFrameCount = 0;
      this.frameIntervalAverage = 1000 / 60;
    }
  }

  private frame = (frameTime: number): void => {
    this.animationFrame = 0;
    if (this.disposed || this.suspended) return;
    // Visibility resumes reset the clock explicitly, so normal slow frames can
    // safely retain up to 100 ms instead of silently losing animation time
    // below 20 fps. Formation updates use the same bounded maximum.
    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.formation.update(delta, this.speed);
    this.updateConfetti(delta);
    const damping = 1 - Math.exp(-delta * (this.reducedMotion ? 14 : 5.8));
    this.camera.position.lerp(this.desiredCamera, damping);
    this.camera.getWorldDirection(this.scratchDirection);
    this.scratchCameraTarget.copy(this.camera.position)
      .add(this.scratchDirection.multiplyScalar(10))
      .lerp(this.lookTarget, damping);
    this.camera.lookAt(this.scratchCameraTarget);
    this.renderer.render(this.scene, this.camera);
    this.adaptRenderScale(frameTime);
    this.camera.getWorldDirection(this.scratchDirection);
    this.scratchDesiredDirection.copy(this.lookTarget).sub(this.camera.position).normalize();
    const cameraMoving = this.camera.position.distanceToSquared(this.desiredCamera) > 0.00001
      || this.scratchDirection.angleTo(this.scratchDesiredDirection) > 0.0005;
    if (this.running || this.confetti.life > 0 || cameraMoving) this.invalidate();
  };

  private invalidate(): void {
    if (!this.started || this.disposed || this.animationFrame) return;
    this.animationFrame = window.requestAnimationFrame(this.frame);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.clock.start();
    this.invalidate();
  }

  setSuspended(suspended: boolean): void {
    if (this.disposed || this.suspended === suspended) return;
    this.suspended = suspended;
    this.previousFrameTime = 0;
    this.continuousFrameCount = 0;
    this.frameIntervalAverage = 1000 / 60;
    if (suspended) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
      this.clock.stop();
      return;
    }
    this.clock.start();
    this.invalidate();
  }

  resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.fov = width < 600 ? 52 : 42;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.started = false;
    window.cancelAnimationFrame(this.animationFrame);
    this.formation.dispose();
    this.resources.forEach((resource) => resource.dispose());
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
