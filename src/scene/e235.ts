import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type TrainQuality = 'high' | 'balanced' | 'low';

export interface E235Options {
  quality?: TrainQuality;
  carCount?: 4 | 11 | 15;
}

export interface E235Formation {
  root: THREE.Group;
  cars: THREE.Group[];
  wheels: THREE.Object3D[];
  headlights: THREE.Mesh[];
  destinationCanvas: HTMLCanvasElement;
  destinationTexture: THREE.CanvasTexture;
  setDestination(text: string): void;
  setLights(on: boolean): void;
  setCarPose(index: number, position: THREE.Vector3, quaternion: THREE.Quaternion): void;
  update(deltaSeconds: number, speed: number): void;
  dispose(): void;
}

const METRES_TO_UNITS = 0.12;
const CAR_LENGTH = 20 * METRES_TO_UNITS;
const CAR_WIDTH = 2.95 * METRES_TO_UNITS;
const CAR_HEIGHT = 3.6 * METRES_TO_UNITS;
const CAR_GAP = 0.052;
const CAR_PITCH = CAR_LENGTH + CAR_GAP;
const CAB_FACE_OFFSET = 0.039;
const BODY_BOTTOM = 0.122;
const BODY_CENTRE_Y = BODY_BOTTOM + CAR_HEIGHT * 0.5;
const ROOF_Y = BODY_BOTTOM + CAR_HEIGHT;
const WHEEL_RADIUS = 0.052;
const WHEEL_CENTRE_Y = 0.06;
const TAU = Math.PI * 2;

export const E235_DIMENSIONS = Object.freeze({
  carLength: CAR_LENGTH,
  carPitch: CAR_PITCH,
  cabFaceOffset: CAB_FACE_OFFSET,
});

interface QualityProfile {
  windowBays: number;
  curveSegments: number;
  wheelSegments: number;
  pantographSegments: number;
  roofBoxes: number;
  castDetailShadows: boolean;
}

interface TrainMaterials {
  steel: THREE.MeshPhysicalMaterial;
  steelTrim: THREE.MeshStandardMaterial;
  steelDark: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  underbody: THREE.MeshStandardMaterial;
  underbodyMid: THREE.MeshStandardMaterial;
  underbodyLight: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  window: THREE.MeshStandardMaterial;
  blue: THREE.MeshStandardMaterial;
  cream: THREE.MeshStandardMaterial;
  blackMask: THREE.MeshPhysicalMaterial;
  panelLine: THREE.MeshStandardMaterial;
  headlight: THREE.MeshStandardMaterial;
  tailLight: THREE.MeshStandardMaterial;
  destination: THREE.MeshBasicMaterial;
}

interface GeometryBank {
  body: RoundedBoxGeometry;
  greenBody: RoundedBoxGeometry;
  roof: RoundedBoxGeometry;
  skirt: THREE.BoxGeometry;
  sideBand: THREE.BoxGeometry;
  window: RoundedBoxGeometry;
  windowFrame: RoundedBoxGeometry;
  greenWindow: RoundedBoxGeometry;
  greenWindowFrame: RoundedBoxGeometry;
  door: RoundedBoxGeometry;
  doorFrame: RoundedBoxGeometry;
  doorWindow: RoundedBoxGeometry;
  panelSeam: THREE.BoxGeometry;
  underbox: RoundedBoxGeometry;
  cabSurround: RoundedBoxGeometry;
  cabMask: RoundedBoxGeometry;
  cabGlass: RoundedBoxGeometry;
  cabMullion: THREE.BoxGeometry;
  lamp: RoundedBoxGeometry;
  lampBezel: RoundedBoxGeometry;
  destination: THREE.PlaneGeometry;
  bogieSide: RoundedBoxGeometry;
  axleBox: THREE.BoxGeometry;
  airSpring: THREE.CylinderGeometry;
  wheel: THREE.CylinderGeometry;
  wheelRim: THREE.CylinderGeometry;
  tank: THREE.CylinderGeometry;
  equipment: RoundedBoxGeometry;
  roofFan: THREE.CylinderGeometry;
  roofGrille: THREE.BoxGeometry;
  beam: THREE.CylinderGeometry;
  insulator: THREE.CylinderGeometry;
  contactStrip: RoundedBoxGeometry;
  coupler: THREE.BoxGeometry;
  cabBrow: RoundedBoxGeometry;
  cabCheek: RoundedBoxGeometry;
  frontSkirt: RoundedBoxGeometry;
  couplerPocket: RoundedBoxGeometry;
  obstacleDeflector: RoundedBoxGeometry;
}

interface WheelRecord {
  object: THREE.Object3D;
  car: THREE.Group;
  baseQuaternion: THREE.Quaternion;
}

const QUALITY_PROFILES: Record<TrainQuality, QualityProfile> = {
  high: {
    windowBays: 8,
    curveSegments: 5,
    wheelSegments: 20,
    pantographSegments: 10,
    roofBoxes: 3,
    castDetailShadows: true,
  },
  balanced: {
    windowBays: 6,
    curveSegments: 3,
    wheelSegments: 14,
    pantographSegments: 8,
    roofBoxes: 2,
    castDetailShadows: false,
  },
  low: {
    windowBays: 4,
    curveSegments: 2,
    wheelSegments: 8,
    pantographSegments: 6,
    roofBoxes: 1,
    castDetailShadows: false,
  },
};

function createDestinationDisplay(): {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return { canvas, texture };
}

