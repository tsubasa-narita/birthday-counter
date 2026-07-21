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

function offsetCurve(source: THREE.Curve<THREE.Vector3>, offset: number): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = [];
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let index = 0; index <= 72; index += 1) {
    const amount = index / 72;
    const point = source.getPointAt(amount);
    source.getTangentAt(amount, tangent).normalize();
    normal.set(-tangent.z, 0, tangent.x).normalize();
    points.push(point.addScaledVector(normal, offset));
  }
  return new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
}

function createStationDisplay(): StationDisplay {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 360;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.55, 1.24), material);
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
  private readonly resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  private readonly clock = new THREE.Clock();
  private readonly lookTarget = new THREE.Vector3();
  private readonly desiredCamera = new THREE.Vector3();
  private readonly scratchNormal = new THREE.Vector3();
  private readonly scratchDirection = new THREE.Vector3();
  private readonly scratchCameraTarget = new THREE.Vector3();
  private readonly scratchStationPoint = new THREE.Vector3();
  private readonly confetti: ConfettiState;
  private animationFrame = 0;
  private journeyProgress = 0;
  private speed = 0;
  private running = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, formation: E235Formation, options: RailwayWorldOptions) {
    this.formation = formation;
    this.formationOffsets = formation.cars.map((car) => Math.max(0, -car.position.z));
    this.carPoints = formation.cars.map(() => new THREE.Vector3());
    this.carTangents = formation.cars.map(() => new THREE.Vector3());
    this.carQuaternions = formation.cars.map(() => new THREE.Quaternion());
    this.reducedMotion = options.reducedMotion;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: options.quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.quality === 'high' ? 1.7 : 1.35));
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
  }

  private trackResource<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(resource: T): T {
    this.resources.add(resource);
    return resource;
  }

  private createLighting(quality: TrainQuality): void {
    const hemisphere = new THREE.HemisphereLight(0xcce9ff, 0x567246, 2.2);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xfff3ce, quality === 'low' ? 2.4 : 3.2);
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
    this.scene.add(sun);
    this.stationGlow.position.set(0, 4, 32);
    this.scene.add(this.stationGlow);
  }

  private createLandscape(quality: TrainQuality): void {
    const groundGeometry = this.trackResource(new THREE.PlaneGeometry(92, 144, 34, 54));
    const groundPositions = groundGeometry.getAttribute('position') as THREE.BufferAttribute;
    const groundColors = new Float32Array(groundPositions.count * 3);
    const grassDark = new THREE.Color(0x557a52);
    const grassLight = new THREE.Color(0x86a975);
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
      roughness: 0.96,
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
    walls.instanceColor!.needsUpdate = true;
    walls.castShadow = quality === 'high';
    walls.receiveShadow = true;
    roofs.castShadow = quality === 'high';
    this.scene.add(walls, roofs);

    const rockCount = quality === 'low' ? 18 : 34;
    const rocks = new THREE.InstancedMesh(
      this.trackResource(new THREE.DodecahedronGeometry(0.38, quality === 'high' ? 1 : 0)),
      this.trackResource(new THREE.MeshStandardMaterial({ color: 0x687b76, roughness: 0.96 })),
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
    rocks.receiveShadow = true;
    this.scene.add(rocks);
  }

  private createTrack(quality: TrainQuality): void {
    const ballastMaterial = this.trackResource(new THREE.MeshStandardMaterial({ color: 0x71675a, roughness: 1 }));
    const railMaterial = this.trackResource(new THREE.MeshStandardMaterial({ color: 0xaeb7bb, roughness: 0.27, metalness: 0.88 }));
    const sleeperMaterial = this.trackResource(new THREE.MeshStandardMaterial({ color: 0x5f4a38, roughness: 0.92 }));
    const ballast = new THREE.Mesh(
      this.trackResource(new THREE.TubeGeometry(this.curve, quality === 'low' ? 90 : 160, 0.56, 10, false)),
      ballastMaterial,
    );
    ballast.scale.y = 0.26;
    ballast.position.y = -0.03;
    ballast.receiveShadow = true;
    this.scene.add(ballast);

    const gauge = 0.31;
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(
        this.trackResource(new THREE.TubeGeometry(offsetCurve(this.curve, gauge * side), quality === 'low' ? 100 : 190, 0.025, 8, false)),
        railMaterial,
      );
      rail.castShadow = true;
      this.scene.add(rail);
    }

    const sleeperCount = quality === 'low' ? 74 : 112;
    const sleeperGeometry = this.trackResource(new THREE.BoxGeometry(1.05, 0.06, 0.12));
    const sleepers = new THREE.InstancedMesh(sleeperGeometry, sleeperMaterial, sleeperCount);
    const dummy = new THREE.Object3D();
    const tangent = new THREE.Vector3();
    for (let index = 0; index < sleeperCount; index += 1) {
      const amount = index / (sleeperCount - 1);
      const point = this.curve.getPointAt(amount);
      this.curve.getTangentAt(amount, tangent).normalize();
      dummy.position.copy(point);
      dummy.position.y -= 0.015;
      dummy.quaternion.setFromUnitVectors(FORWARD, tangent);
      dummy.updateMatrix();
      sleepers.setMatrixAt(index, dummy.matrix);
    }
    sleepers.receiveShadow = true;
    this.scene.add(sleepers);
  }

  private createCatenary(quality: TrainQuality): void {
    if (quality === 'low') return;
    const metal = this.trackResource(new THREE.MeshStandardMaterial({ color: 0x67777c, roughness: 0.6, metalness: 0.72 }));
    const poleGeometry = this.trackResource(new THREE.CylinderGeometry(0.035, 0.05, 3.2, 8));
    const armGeometry = this.trackResource(new THREE.BoxGeometry(1.55, 0.045, 0.045));
    const poleCount = quality === 'high' ? 19 : 14;
    const poles = new THREE.InstancedMesh(poleGeometry, metal, poleCount);
    const arms = new THREE.InstancedMesh(armGeometry, metal, poleCount);
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
      localMatrix.makeTranslation(0, 1.58, 0);
      worldMatrix.multiplyMatrices(baseMatrix, localMatrix);
      poles.setMatrixAt(index, worldMatrix);
      localMatrix.makeTranslation(-0.72, 3.05, 0);
      worldMatrix.multiplyMatrices(baseMatrix, localMatrix);
      arms.setMatrixAt(index, worldMatrix);
    }
    poles.castShadow = quality === 'high';
    arms.castShadow = quality === 'high';
    this.scene.add(poles, arms);

    const contactPoints: THREE.Vector3[] = [];
    const messengerPoints: THREE.Vector3[] = [];
    for (let index = 0; index <= 80; index += 1) {
      const amount = index / 80;
      const contact = this.curve.getPointAt(amount);
      contact.y += 2.86;
      contactPoints.push(contact);
      const messenger = contact.clone();
      messenger.y += 0.23 + Math.sin(amount * Math.PI * poleCount) * 0.045;
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
    this.scene.add(contactWire, messengerWire);
  }

  private createScenicDetails(quality: TrainQuality): void {
    const stone = this.trackResource(new THREE.MeshStandardMaterial({ color: 0x8b918a, roughness: 0.94 }));
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
    const concrete = this.trackResource(new THREE.MeshStandardMaterial({ color: 0xc9c5b6, roughness: 0.9 }));
    const canopy = this.trackResource(new THREE.MeshStandardMaterial({ color: 0x1b6083, roughness: 0.45, metalness: 0.28 }));
    const cream = this.trackResource(new THREE.MeshStandardMaterial({ color: 0xeee1b9, roughness: 0.78 }));
    const coral = this.trackResource(new THREE.MeshStandardMaterial({ color: 0xe5634c, roughness: 0.56 }));

    const departureRoot = new THREE.Group();
    const departurePlatform = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(2.1, 0.18, 8.5)), concrete);
    departurePlatform.position.y = 0.05;
    departurePlatform.receiveShadow = true;
    departureRoot.add(departurePlatform);
    this.departureDisplay.mesh.position.set(0, 1.25, 1.1);
    this.departureDisplay.mesh.rotation.y = Math.PI / 2;
    departureRoot.add(this.departureDisplay.mesh);
    placeAlongCurve(departureRoot, this.curve, JOURNEY_RAIL_START, -1.55, 0);
    this.scene.add(departureRoot);

    const platform = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(2.35, 0.2, 10.5)), concrete);
    platform.position.set(-1.22, 0.02, 0);
    platform.receiveShadow = true;
    this.stationRoot.add(platform);
    const tactileEdge = new THREE.Mesh(
      this.trackResource(new THREE.BoxGeometry(0.13, 0.045, 10.2)),
      this.trackResource(new THREE.MeshStandardMaterial({ color: 0xf0c655, roughness: 0.7 })),
    );
    tactileEdge.position.set(-0.08, 0.145, 0);
    this.stationRoot.add(tactileEdge);
    const stationBody = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(3.5, 2.2, 3.6)), cream);
    stationBody.position.set(-2.55, 1.18, 1.1);
    stationBody.castShadow = true;
    const roof = new THREE.Mesh(this.trackResource(new THREE.ConeGeometry(2.8, 1.35, 4)), coral);
    roof.position.set(-2.55, 2.92, 1.1);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    this.stationRoot.add(stationBody, roof);
    const stationGlass = this.trackResource(new THREE.MeshStandardMaterial({
      color: 0x173d52,
      roughness: 0.2,
      metalness: 0.18,
      emissive: 0x123145,
      emissiveIntensity: 0.24,
    }));
    for (const z of [0.15, 1.35, 2.05]) {
      const window = new THREE.Mesh(
        this.trackResource(new THREE.BoxGeometry(0.035, 0.58, z === 2.05 ? 0.52 : 0.74)),
        stationGlass,
      );
      window.position.set(-0.79, 1.25, z);
      this.stationRoot.add(window);
    }
    const canopyRoof = new THREE.Mesh(this.trackResource(new THREE.BoxGeometry(1.75, 0.12, 5.2)), canopy);
    canopyRoof.position.set(-0.98, 1.78, -1.1);
    canopyRoof.castShadow = true;
    this.stationRoot.add(canopyRoof);
    const postGeometry = this.trackResource(new THREE.CylinderGeometry(0.035, 0.045, 1.75, 8));
    for (const z of [-3.1, -1.25, 0.62]) {
      const post = new THREE.Mesh(postGeometry, canopy);
      post.position.set(-1.52, 0.88, z);
      this.stationRoot.add(post);
    }
    this.stationDisplay.mesh.position.set(-0.72, 1.68, -1.18);
    this.stationDisplay.mesh.rotation.y = Math.PI / 2;
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
    clockFace.position.set(-0.78, 2.05, 1.1);
    clockFace.rotation.y = Math.PI / 2;
    this.stationRoot.add(clockFace);

    const balloonGeometry = this.trackResource(new THREE.SphereGeometry(0.18, quality === 'high' ? 16 : 10, quality === 'high' ? 12 : 8));
    const balloonColors = [0xe76550, 0xf0c655, 0x2f8ab4, 0x6db783];
    for (let index = 0; index < 12; index += 1) {
      const material = this.trackResource(new THREE.MeshStandardMaterial({ color: balloonColors[index % balloonColors.length], roughness: 0.48 }));
      const balloon = new THREE.Mesh(balloonGeometry, material);
      const side = index % 2 === 0 ? -1 : 1;
      balloon.position.set(-1.4 - (index % 4) * 0.55, 2.3 + (index % 3) * 0.3, -2.1 + side * (0.5 + Math.floor(index / 4) * 0.42));
      balloon.scale.y = 1.22;
      balloon.visible = false;
      this.stationRoot.add(balloon);
      this.festiveDecorations.push(balloon);
    }
    const lampMaterial = this.trackResource(new THREE.MeshBasicMaterial({ color: 0xffe9a8, toneMapped: false }));
    const lampGeometry = this.trackResource(new THREE.SphereGeometry(0.09, 10, 8));
    for (const z of [-3.6, -2.2, -0.8, 0.6, 2, 3.4]) {
      const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
      lamp.position.set(-0.45, 2.02, z);
      this.stationRoot.add(lamp);
    }
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
    paintStationDisplay(this.departureDisplay, fromDays, true);
    paintStationDisplay(this.stationDisplay, toDays, false);
    const close = toDays <= 14;
    const veryClose = toDays <= 3;
    const visibleCount = toDays === 0 ? 12 : veryClose ? 9 : toDays <= 7 ? 6 : close ? 3 : 0;
    this.festiveDecorations.forEach((decoration, index) => {
      decoration.visible = index < visibleCount;
    });
    this.stationGlow.intensity = toDays === 0 ? 18 : veryClose ? 10 : toDays <= 7 ? 5 : close ? 2 : 0;
  }

  setProgress(value: number): void {
    this.journeyProgress = THREE.MathUtils.clamp(value, 0, 1);
    const railAmount = THREE.MathUtils.lerp(JOURNEY_RAIL_START, JOURNEY_RAIL_END, this.journeyProgress);
    const point = this.curve.getPointAt(railAmount);
    const tangent = this.curve.getTangentAt(railAmount).normalize();
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
      carPoint.y += 0.22;
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
    this.lookTarget.y += rig.targetHeight;
    if (!this.running) {
      this.camera.position.copy(this.desiredCamera);
      this.camera.lookAt(this.lookTarget);
    }
  }

  setMotion(running: boolean, speed: number): void {
    this.running = running;
    this.speed = Math.max(0, speed);
    this.formation.setLights(running || this.journeyProgress > 0.9);
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

  private frame = (): void => {
    if (this.disposed) return;
    const delta = Math.min(this.clock.getDelta(), 0.05);
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
    this.animationFrame = window.requestAnimationFrame(this.frame);
  };

  start(): void {
    if (this.animationFrame) return;
    this.clock.start();
    this.animationFrame = window.requestAnimationFrame(this.frame);
  }

  resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.fov = width < 600 ? 50 : 42;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.cancelAnimationFrame(this.animationFrame);
    this.formation.dispose();
    this.resources.forEach((resource) => resource.dispose());
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