function drawDestination(
  canvas: HTMLCanvasElement,
  texture: THREE.CanvasTexture,
  text: string,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;

  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#06100d';
  context.fillRect(0, 0, width, height);

  const railGradient = context.createLinearGradient(0, 0, width, 0);
  railGradient.addColorStop(0, '#4cf2ad');
  railGradient.addColorStop(0.52, '#f3e8a5');
  railGradient.addColorStop(1, '#3bb8ec');
  context.fillStyle = railGradient;
  context.fillRect(0, 0, width, 18);
  context.fillRect(0, height - 12, width, 12);

  const label = text.trim() || 'たんじょうび号';
  let fontSize = 116;
  const fontFamily = '"Noto Sans JP", "Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif';
  do {
    context.font = `800 ${fontSize}px ${fontFamily}`;
    fontSize -= 4;
  } while (context.measureText(label).width > width - 90 && fontSize > 48);

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = 10;
  context.strokeStyle = 'rgba(0, 0, 0, 0.82)';
  context.strokeText(label, width * 0.5, height * 0.54);
  context.shadowColor = 'rgba(91, 255, 189, 0.78)';
  context.shadowBlur = 18;
  context.fillStyle = '#f8ffe7';
  context.fillText(label, width * 0.5, height * 0.54);
  context.shadowBlur = 0;
  texture.needsUpdate = true;
}

function createSteelSurfaceTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#b8b8b8';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Broad, low-contrast zones keep neighbouring stainless panels from reading
    // as one flat plastic extrusion. Thin horizontal strokes form the hairline.
    for (let panel = 0; panel < 8; panel += 1) {
      const x = panel * 32;
      const shade = panel % 3 === 0 ? 8 : panel % 3 === 1 ? -5 : 2;
      context.fillStyle = `rgb(${184 + shade}, ${184 + shade}, ${184 + shade})`;
      context.fillRect(x, 0, 32, canvas.height);
    }
    for (let y = 0; y < canvas.height; y += 2) {
      const value = 151 + ((y * 17) % 29);
      context.fillStyle = `rgba(${value}, ${value}, ${value}, ${y % 6 === 0 ? 0.28 : 0.14})`;
      context.fillRect(0, y, canvas.width, 1);
    }
    for (let x = 13; x < canvas.width; x += 37) {
      const gradient = context.createLinearGradient(x - 5, 0, x + 7, 0);
      gradient.addColorStop(0, 'rgba(70, 74, 76, 0)');
      gradient.addColorStop(0.5, 'rgba(70, 74, 76, 0.12)');
      gradient.addColorStop(1, 'rgba(70, 74, 76, 0)');
      context.fillStyle = gradient;
      context.fillRect(x - 5, 0, 12, canvas.height);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'procedural stainless hairline roughness';
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 7);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createMaterials(
  destinationTexture: THREE.CanvasTexture,
  steelSurfaceTexture: THREE.CanvasTexture,
): TrainMaterials {
  return {
    steel: new THREE.MeshPhysicalMaterial({
      color: 0xc3cbcd,
      metalness: 0.91,
      roughness: 0.26,
      roughnessMap: steelSurfaceTexture,
      bumpMap: steelSurfaceTexture,
      bumpScale: 0.0024,
      clearcoat: 0.08,
      clearcoatRoughness: 0.42,
      envMapIntensity: 1.34,
    }),
    steelTrim: new THREE.MeshStandardMaterial({
      color: 0xd8dfe0,
      metalness: 0.89,
      roughness: 0.25,
      roughnessMap: steelSurfaceTexture,
      bumpMap: steelSurfaceTexture,
      bumpScale: 0.0016,
      envMapIntensity: 1.24,
    }),
    steelDark: new THREE.MeshStandardMaterial({
      color: 0x828e92,
      metalness: 0.82,
      roughness: 0.38,
      roughnessMap: steelSurfaceTexture,
      envMapIntensity: 1.05,
    }),
    roof: new THREE.MeshStandardMaterial({
      color: 0x939da0,
      metalness: 0.65,
      roughness: 0.52,
    }),
    underbody: new THREE.MeshStandardMaterial({
      color: 0x161c1f,
      metalness: 0.62,
      roughness: 0.56,
    }),
    underbodyMid: new THREE.MeshStandardMaterial({
      color: 0x303a3e,
      metalness: 0.55,
      roughness: 0.5,
    }),
    underbodyLight: new THREE.MeshStandardMaterial({
      color: 0x566267,
      metalness: 0.7,
      roughness: 0.42,
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x080b0c,
      metalness: 0.08,
      roughness: 0.82,
    }),
    window: new THREE.MeshStandardMaterial({
      color: 0x101f28,
      emissive: 0x739a98,
      emissiveIntensity: 0.045,
      metalness: 0.34,
      roughness: 0.2,
      envMapIntensity: 0.78,
    }),
    blue: new THREE.MeshStandardMaterial({
      color: 0x126489,
      metalness: 0.38,
      roughness: 0.34,
    }),
    cream: new THREE.MeshStandardMaterial({
      color: 0xe5dab0,
      metalness: 0.18,
      roughness: 0.44,
    }),
    blackMask: new THREE.MeshPhysicalMaterial({
      color: 0x050b10,
      metalness: 0.35,
      roughness: 0.16,
      clearcoat: 0.62,
      clearcoatRoughness: 0.16,
      envMapIntensity: 0.72,
    }),
    panelLine: new THREE.MeshStandardMaterial({
      color: 0x546167,
      metalness: 0.66,
      roughness: 0.48,
    }),
    headlight: new THREE.MeshStandardMaterial({
      color: 0xfff6cf,
      emissive: 0xffe39a,
      emissiveIntensity: 0.12,
      roughness: 0.23,
    }),
    tailLight: new THREE.MeshStandardMaterial({
      color: 0x6e0808,
      emissive: 0xff1a12,
      emissiveIntensity: 0.08,
      roughness: 0.25,
    }),
    destination: new THREE.MeshBasicMaterial({
      map: destinationTexture,
      toneMapped: false,
    }),
  };
}

function createGeometryBank(profile: QualityProfile): GeometryBank {
  const radius = 0.038;
  return {
    body: new RoundedBoxGeometry(
      CAR_WIDTH,
      CAR_HEIGHT,
      CAR_LENGTH,
      profile.curveSegments,
      radius,
    ),
    greenBody: new RoundedBoxGeometry(
      CAR_WIDTH,
      CAR_HEIGHT * 1.035,
      CAR_LENGTH,
      profile.curveSegments,
      radius,
    ),
    roof: new RoundedBoxGeometry(
      CAR_WIDTH * 0.89,
      0.055,
      CAR_LENGTH * 0.93,
      Math.max(2, profile.curveSegments - 1),
      0.02,
    ),
    skirt: new THREE.BoxGeometry(CAR_WIDTH * 0.94, 0.075, CAR_LENGTH * 0.9),
    sideBand: new THREE.BoxGeometry(0.012, 1, 1),
    window: new RoundedBoxGeometry(0.011, 0.118, 0.16, 2, 0.012),
    windowFrame: new RoundedBoxGeometry(0.01, 0.137, 0.179, 2, 0.014),
    greenWindow: new RoundedBoxGeometry(0.011, 0.083, 0.185, 2, 0.01),
    greenWindowFrame: new RoundedBoxGeometry(0.01, 0.098, 0.201, 2, 0.012),
    door: new RoundedBoxGeometry(0.012, 0.265, 0.205, 2, 0.008),
    doorFrame: new RoundedBoxGeometry(0.01, 0.282, 0.222, 2, 0.01),
    doorWindow: new RoundedBoxGeometry(0.013, 0.112, 0.145, 2, 0.007),
    panelSeam: new THREE.BoxGeometry(0.009, 0.295, 0.006),
    underbox: new RoundedBoxGeometry(0.23, 0.082, 0.34, 2, 0.014),
    cabSurround: new RoundedBoxGeometry(CAR_WIDTH * 0.86, 0.34, 0.024, 4, 0.04),
    cabMask: new RoundedBoxGeometry(CAR_WIDTH * 0.79, 0.305, 0.029, 4, 0.035),
    cabGlass: new RoundedBoxGeometry(CAR_WIDTH * 0.63, 0.118, 0.032, 3, 0.022),
    cabMullion: new THREE.BoxGeometry(0.008, 0.112, 0.007),
    lamp: new RoundedBoxGeometry(0.055, 0.033, 0.014, 3, 0.008),
    lampBezel: new RoundedBoxGeometry(0.071, 0.047, 0.012, 3, 0.01),
    destination: new THREE.PlaneGeometry(0.175, 0.045),
    bogieSide: new RoundedBoxGeometry(0.045, 0.054, 0.31, 2, 0.012),
    axleBox: new THREE.BoxGeometry(0.054, 0.05, 0.056),
    airSpring: new THREE.CylinderGeometry(
      0.035,
      0.042,
      0.035,
      Math.max(8, profile.wheelSegments),
    ),
    wheel: new THREE.CylinderGeometry(
      WHEEL_RADIUS,
      WHEEL_RADIUS,
      0.022,
      profile.wheelSegments,
    ),
    wheelRim: new THREE.CylinderGeometry(
      WHEEL_RADIUS * 0.64,
      WHEEL_RADIUS * 0.64,
      0.025,
      profile.wheelSegments,
    ),
    tank: new THREE.CylinderGeometry(0.036, 0.036, 0.27, Math.max(8, profile.wheelSegments)),
    equipment: new RoundedBoxGeometry(0.21, 0.055, 0.37, 2, 0.018),
    roofFan: new THREE.CylinderGeometry(
      0.052,
      0.052,
      0.012,
      Math.max(8, profile.wheelSegments),
    ),
    roofGrille: new THREE.BoxGeometry(0.16, 0.007, 0.22),
    beam: new THREE.CylinderGeometry(0.008, 0.008, 1, profile.pantographSegments),
    insulator: new THREE.CylinderGeometry(0.018, 0.022, 0.03, profile.pantographSegments),
    contactStrip: new RoundedBoxGeometry(0.28, 0.012, 0.018, 2, 0.004),
    coupler: new THREE.BoxGeometry(0.08, 0.036, 0.082),
    cabBrow: new RoundedBoxGeometry(CAR_WIDTH * 0.82, 0.038, 0.052, 3, 0.012),
    cabCheek: new RoundedBoxGeometry(0.046, 0.252, 0.054, 3, 0.014),
    frontSkirt: new RoundedBoxGeometry(CAR_WIDTH * 0.87, 0.075, 0.066, 3, 0.018),
    couplerPocket: new RoundedBoxGeometry(0.125, 0.067, 0.052, 3, 0.014),
    obstacleDeflector: new RoundedBoxGeometry(CAR_WIDTH * 0.66, 0.034, 0.082, 2, 0.009),
  };
}

function setMeshShadow(
  mesh: THREE.Mesh | THREE.InstancedMesh,
  quality: TrainQuality,
  isDetail: boolean,
): void {
  mesh.castShadow = quality !== 'low' && (!isDetail || quality === 'high');
  mesh.receiveShadow = quality !== 'low';
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  quality: TrainQuality,
  isDetail = false,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  setMeshShadow(mesh, quality, isDetail);
  parent.add(mesh);
  return mesh;
}

function addSideInstances(
  car: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  transforms: ReadonlyArray<{
    x: number;
    y: number;
    z: number;
    sx?: number;
    sy?: number;
    sz?: number;
    rx?: number;
    ry?: number;
    rz?: number;
  }>,
  quality: TrainQuality,
): THREE.InstancedMesh {
  const instances = new THREE.InstancedMesh(geometry, material, transforms.length);
  const matrixObject = new THREE.Object3D();
  transforms.forEach((transform, index) => {
    matrixObject.position.set(transform.x, transform.y, transform.z);
    matrixObject.rotation.set(transform.rx ?? 0, transform.ry ?? 0, transform.rz ?? 0);
    matrixObject.scale.set(transform.sx ?? 1, transform.sy ?? 1, transform.sz ?? 1);
    matrixObject.updateMatrix();
    instances.setMatrixAt(index, matrixObject.matrix);
  });
  instances.instanceMatrix.needsUpdate = true;
  setMeshShadow(instances, quality, true);
  car.add(instances);
  return instances;
}

function regularWindowPositions(windowBays: number): number[] {
  const positions: number[] = [];
  const span = CAR_LENGTH * 0.6;
  for (let index = 0; index < windowBays; index += 1) {
    const fraction = windowBays === 1 ? 0.5 : index / (windowBays - 1);
    positions.push(span * (fraction - 0.5));
  }
  return positions;
}

function standardWindowPositions(windowBays: number): number[] {
  if (windowBays <= 4) return [-0.67, -0.1, 0.1, 0.67];
  // Four doors leave three passenger-window bays. Six panes keep those bays
  // legible without intersecting the door leaves, even at balanced quality.
  return [-0.7, -0.5, -0.1, 0.1, 0.5, 0.7];
}

function addSideDetails(
  car: THREE.Group,
  greenCar: boolean,
  cabOutwards: ReadonlyArray<1 | -1>,
  profile: QualityProfile,
  geometries: GeometryBank,
  materials: TrainMaterials,
  quality: TrainQuality,
): void {
  const sideX = CAR_WIDTH * 0.5 + 0.0065;
  const sideTransforms = [-1, 1];
  const doorZ = greenCar
    ? [-CAR_LENGTH * 0.38, CAR_LENGTH * 0.38]
    : [-CAR_LENGTH * 0.39, -CAR_LENGTH * 0.13, CAR_LENGTH * 0.13, CAR_LENGTH * 0.39];

  const bandDefinitions = [
    { y: 0.248, height: 0.038, material: materials.blue },
    { y: 0.214, height: 0.022, material: materials.cream },
  ];
  bandDefinitions.forEach((band) => {
    const transforms = [
      ...sideTransforms.flatMap((side) => [
        {
          x: side * (sideX + 0.006),
          y: band.y,
          z: 0,
          sy: band.height,
          sz: CAR_LENGTH * 0.94,
        },
        ...doorZ.map((z) => ({
          x: side * (sideX + 0.016),
          y: band.y,
          z,
          sy: band.height,
          sz: 0.205,
        })),
      ]),
      ...cabOutwards.map((outward) => ({
        x: 0,
        y: band.y,
        z: outward * (CAR_LENGTH * 0.5 + 0.04),
        sy: band.height,
        sz: CAR_WIDTH * 0.76,
        ry: Math.PI * 0.5,
      })),
    ];
    addSideInstances(car, geometries.sideBand, band.material, transforms, quality);
  });

  const bodyTrimTransforms = [
    ...sideTransforms.flatMap((side) => [
      {
        x: side * (sideX + 0.001),
        y: 0.501,
        z: 0,
        sy: 0.009,
        sz: CAR_LENGTH * 0.91,
      },
      {
        x: side * (sideX + 0.001),
        y: 0.169,
        z: 0,
        sy: 0.012,
        sz: CAR_LENGTH * 0.92,
      },
      {
        x: side * (sideX + 0.002),
        y: 0.535,
        z: 0,
        sy: 0.011,
        sz: CAR_LENGTH * 0.91,
      },
      {
        x: side * (sideX + 0.002),
        y: 0.284,
        z: 0,
        sy: 0.006,
        sz: CAR_LENGTH * 0.92,
      },
    ]),
    ...cabOutwards.map((outward) => ({
      x: 0,
      y: 0.169,
      z: outward * (CAR_LENGTH * 0.5 + 0.038),
      sy: 0.012,
      sz: CAR_WIDTH * 0.86,
      ry: Math.PI * 0.5,
    })),
  ];
  addSideInstances(car, geometries.sideBand, materials.steelDark, bodyTrimTransforms, quality);

  const doorTransforms = sideTransforms.flatMap((side) =>
    doorZ.map((z) => ({ x: side * (sideX + 0.001), y: 0.344, z })),
  );
  addSideInstances(car, geometries.doorFrame, materials.panelLine, doorTransforms, quality);
  const doorPanelTransforms = sideTransforms.flatMap((side) =>
    doorZ.map((z) => ({ x: side * (sideX + 0.006), y: 0.344, z })),
  );
  addSideInstances(car, geometries.door, materials.steelTrim, doorPanelTransforms, quality);

  const doorWindowTransforms = sideTransforms.flatMap((side) =>
    doorZ.map((z) => ({ x: side * (sideX + 0.008), y: 0.402, z })),
  );
  addSideInstances(car, geometries.doorWindow, materials.window, doorWindowTransforms, quality);

  const doorSplitTransforms = sideTransforms.flatMap((side) =>
    doorZ.flatMap((z) => [
      {
        x: side * (sideX + 0.014),
        y: 0.337,
        z,
        sy: 0.82,
      },
      {
        x: side * (sideX + 0.013),
        y: 0.337,
        z: z - 0.119,
        sy: 0.93,
      },
      {
        x: side * (sideX + 0.013),
        y: 0.337,
        z: z + 0.119,
        sy: 0.93,
      },
    ]),
  );
  addSideInstances(car, geometries.panelSeam, materials.panelLine, doorSplitTransforms, quality);

  const windowZ = greenCar
    ? regularWindowPositions(profile.windowBays)
    : standardWindowPositions(profile.windowBays);
  if (greenCar) {
    const frameTransforms = sideTransforms.flatMap((side) =>
      [0.305, 0.444].flatMap((y) =>
        windowZ.map((z) => ({ x: side * (sideX + 0.004), y, z })),
      ),
    );
    addSideInstances(car, geometries.greenWindowFrame, materials.panelLine, frameTransforms, quality);
    const transforms = sideTransforms.flatMap((side) =>
      [0.305, 0.444].flatMap((y) =>
        windowZ.map((z) => ({ x: side * (sideX + 0.009), y, z })),
      ),
    );
    addSideInstances(car, geometries.greenWindow, materials.window, transforms, quality);
  } else {
    const frameTransforms = sideTransforms.flatMap((side) =>
      windowZ.map((z) => ({ x: side * (sideX + 0.004), y: 0.421, z })),
    );
    addSideInstances(car, geometries.windowFrame, materials.panelLine, frameTransforms, quality);
    const transforms = sideTransforms.flatMap((side) =>
      windowZ.map((z) => ({ x: side * (sideX + 0.009), y: 0.421, z })),
    );
    addSideInstances(car, geometries.window, materials.window, transforms, quality);
  }

  if (quality !== 'low') {
    const seamZ = greenCar ? [-0.82, -0.42, 0.42, 0.82] : [-0.82, -0.41, 0.41, 0.82];
    const seamTransforms = sideTransforms.flatMap((side) =>
      seamZ.map((z) => ({ x: side * (sideX + 0.003), y: 0.334, z })),
    );
    addSideInstances(car, geometries.panelSeam, materials.panelLine, seamTransforms, quality);
  }
}

function addUnderbodyEquipment(
  car: THREE.Group,
  geometries: GeometryBank,
  materials: TrainMaterials,
  quality: TrainQuality,
): void {
  const darkTransforms = [
    { x: -0.055, y: 0.091, z: -0.56, sx: 1.08, sy: 1.08, sz: 0.76 },
    { x: 0.045, y: 0.086, z: -0.14, sx: 0.76, sy: 0.82, sz: 1.15 },
    { x: -0.035, y: 0.09, z: 0.39, sx: 1.16, sy: 1.14, sz: 0.82 },
  ];
  addSideInstances(car, geometries.underbox, materials.underbody, darkTransforms, quality);

  if (quality === 'low') return;

  const lightTransforms = [
    { x: 0.057, y: 0.096, z: -0.78, sx: 0.64, sy: 0.82, sz: 0.42 },
    { x: -0.062, y: 0.089, z: 0.7, sx: 0.78, sy: 0.7, sz: 0.52 },
  ];
  addSideInstances(car, geometries.underbox, materials.underbodyMid, lightTransforms, quality);

  const tankTransforms = [
    { x: 0, y: 0.088, z: 0.12, rz: Math.PI * 0.5, sx: 0.78 },
    { x: 0, y: 0.086, z: 0.63, rz: Math.PI * 0.5, sx: 0.62, sy: 0.83, sz: 0.83 },
  ];
  addSideInstances(car, geometries.tank, materials.underbodyLight, tankTransforms, quality);
}

function addRunningGear(
  car: THREE.Group,
  geometries: GeometryBank,
  materials: TrainMaterials,
  quality: TrainQuality,
): void {
  const bogieCentres = [-CAR_LENGTH * 0.32, CAR_LENGTH * 0.32];
  const sideFrameTransforms = bogieCentres.flatMap((z) =>
    [-1, 1].map((side) => ({
      x: side * CAR_WIDTH * 0.39,
      y: 0.091,
      z,
    })),
  );
  addSideInstances(car, geometries.bogieSide, materials.underbodyMid, sideFrameTransforms, quality);

  const axleBoxTransforms = bogieCentres.flatMap((z) =>
    [-0.105, 0.105].flatMap((axleOffset) =>
      [-1, 1].map((side) => ({
        x: side * CAR_WIDTH * 0.445,
        y: 0.066,
        z: z + axleOffset,
      })),
    ),
  );
  addSideInstances(car, geometries.axleBox, materials.underbodyLight, axleBoxTransforms, quality);

  const airSpringTransforms = bogieCentres.flatMap((z) =>
    [-1, 1].map((side) => ({
      x: side * CAR_WIDTH * 0.255,
      y: 0.132,
      z,
    })),
  );
  addSideInstances(car, geometries.airSpring, materials.rubber, airSpringTransforms, quality);
}

function addWheelObjects(
  car: THREE.Group,
  wheelRecords: WheelRecord[],
): void {
  const baseQuaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    Math.PI * 0.5,
  );
  const bogieZ = [-CAR_LENGTH * 0.32, CAR_LENGTH * 0.32];
  for (const centreZ of bogieZ) {
    for (const axleOffset of [-0.105, 0.105]) {
      for (const side of [-1, 1]) {
        const wheel = new THREE.Object3D();
        wheel.position.set(side * (CAR_WIDTH * 0.47), WHEEL_CENTRE_Y, centreZ + axleOffset);
        wheel.quaternion.copy(baseQuaternion);
        car.add(wheel);
        wheelRecords.push({ object: wheel, car, baseQuaternion: baseQuaternion.clone() });
      }
    }
  }
}

function makeBeam(
  parent: THREE.Object3D,
  start: THREE.Vector3,
  end: THREE.Vector3,
  geometry: THREE.CylinderGeometry,
  material: THREE.Material,
  quality: TrainQuality,
): THREE.Mesh {
  const beam = addMesh(parent, geometry, material, quality, true);
  const delta = end.clone().sub(start);
  beam.position.copy(start).add(end).multiplyScalar(0.5);
  beam.scale.y = delta.length();
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return beam;
}

function addPantograph(
  car: THREE.Group,
  geometries: GeometryBank,
  materials: TrainMaterials,
  quality: TrainQuality,
): void {
  const pantograph = new THREE.Group();
  pantograph.position.set(0, ROOF_Y + 0.045, 0.2);
  car.add(pantograph);

  const base = addMesh(
    pantograph,
    geometries.contactStrip,
    materials.underbody,
    quality,
    true,
  );
  base.scale.set(0.72, 1.15, 2.9);

  const insulatorTransforms = [-1, 1].flatMap((side) => [
    { x: side * 0.085, y: 0.021, z: -0.065 },
    { x: side * 0.085, y: 0.021, z: 0.065 },
    { x: side * 0.04, y: 0.021, z: 0 },
  ]);
  addSideInstances(
    pantograph,
    geometries.insulator,
    materials.cream,
    insulatorTransforms,
    quality,
  );

  const lowerLeft = new THREE.Vector3(-0.1, 0.025, -0.02);
  const lowerRight = new THREE.Vector3(0.1, 0.025, -0.02);
  const upperLeft = new THREE.Vector3(-0.07, 0.17, 0.02);
  const upperRight = new THREE.Vector3(0.07, 0.17, 0.02);
  makeBeam(pantograph, lowerLeft, upperRight, geometries.beam, materials.underbodyLight, quality);
  makeBeam(pantograph, lowerRight, upperLeft, geometries.beam, materials.underbodyLight, quality);
  makeBeam(
    pantograph,
    new THREE.Vector3(-0.07, 0.17, 0.02),
    new THREE.Vector3(0, 0.235, 0),
    geometries.beam,
    materials.underbodyLight,
    quality,
  );
  makeBeam(
    pantograph,
    new THREE.Vector3(0.07, 0.17, 0.02),
    new THREE.Vector3(0, 0.235, 0),
    geometries.beam,
    materials.underbodyLight,
    quality,
  );

  const strip = addMesh(
    pantograph,
    geometries.contactStrip,
    materials.steelDark,
    quality,
    true,
  );
  strip.position.y = 0.242;
}

function addRoofEquipment(
  car: THREE.Group,
  count: number,
  geometries: GeometryBank,
  materials: TrainMaterials,
  quality: TrainQuality,
): void {
  const equipmentTransforms: Array<{ x: number; y: number; z: number }> = [];
  const fanTransforms: Array<{ x: number; y: number; z: number }> = [];
  const grilleTransforms: Array<{ x: number; y: number; z: number }> = [];
  for (let index = 0; index < count; index += 1) {
    const fraction = count === 1 ? 0.5 : index / (count - 1);
    const z = CAR_LENGTH * 0.48 * (fraction - 0.5);
    equipmentTransforms.push({ x: 0, y: ROOF_Y + 0.045, z });
    fanTransforms.push({ x: 0, y: ROOF_Y + 0.079, z });
    grilleTransforms.push({ x: 0, y: ROOF_Y + 0.073, z });
  }
  addSideInstances(car, geometries.equipment, materials.roof, equipmentTransforms, quality);
  if (quality !== 'low') {
    addSideInstances(car, geometries.roofGrille, materials.panelLine, grilleTransforms, quality);
  }
  addSideInstances(car, geometries.roofFan, materials.underbodyMid, fanTransforms, quality);
}

function addCoupler(
  car: THREE.Group,
  z: number,
  geometries: GeometryBank,
  materials: TrainMaterials,
  quality: TrainQuality,
): void {
  const coupler = addMesh(car, geometries.coupler, materials.underbody, quality, true);
  coupler.position.set(0, 0.105, z);
}

function addCabFace(
  car: THREE.Group,
  outward: 1 | -1,
  geometries: GeometryBank,
  materials: TrainMaterials,
  quality: TrainQuality,
  headlights: THREE.Mesh[],
  tailLights: THREE.Mesh[],
): void {
  const endZ = outward * (CAR_LENGTH * 0.5 + 0.018);
  const faceRotation = outward === 1 ? 0 : Math.PI;

  const surround = addMesh(car, geometries.cabSurround, materials.steelTrim, quality);
  surround.position.set(0, 0.374, outward * (CAR_LENGTH * 0.5 + 0.011));
  surround.rotation.y = faceRotation;

  const mask = addMesh(car, geometries.cabMask, materials.blackMask, quality);
  mask.position.set(0, 0.372, endZ);
  mask.rotation.y = faceRotation;

  const glass = addMesh(car, geometries.cabGlass, materials.window, quality);
  glass.position.set(0, 0.42, outward * (CAR_LENGTH * 0.5 + 0.041));
  glass.rotation.y = faceRotation;

  const browAndSill = [
    {
      x: 0,
      y: 0.531,
      z: outward * (CAR_LENGTH * 0.5 + 0.043),
      sx: 1.02,
      sy: 1,
      ry: faceRotation,
    },
    {
      x: 0,
      y: 0.353,
      z: outward * (CAR_LENGTH * 0.5 + 0.046),
      sx: 0.84,
      sy: 0.52,
      ry: faceRotation,
    },
  ];
  addSideInstances(car, geometries.cabBrow, materials.steelDark, browAndSill, quality);

  const cheekTransforms = [-1, 1].map((side) => ({
    x: side * CAR_WIDTH * 0.435,
    y: 0.395,
    z: outward * (CAR_LENGTH * 0.5 + 0.045),
    ry: faceRotation,
  }));
  addSideInstances(car, geometries.cabCheek, materials.steelTrim, cheekTransforms, quality);

  const mullion = addMesh(car, geometries.cabMullion, materials.panelLine, quality, true);
  mullion.position.set(0, 0.42, outward * (CAR_LENGTH * 0.5 + 0.058));
  mullion.rotation.y = faceRotation;

  const wiperTransforms = [-1, 1].map((side) => ({
    x: side * CAR_WIDTH * 0.12,
    y: 0.397,
    z: outward * (CAR_LENGTH * 0.5 + 0.06),
    sy: 0.72,
    ry: faceRotation,
    rz: side * -0.42,
  }));
  addSideInstances(car, geometries.cabMullion, materials.panelLine, wiperTransforms, quality);

  const destination = addMesh(car, geometries.destination, materials.destination, quality, true);
  destination.position.set(0, 0.496, outward * (CAR_LENGTH * 0.5 + 0.06));
  destination.rotation.y = faceRotation;

  const bezelTransforms = [-1, 1].map((side) => ({
    x: side * CAR_WIDTH * 0.26,
    y: 0.32,
    z: outward * (CAR_LENGTH * 0.5 + 0.046),
    ry: faceRotation,
  }));
  addSideInstances(car, geometries.lampBezel, materials.steelTrim, bezelTransforms, quality);

  for (const side of [-1, 1]) {
    const lamp = addMesh(car, geometries.lamp, materials.headlight, quality, true);
    lamp.position.set(
      side * CAR_WIDTH * 0.26,
      0.32,
      outward * (CAR_LENGTH * 0.5 + 0.055),
    );
    lamp.rotation.y = faceRotation;
    lamp.visible = outward === 1;

    const tail = addMesh(car, geometries.lamp, materials.tailLight, quality, true);
    tail.scale.set(0.48, 0.42, 1.04);
    tail.position.set(
      side * CAR_WIDTH * 0.29,
      0.273,
      outward * (CAR_LENGTH * 0.5 + 0.055),
    );
    tail.rotation.y = faceRotation;
    tail.visible = outward === -1;

    if (outward === 1) headlights.push(lamp);
    if (outward === -1) tailLights.push(tail);
  }

  const frontSkirt = addMesh(car, geometries.frontSkirt, materials.steelDark, quality, true);
  frontSkirt.position.set(0, 0.132, outward * (CAR_LENGTH * 0.5 + 0.04));
  frontSkirt.rotation.y = faceRotation;

  const pocket = addMesh(car, geometries.couplerPocket, materials.blackMask, quality, true);
  pocket.position.set(0, 0.143, outward * (CAR_LENGTH * 0.5 + 0.077));
  pocket.rotation.y = faceRotation;

  const frontCoupler = addMesh(car, geometries.coupler, materials.underbodyLight, quality, true);
  frontCoupler.scale.set(0.72, 0.8, 0.72);
  frontCoupler.position.set(0, 0.141, outward * (CAR_LENGTH * 0.5 + 0.105));
  frontCoupler.rotation.y = faceRotation;

  const deflector = addMesh(
    car,
    geometries.obstacleDeflector,
    materials.underbody,
    quality,
    true,
  );
  deflector.position.set(0, 0.069, outward * (CAR_LENGTH * 0.5 + 0.073));
  deflector.rotation.y = faceRotation;
}

function createCar(
  index: number,
  carCount: number,
  greenCar: boolean,
  profile: QualityProfile,
  geometries: GeometryBank,
  materials: TrainMaterials,
  quality: TrainQuality,
  wheelRecords: WheelRecord[],
  headlights: THREE.Mesh[],
  tailLights: THREE.Mesh[],
): THREE.Group {
  const car = new THREE.Group();
  car.name = greenCar ? `E235 green car ${index + 1}` : `E235 car ${index + 1}`;
  // The foremost lamp/destination plane sits at root z=0. The complete formation
  // therefore grows toward -Z while +Z remains the travel direction.
  car.position.z = -index * CAR_PITCH - CAR_LENGTH * 0.5 - CAB_FACE_OFFSET;

  const shell = addMesh(
    car,
    greenCar ? geometries.greenBody : geometries.body,
    materials.steel,
    quality,
  );
  shell.position.y = BODY_CENTRE_Y + (greenCar ? CAR_HEIGHT * 0.0175 : 0);

  const roof = addMesh(car, geometries.roof, materials.roof, quality, true);
  roof.position.y = ROOF_Y + 0.012;

  const skirt = addMesh(car, geometries.skirt, materials.steelDark, quality, true);
  skirt.position.y = BODY_BOTTOM + 0.008;

  const cabOutwards: Array<1 | -1> = [];
  if (index === 0) cabOutwards.push(1);
  if (index === carCount - 1) cabOutwards.push(-1);
  addSideDetails(car, greenCar, cabOutwards, profile, geometries, materials, quality);
  addRunningGear(car, geometries, materials, quality);
  addUnderbodyEquipment(car, geometries, materials, quality);
  addWheelObjects(car, wheelRecords);
  addRoofEquipment(car, profile.roofBoxes, geometries, materials, quality);

  if (index === 0) {
    addCabFace(car, 1, geometries, materials, quality, headlights, tailLights);
  } else {
    addCoupler(car, CAR_LENGTH * 0.5 + CAR_GAP * 0.4, geometries, materials, quality);
  }

  if (index === carCount - 1) {
    addCabFace(car, -1, geometries, materials, quality, headlights, tailLights);
  } else {
    addCoupler(car, -CAR_LENGTH * 0.5 - CAR_GAP * 0.4, geometries, materials, quality);
  }

  return car;
}

export function createE235Formation(options: E235Options = {}): E235Formation {
  const quality = options.quality ?? 'balanced';
  const carCount = options.carCount ?? 11;
  const profile = QUALITY_PROFILES[quality];
  const { canvas: destinationCanvas, texture: destinationTexture } = createDestinationDisplay();
  const steelSurfaceTexture = createSteelSurfaceTexture();
  const materials = createMaterials(destinationTexture, steelSurfaceTexture);
  const geometries = createGeometryBank(profile);
  const root = new THREE.Group();
  root.name = 'E235-1000 inspired formation';

  const cars: THREE.Group[] = [];
  const headlights: THREE.Mesh[] = [];
  const tailLights: THREE.Mesh[] = [];
  const wheelRecords: WheelRecord[] = [];

  for (let index = 0; index < carCount; index += 1) {
    const greenCar = carCount !== 4 && (index === 3 || index === 4);
    const car = createCar(
      index,
      carCount,
      greenCar,
      profile,
      geometries,
      materials,
      quality,
      wheelRecords,
      headlights,
      tailLights,
    );
    root.add(car);
    cars.push(car);
  }

  const pantographIndex = carCount === 4 ? 2 : Math.min(carCount - 2, 6);
  addPantograph(cars[pantographIndex], geometries, materials, quality);
  if (quality === 'high' && carCount === 15) {
    addPantograph(cars[11], geometries, materials, quality);
  }

  const wheelMesh = new THREE.InstancedMesh(
    geometries.wheel,
    materials.underbody,
    wheelRecords.length,
  );
  wheelMesh.name = 'batched wheels';
  wheelMesh.castShadow = quality === 'high';
  wheelMesh.receiveShadow = quality !== 'low';
  // Wheel instance matrices are rewritten in world space as the consist
  // follows the curve. InstancedMesh does not refresh its cached bounds after
  // those updates, so leave the two always-visible wheel batches uncullable.
  wheelMesh.frustumCulled = false;
  wheelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const wheelRimMesh = new THREE.InstancedMesh(
    geometries.wheelRim,
    materials.steelTrim,
    wheelRecords.length,
  );
  wheelRimMesh.name = 'batched wheel rims';
  wheelRimMesh.castShadow = false;
  wheelRimMesh.receiveShadow = quality !== 'low';
  wheelRimMesh.frustumCulled = false;
  wheelRimMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(wheelMesh, wheelRimMesh);

  const baseCarPositions = cars.map((car) => car.position.clone());
  const baseCarQuaternions = cars.map((car) => car.quaternion.clone());
  const wheelRollAxis = new THREE.Vector3(0, 1, 0);
  const rollQuaternion = new THREE.Quaternion();
  const composedQuaternion = new THREE.Quaternion();
  const shakeQuaternion = new THREE.Quaternion();
  const shakeEuler = new THREE.Euler();
  const instanceMatrix = new THREE.Matrix4();
  let wheelAngle = 0;
  let elapsed = 0;
  let disposed = false;
  let lightState: boolean | null = null;
  let wasMoving = false;
  let posesDirty = false;

  const updateWheelInstances = (): void => {
    cars.forEach((car) => car.updateMatrix());
    wheelRecords.forEach((record, index) => {
      rollQuaternion.setFromAxisAngle(wheelRollAxis, wheelAngle);
      composedQuaternion.copy(record.baseQuaternion).multiply(rollQuaternion);
      record.object.quaternion.copy(composedQuaternion);
      record.object.updateMatrix();
      instanceMatrix.multiplyMatrices(record.car.matrix, record.object.matrix);
      wheelMesh.setMatrixAt(index, instanceMatrix);
      wheelRimMesh.setMatrixAt(index, instanceMatrix);
    });
    wheelMesh.instanceMatrix.needsUpdate = true;
    wheelRimMesh.instanceMatrix.needsUpdate = true;
  };

  const setDestination = (text: string): void => {
    if (disposed) return;
    drawDestination(destinationCanvas, destinationTexture, text);
  };

  const setLights = (on: boolean): void => {
    if (disposed || lightState === on) return;
    lightState = on;
    materials.headlight.emissiveIntensity = on ? 3.6 : 0.12;
    materials.tailLight.emissiveIntensity = on ? 2.7 : 0.08;
    materials.window.emissiveIntensity = on ? 0.21 : 0.045;
  };

  const setCarPose = (index: number, position: THREE.Vector3, quaternion: THREE.Quaternion): void => {
    if (disposed || index < 0 || index >= cars.length) return;
    baseCarPositions[index].copy(position);
    baseCarQuaternions[index].copy(quaternion);
    cars[index].position.copy(position);
    cars[index].quaternion.copy(quaternion);
    posesDirty = true;
  };

  const update = (deltaSeconds: number, speed: number): void => {
    if (disposed) return;
    const delta = THREE.MathUtils.clamp(deltaSeconds, 0, 0.1);
    const safeSpeed = Number.isFinite(speed) ? speed : 0;
    if (Math.abs(safeSpeed) < 0.02) {
      if (wasMoving) {
        cars.forEach((car, index) => {
          car.position.copy(baseCarPositions[index]);
          car.quaternion.copy(baseCarQuaternions[index]);
        });
        updateWheelInstances();
        wasMoving = false;
        posesDirty = false;
      } else if (posesDirty) {
        updateWheelInstances();
        posesDirty = false;
      }
      return;
    }
    wasMoving = true;
    elapsed = (elapsed + delta) % 1000;
    wheelAngle = (wheelAngle - (safeSpeed * delta) / WHEEL_RADIUS) % TAU;

    const speedFactor = THREE.MathUtils.clamp(Math.abs(safeSpeed) / 1.2, 0, 1);
    cars.forEach((car, index) => {
      const phase = elapsed * (2.3 + speedFactor * 1.4) - index * 0.42;
      car.position.copy(baseCarPositions[index]);
      car.position.y += Math.sin(phase) * 0.0022 * speedFactor;
      shakeEuler.set(
        Math.sin(phase * 0.51) * 0.0017 * speedFactor,
        0,
        Math.sin(phase * 0.83 + index * 0.25) * 0.0036 * speedFactor,
      );
      shakeQuaternion.setFromEuler(shakeEuler);
      car.quaternion.copy(baseCarQuaternions[index]).multiply(shakeQuaternion);
    });
    updateWheelInstances();
    posesDirty = false;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;

    const uniqueGeometries = new Set<THREE.BufferGeometry>(Object.values(geometries));
    const uniqueMaterials = new Set<THREE.Material>(Object.values(materials));
    uniqueGeometries.forEach((geometry) => geometry.dispose());
    uniqueMaterials.forEach((material) => material.dispose());
    destinationTexture.dispose();
    steelSurfaceTexture.dispose();
    root.clear();
    cars.length = 0;
    wheelRecords.length = 0;
    headlights.length = 0;
    tailLights.length = 0;
  };

  setDestination('たんじょうび号');
  setLights(false);
  updateWheelInstances();

  return {
    root,
    cars,
    wheels: wheelRecords.map((record) => record.object),
    headlights,
    destinationCanvas,
    destinationTexture,
    setDestination,
    setLights,
    setCarPose,
    update,
    dispose,
  };
}
