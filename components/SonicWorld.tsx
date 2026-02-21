"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import styles from "./sonic-world.module.css";

type ListenerPose = {
  x: number;
  z: number;
  headingDeg: number;
};

type CollisionZone = {
  id: string;
  label: string;
  x: number;
  z: number;
  radius: number;
};

type Wall = {
  id: string;
  x: number;
  z: number;
  width: number;
  height: number;
};

type SoundEmitter = {
  id: string;
  name: string;
  x: number;
  z: number;
  y: number;
  frequency: number;
  gain: number;
  waveform: OscillatorType;
  color: string;
  moving: boolean;
  vx: number;
  vz: number;
};

type EmitterAudioNode = {
  oscillator: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: PannerNode;
};

type SelectedObstacle =
  | {
      kind: "zone";
      id: string;
    }
  | {
      kind: "wall";
      id: string;
    };

type DragTarget =
  | {
      kind: "emitter";
      id: string;
    }
  | {
      kind: "zone";
      id: string;
      offsetX: number;
      offsetZ: number;
    }
  | {
      kind: "wall";
      id: string;
      offsetX: number;
      offsetZ: number;
    };

const WORLD_RADIUS_M = 16;
const PLAYER_RADIUS_M = 0.45;
const EMITTER_RADIUS_M = 0.35;
const CANVAS_SIZE = 840;
const MOVE_SPEED_MPS = 2.75;
const TURN_SPEED_DEG_PER_SEC = 95;
const SOUND_SPEED_MPS = 343;

const WAVEFORMS: OscillatorType[] = ["sine", "triangle", "square", "sawtooth"];

const INITIAL_LISTENER: ListenerPose = { x: 0, z: 0, headingDeg: 0 };

const INITIAL_ZONES: CollisionZone[] = [
  { id: "zone-1", label: "Concrete Pillar", x: -4.8, z: -1.5, radius: 1.6 },
  { id: "zone-2", label: "Kiosk", x: 5, z: 4.5, radius: 1.9 },
  { id: "zone-3", label: "Bench Cluster", x: 3.4, z: -6.8, radius: 1.35 }
];

const INITIAL_WALLS: Wall[] = [
  { id: "wall-1", x: -7.2, z: 2.4, width: 4.6, height: 0.8 },
  { id: "wall-2", x: 1.8, z: -2.8, width: 0.8, height: 5.6 },
  { id: "wall-3", x: 6.7, z: -0.5, width: 0.8, height: 4.2 }
];

const INITIAL_EMITTERS: SoundEmitter[] = [
  {
    id: "emitter-1",
    name: "Drone A",
    x: -6,
    z: 5,
    y: 0,
    frequency: 470,
    gain: 0.16,
    waveform: "triangle",
    color: "#0f8c7c",
    moving: true,
    vx: 0.9,
    vz: -0.55
  },
  {
    id: "emitter-2",
    name: "Beacon B",
    x: 4.8,
    z: -5.2,
    y: 0.3,
    frequency: 690,
    gain: 0.14,
    waveform: "sine",
    color: "#df7c20",
    moving: false,
    vx: 0,
    vz: 0
  },
  {
    id: "emitter-3",
    name: "Drone C",
    x: 7.2,
    z: 3.4,
    y: -0.25,
    frequency: 920,
    gain: 0.12,
    waveform: "square",
    color: "#4670e7",
    moving: true,
    vx: -0.75,
    vz: 0.45
  }
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function wrapDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomColor(): string {
  const hue = Math.round(randomBetween(12, 210));
  return `hsl(${hue} 76% 52%)`;
}

function pointToCanvas(x: number, z: number, canvasSize: number): { x: number; y: number } {
  const radiusPx = canvasSize * 0.43;
  const center = canvasSize / 2;
  return {
    x: center + (x / WORLD_RADIUS_M) * radiusPx,
    y: center + (z / WORLD_RADIUS_M) * radiusPx
  };
}

function canvasToPoint(x: number, y: number, canvasSize: number): { x: number; z: number } {
  const radiusPx = canvasSize * 0.43;
  const center = canvasSize / 2;
  return {
    x: clamp(((x - center) / radiusPx) * WORLD_RADIUS_M, -WORLD_RADIUS_M, WORLD_RADIUS_M),
    z: clamp(((y - center) / radiusPx) * WORLD_RADIUS_M, -WORLD_RADIUS_M, WORLD_RADIUS_M)
  };
}

function circleLineIntersection(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  radius: number
): boolean {
  const abx = bx - ax;
  const abz = bz - az;
  const acx = cx - ax;
  const acz = cz - az;
  const abLenSq = abx * abx + abz * abz;
  if (abLenSq < 1e-6) {
    return Math.hypot(cx - ax, cz - az) <= radius;
  }
  const projection = clamp((acx * abx + acz * abz) / abLenSq, 0, 1);
  const closestX = ax + abx * projection;
  const closestZ = az + abz * projection;
  return Math.hypot(cx - closestX, cz - closestZ) <= radius;
}

function lineIntersectsWall(ax: number, az: number, bx: number, bz: number, wall: Wall): boolean {
  const left = wall.x - wall.width / 2;
  const right = wall.x + wall.width / 2;
  const top = wall.z - wall.height / 2;
  const bottom = wall.z + wall.height / 2;

  const steps = 18;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    if (x >= left && x <= right && z >= top && z <= bottom) {
      return true;
    }
  }
  return false;
}

function disposeEmitterNode(node: EmitterAudioNode): void {
  try {
    node.oscillator.stop();
  } catch {
    // ignore
  }
  node.oscillator.disconnect();
  node.gain.disconnect();
  node.filter.disconnect();
  node.panner.disconnect();
}

export default function SonicWorld() {
  const [listener, setListener] = useState<ListenerPose>(INITIAL_LISTENER);
  const [emitters, setEmitters] = useState<SoundEmitter[]>(INITIAL_EMITTERS);
  const [collisionZones, setCollisionZones] = useState<CollisionZone[]>(INITIAL_ZONES);
  const [walls, setWalls] = useState<Wall[]>(INITIAL_WALLS);

  const [walkMode, setWalkMode] = useState(true);
  const [movingEnabled, setMovingEnabled] = useState(true);
  const [audioRunning, setAudioRunning] = useState(false);
  const [status, setStatus] = useState("Press Start Audio. Move with W/A/S/D and Q/E.");

  const [selectedEmitterId, setSelectedEmitterId] = useState<string | null>(INITIAL_EMITTERS[0].id);
  const [selectedObstacle, setSelectedObstacle] = useState<SelectedObstacle | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const keyStateRef = useRef<Set<string>>(new Set());
  const dragTargetRef = useRef<DragTarget | null>(null);
  const emitterCounterRef = useRef(INITIAL_EMITTERS.length + 1);
  const zoneCounterRef = useRef(INITIAL_ZONES.length + 1);
  const wallCounterRef = useRef(INITIAL_WALLS.length + 1);

  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const emitterNodesRef = useRef<Map<string, EmitterAudioNode>>(new Map());

  const selectedEmitter = useMemo(
    () => emitters.find((emitter) => emitter.id === selectedEmitterId) ?? null,
    [emitters, selectedEmitterId]
  );

  const selectedZone = useMemo(() => {
    if (!selectedObstacle || selectedObstacle.kind !== "zone") {
      return null;
    }
    return collisionZones.find((zone) => zone.id === selectedObstacle.id) ?? null;
  }, [collisionZones, selectedObstacle]);

  const selectedWall = useMemo(() => {
    if (!selectedObstacle || selectedObstacle.kind !== "wall") {
      return null;
    }
    return walls.find((wall) => wall.id === selectedObstacle.id) ?? null;
  }, [selectedObstacle, walls]);

  const collidesAt = useCallback(
    (x: number, z: number, radius: number): boolean => {
      if (Math.hypot(x, z) + radius > WORLD_RADIUS_M) {
        return true;
      }

      for (const zone of collisionZones) {
        if (Math.hypot(x - zone.x, z - zone.z) <= zone.radius + radius) {
          return true;
        }
      }

      for (const wall of walls) {
        const left = wall.x - wall.width / 2 - radius;
        const right = wall.x + wall.width / 2 + radius;
        const top = wall.z - wall.height / 2 - radius;
        const bottom = wall.z + wall.height / 2 + radius;
        if (x >= left && x <= right && z >= top && z <= bottom) {
          return true;
        }
      }

      return false;
    },
    [collisionZones, walls]
  );

  const setListenerAudioPose = useCallback((context: AudioContext, pose: ListenerPose) => {
    const t = context.currentTime;
    const heading = toRadians(pose.headingDeg);
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);

    const listenerNode = context.listener as AudioListener & {
      positionX?: AudioParam;
      positionY?: AudioParam;
      positionZ?: AudioParam;
      forwardX?: AudioParam;
      forwardY?: AudioParam;
      forwardZ?: AudioParam;
      upX?: AudioParam;
      upY?: AudioParam;
      upZ?: AudioParam;
      setPosition?: (x: number, y: number, z: number) => void;
      setOrientation?: (x: number, y: number, z: number, ux: number, uy: number, uz: number) => void;
    };

    if (listenerNode.positionX && listenerNode.positionY && listenerNode.positionZ) {
      listenerNode.positionX.setValueAtTime(pose.x, t);
      listenerNode.positionY.setValueAtTime(0, t);
      listenerNode.positionZ.setValueAtTime(pose.z, t);
    } else {
      listenerNode.setPosition?.(pose.x, 0, pose.z);
    }

    if (
      listenerNode.forwardX &&
      listenerNode.forwardY &&
      listenerNode.forwardZ &&
      listenerNode.upX &&
      listenerNode.upY &&
      listenerNode.upZ
    ) {
      listenerNode.forwardX.setValueAtTime(fx, t);
      listenerNode.forwardY.setValueAtTime(0, t);
      listenerNode.forwardZ.setValueAtTime(fz, t);
      listenerNode.upX.setValueAtTime(0, t);
      listenerNode.upY.setValueAtTime(1, t);
      listenerNode.upZ.setValueAtTime(0, t);
    } else {
      listenerNode.setOrientation?.(fx, 0, fz, 0, 1, 0);
    }
  }, []);

  const setEmitterPannerPosition = useCallback(
    (context: AudioContext, panner: PannerNode, emitter: SoundEmitter) => {
      const t = context.currentTime;
      const legacy = panner as PannerNode & { setPosition?: (x: number, y: number, z: number) => void };
      if (legacy.positionX && legacy.positionY && legacy.positionZ) {
        legacy.positionX.setValueAtTime(emitter.x, t);
        legacy.positionY.setValueAtTime(emitter.y, t);
        legacy.positionZ.setValueAtTime(emitter.z, t);
      } else {
        legacy.setPosition?.(emitter.x, emitter.y, emitter.z);
      }
    },
    []
  );

  const getAudioContext = useCallback(() => {
    if (audioContextRef.current) {
      return audioContextRef.current;
    }

    const withWebkit = window as typeof window & { webkitAudioContext?: typeof AudioContext };
    const AudioCtor = window.AudioContext ?? withWebkit.webkitAudioContext;
    if (!AudioCtor) {
      throw new Error("Web Audio API is unavailable in this browser.");
    }

    const context = new AudioCtor({ latencyHint: "interactive" });
    const master = context.createGain();
    master.gain.value = 0.82;
    master.connect(context.destination);

    audioContextRef.current = context;
    masterGainRef.current = master;

    return context;
  }, []);

  const createEmitterNode = useCallback(
    (context: AudioContext, emitter: SoundEmitter): EmitterAudioNode => {
      const master = masterGainRef.current;
      if (!master) {
        throw new Error("Audio routing is not initialized.");
      }

      const oscillator = context.createOscillator();
      oscillator.type = emitter.waveform;
      oscillator.frequency.setValueAtTime(emitter.frequency, context.currentTime);

      const sourceGain = context.createGain();
      sourceGain.gain.setValueAtTime(emitter.gain, context.currentTime);

      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(6200, context.currentTime);
      filter.Q.setValueAtTime(0.6, context.currentTime);

      const panner = new PannerNode(context, {
        panningModel: "HRTF",
        distanceModel: "inverse",
        refDistance: 1.1,
        maxDistance: WORLD_RADIUS_M * 2.5,
        rolloffFactor: 1.3,
        coneInnerAngle: 360,
        coneOuterAngle: 0,
        coneOuterGain: 0
      });

      oscillator.connect(sourceGain);
      sourceGain.connect(filter);
      filter.connect(panner);
      panner.connect(master);
      oscillator.start();

      setEmitterPannerPosition(context, panner, emitter);

      return { oscillator, gain: sourceGain, filter, panner };
    },
    [setEmitterPannerPosition]
  );

  const reconnectAudioEmitters = useCallback(() => {
    const context = audioContextRef.current;
    if (!context || !audioRunning) {
      return;
    }

    const nodeMap = emitterNodesRef.current;
    const liveIds = new Set(emitters.map((e) => e.id));

    for (const [id, node] of nodeMap.entries()) {
      if (!liveIds.has(id)) {
        disposeEmitterNode(node);
        nodeMap.delete(id);
      }
    }

    for (const emitter of emitters) {
      const existing = nodeMap.get(emitter.id);
      if (!existing) {
        nodeMap.set(emitter.id, createEmitterNode(context, emitter));
        continue;
      }

      const dx = listener.x - emitter.x;
      const dz = listener.z - emitter.z;
      const distance = Math.max(0.001, Math.hypot(dx, dz));
      const towardListener = (emitter.vx * dx + emitter.vz * dz) / distance;
      const observedFreq = clamp(
        emitter.frequency * (SOUND_SPEED_MPS / (SOUND_SPEED_MPS - towardListener)),
        emitter.frequency * 0.6,
        emitter.frequency * 1.8
      );

      let occluded = false;
      for (const zone of collisionZones) {
        if (circleLineIntersection(listener.x, listener.z, emitter.x, emitter.z, zone.x, zone.z, zone.radius)) {
          occluded = true;
          break;
        }
      }
      if (!occluded) {
        for (const wall of walls) {
          if (lineIntersectsWall(listener.x, listener.z, emitter.x, emitter.z, wall)) {
            occluded = true;
            break;
          }
        }
      }

      existing.oscillator.type = emitter.waveform;
      existing.oscillator.frequency.setTargetAtTime(observedFreq, context.currentTime, 0.04);
      existing.gain.gain.setTargetAtTime(occluded ? emitter.gain * 0.72 : emitter.gain, context.currentTime, 0.04);
      existing.filter.frequency.setTargetAtTime(occluded ? 1500 : 7600, context.currentTime, 0.05);
      setEmitterPannerPosition(context, existing.panner, emitter);
    }
  }, [
    audioRunning,
    collisionZones,
    createEmitterNode,
    emitters,
    listener.x,
    listener.z,
    setEmitterPannerPosition,
    walls
  ]);

  const drawScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const size = canvas.width;
    const center = size / 2;
    const worldRadiusPx = size * 0.43;

    context.clearRect(0, 0, size, size);

    const bg = context.createRadialGradient(center, center * 0.75, size * 0.12, center, center, size * 0.66);
    bg.addColorStop(0, "#fffdf8");
    bg.addColorStop(0.56, "#f4fbff");
    bg.addColorStop(1, "#e8f1f7");
    context.fillStyle = bg;
    context.fillRect(0, 0, size, size);

    for (let r = 2; r <= WORLD_RADIUS_M; r += 2) {
      const radiusPx = (r / WORLD_RADIUS_M) * worldRadiusPx;
      context.beginPath();
      context.setLineDash(r % 4 === 0 ? [] : [7, 7]);
      context.strokeStyle = r === WORLD_RADIUS_M ? "#4b7580" : "#a8c5ce";
      context.lineWidth = r === WORLD_RADIUS_M ? 1.8 : 1;
      context.arc(center, center, radiusPx, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }

    for (const wall of walls) {
      const topLeft = pointToCanvas(wall.x - wall.width / 2, wall.z - wall.height / 2, size);
      const bottomRight = pointToCanvas(wall.x + wall.width / 2, wall.z + wall.height / 2, size);
      const selected = selectedObstacle?.kind === "wall" && selectedObstacle.id === wall.id;
      context.fillStyle = selected ? "rgba(199, 78, 39, 0.38)" : "rgba(142, 71, 30, 0.23)";
      context.strokeStyle = selected ? "rgba(163, 52, 21, 0.95)" : "rgba(118, 60, 24, 0.66)";
      context.lineWidth = selected ? 2 : 1.3;
      context.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
      context.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    }

    for (const zone of collisionZones) {
      const point = pointToCanvas(zone.x, zone.z, size);
      const radiusPx = (zone.radius / WORLD_RADIUS_M) * worldRadiusPx;
      const selected = selectedObstacle?.kind === "zone" && selectedObstacle.id === zone.id;

      context.beginPath();
      context.fillStyle = selected ? "rgba(245, 120, 42, 0.38)" : "rgba(233, 130, 42, 0.2)";
      context.strokeStyle = selected ? "rgba(196, 75, 14, 0.95)" : "rgba(196, 98, 24, 0.85)";
      context.lineWidth = selected ? 2 : 1.4;
      context.arc(point.x, point.y, radiusPx, 0, Math.PI * 2);
      context.fill();
      context.stroke();

      context.fillStyle = "#704320";
      context.font = "600 12px 'Avenir Next', sans-serif";
      context.fillText(zone.label, point.x + radiusPx + 5, point.y - 4);
    }

    const listenerPoint = pointToCanvas(listener.x, listener.z, size);
    const heading = toRadians(listener.headingDeg);
    const tipX = listenerPoint.x + Math.sin(heading) * 22;
    const tipY = listenerPoint.y - Math.cos(heading) * 22;
    const wingLeftX = listenerPoint.x + Math.sin(heading + 2.4) * 11;
    const wingLeftY = listenerPoint.y - Math.cos(heading + 2.4) * 11;
    const wingRightX = listenerPoint.x + Math.sin(heading - 2.4) * 11;
    const wingRightY = listenerPoint.y - Math.cos(heading - 2.4) * 11;

    context.beginPath();
    context.moveTo(tipX, tipY);
    context.lineTo(wingLeftX, wingLeftY);
    context.lineTo(wingRightX, wingRightY);
    context.closePath();
    context.fillStyle = "#0f7f73";
    context.fill();

    context.beginPath();
    context.arc(listenerPoint.x, listenerPoint.y, 6, 0, Math.PI * 2);
    context.fillStyle = "#0a5d56";
    context.fill();

    for (const emitter of emitters) {
      const point = pointToCanvas(emitter.x, emitter.z, size);
      const selected = emitter.id === selectedEmitterId;

      context.beginPath();
      context.moveTo(listenerPoint.x, listenerPoint.y);
      context.lineTo(point.x, point.y);
      context.strokeStyle = "rgba(0, 0, 0, 0.18)";
      context.lineWidth = 1;
      context.stroke();

      context.beginPath();
      context.arc(point.x, point.y, selected ? 13 : 10.5, 0, Math.PI * 2);
      context.fillStyle = emitter.color;
      context.globalAlpha = 0.88;
      context.fill();
      context.globalAlpha = 1;

      if (emitter.moving) {
        context.beginPath();
        const vx = emitter.vx * 11;
        const vz = emitter.vz * 11;
        context.moveTo(point.x, point.y);
        context.lineTo(point.x + vx, point.y + vz);
        context.strokeStyle = "rgba(20, 48, 55, 0.72)";
        context.lineWidth = 1.8;
        context.stroke();
      }

      context.fillStyle = "#193f46";
      context.font = "600 12px 'Avenir Next', sans-serif";
      context.fillText(emitter.name, point.x + 12, point.y - 8);
    }
  }, [collisionZones, emitters, listener, selectedEmitterId, selectedObstacle, walls]);

  const startAudio = useCallback(async () => {
    try {
      const context = getAudioContext();
      await context.resume();
      setListenerAudioPose(context, listener);
      setAudioRunning(true);
      setStatus("Audio active. Use earbuds and keep volume low.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start audio.";
      setStatus(message);
    }
  }, [getAudioContext, listener, setListenerAudioPose]);

  const stopAudio = useCallback(async () => {
    const context = audioContextRef.current;
    if (!context) {
      setAudioRunning(false);
      return;
    }
    await context.suspend();
    setAudioRunning(false);
    setStatus("Audio paused.");
  }, []);

  const addEmitter = useCallback((x: number, z: number) => {
    const id = `emitter-${emitterCounterRef.current++}`;
    const newEmitter: SoundEmitter = {
      id,
      name: `Emitter ${id.split("-")[1]}`,
      x,
      z,
      y: randomBetween(-0.4, 0.4),
      frequency: Math.round(randomBetween(360, 1200)),
      gain: Number(randomBetween(0.08, 0.22).toFixed(2)),
      waveform: WAVEFORMS[Math.floor(Math.random() * WAVEFORMS.length)],
      color: randomColor(),
      moving: Math.random() > 0.5,
      vx: randomBetween(-1, 1),
      vz: randomBetween(-1, 1)
    };
    setEmitters((prev) => [...prev, newEmitter]);
    setSelectedEmitterId(id);
  }, []);

  const addZone = useCallback(() => {
    const id = `zone-${zoneCounterRef.current++}`;
    const zone: CollisionZone = {
      id,
      label: `Obstacle ${id.split("-")[1]}`,
      x: randomBetween(-8, 8),
      z: randomBetween(-8, 8),
      radius: randomBetween(1, 2.2)
    };
    setCollisionZones((prev) => [...prev, zone]);
    setSelectedObstacle({ kind: "zone", id });
  }, []);

  const addWall = useCallback(() => {
    const id = `wall-${wallCounterRef.current++}`;
    const wall: Wall = {
      id,
      x: randomBetween(-8, 8),
      z: randomBetween(-8, 8),
      width: randomBetween(1.2, 4.8),
      height: randomBetween(0.8, 3.8)
    };
    setWalls((prev) => [...prev, wall]);
    setSelectedObstacle({ kind: "wall", id });
  }, []);

  const updateEmitter = useCallback((id: string, patch: Partial<SoundEmitter>) => {
    setEmitters((prev) => prev.map((emitter) => (emitter.id === id ? { ...emitter, ...patch } : emitter)));
  }, []);

  const removeEmitter = useCallback((id: string) => {
    setEmitters((prev) => prev.filter((emitter) => emitter.id !== id));
    setSelectedEmitterId((current) => (current === id ? null : current));
  }, []);

  const updateZone = useCallback((id: string, patch: Partial<CollisionZone>) => {
    setCollisionZones((prev) => prev.map((zone) => (zone.id === id ? { ...zone, ...patch } : zone)));
  }, []);

  const updateWall = useCallback((id: string, patch: Partial<Wall>) => {
    setWalls((prev) => prev.map((wall) => (wall.id === id ? { ...wall, ...patch } : wall)));
  }, []);

  const removeSelectedObstacle = useCallback(() => {
    if (!selectedObstacle) {
      return;
    }
    if (selectedObstacle.kind === "zone") {
      setCollisionZones((prev) => prev.filter((zone) => zone.id !== selectedObstacle.id));
    } else {
      setWalls((prev) => prev.filter((wall) => wall.id !== selectedObstacle.id));
    }
    setSelectedObstacle(null);
  }, [selectedObstacle]);

  useEffect(() => {
    drawScene();
  }, [drawScene]);

  useEffect(() => {
    if (!audioRunning) {
      return;
    }
    reconnectAudioEmitters();
  }, [audioRunning, reconnectAudioEmitters]);

  useEffect(() => {
    const context = audioContextRef.current;
    if (!context || !audioRunning) {
      return;
    }
    setListenerAudioPose(context, listener);
  }, [audioRunning, listener, setListenerAudioPose]);

  useEffect(() => {
    if (emitters.length === 0) {
      setSelectedEmitterId(null);
      return;
    }
    if (!selectedEmitterId || !emitters.some((emitter) => emitter.id === selectedEmitterId)) {
      setSelectedEmitterId(emitters[0].id);
    }
  }, [emitters, selectedEmitterId]);

  useEffect(() => {
    const trackedKeys = new Set(["w", "a", "s", "d", "q", "e", "arrowleft", "arrowright"]);

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!trackedKeys.has(key)) {
        return;
      }
      keyStateRef.current.add(key);
      event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keyStateRef.current.delete(event.key.toLowerCase());
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();

    const tick = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.04);
      previous = now;

      if (walkMode) {
        const keys = keyStateRef.current;
        const forward = (keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0);
        const strafe = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
        const turn = (keys.has("e") || keys.has("arrowright") ? 1 : 0) - (keys.has("q") || keys.has("arrowleft") ? 1 : 0);

        if (forward !== 0 || strafe !== 0 || turn !== 0) {
          setListener((current) => {
            const heading = wrapDegrees(current.headingDeg + turn * TURN_SPEED_DEG_PER_SEC * delta);
            const rad = toRadians(heading);
            const fx = Math.sin(rad);
            const fz = -Math.cos(rad);
            const rx = Math.cos(rad);
            const rz = Math.sin(rad);

            const step = MOVE_SPEED_MPS * delta;
            const desiredX = current.x + (forward * fx + strafe * rx) * step;
            const desiredZ = current.z + (forward * fz + strafe * rz) * step;

            let nextX = desiredX;
            let nextZ = desiredZ;

            if (collidesAt(nextX, nextZ, PLAYER_RADIUS_M)) {
              if (!collidesAt(nextX, current.z, PLAYER_RADIUS_M)) {
                nextZ = current.z;
              } else if (!collidesAt(current.x, nextZ, PLAYER_RADIUS_M)) {
                nextX = current.x;
              } else {
                nextX = current.x;
                nextZ = current.z;
              }
            }

            return { x: nextX, z: nextZ, headingDeg: heading };
          });
        }
      }

      if (movingEnabled) {
        setEmitters((current) =>
          current.map((emitter) => {
            if (!emitter.moving) {
              return emitter;
            }

            let vx = emitter.vx;
            let vz = emitter.vz;
            let nx = emitter.x + vx * delta;
            let nz = emitter.z + vz * delta;

            if (collidesAt(nx, nz, EMITTER_RADIUS_M)) {
              const collidesX = collidesAt(nx, emitter.z, EMITTER_RADIUS_M);
              const collidesZ = collidesAt(emitter.x, nz, EMITTER_RADIUS_M);

              if (collidesX) {
                vx = -vx;
                nx = emitter.x + vx * delta;
              }
              if (collidesZ) {
                vz = -vz;
                nz = emitter.z + vz * delta;
              }

              if (collidesAt(nx, nz, EMITTER_RADIUS_M)) {
                vx = -vx;
                vz = -vz;
                nx = emitter.x + vx * delta;
                nz = emitter.z + vz * delta;
              }
            }

            return { ...emitter, x: nx, z: nz, vx, vz };
          })
        );
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [collidesAt, movingEnabled, walkMode]);

  useEffect(() => {
    return () => {
      for (const node of emitterNodesRef.current.values()) {
        disposeEmitterNode(node);
      }
      emitterNodesRef.current.clear();
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    };
  }, []);

  const pointerToCanvas = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height
    };
  };

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const pointer = pointerToCanvas(event);
    const pointerWorld = canvasToPoint(pointer.x, pointer.y, canvas.width);

    let nearestEmitterId: string | null = null;
    let nearestEmitterDistance = Number.POSITIVE_INFINITY;

    for (const emitter of emitters) {
      const point = pointToCanvas(emitter.x, emitter.z, canvas.width);
      const distance = Math.hypot(pointer.x - point.x, pointer.y - point.y);
      if (distance < 22 && distance < nearestEmitterDistance) {
        nearestEmitterId = emitter.id;
        nearestEmitterDistance = distance;
      }
    }

    if (nearestEmitterId) {
      dragTargetRef.current = { kind: "emitter", id: nearestEmitterId };
      setSelectedEmitterId(nearestEmitterId);
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    for (const zone of collisionZones) {
      const distance = Math.hypot(pointerWorld.x - zone.x, pointerWorld.z - zone.z);
      if (distance <= zone.radius) {
        dragTargetRef.current = {
          kind: "zone",
          id: zone.id,
          offsetX: pointerWorld.x - zone.x,
          offsetZ: pointerWorld.z - zone.z
        };
        setSelectedObstacle({ kind: "zone", id: zone.id });
        canvas.setPointerCapture(event.pointerId);
        return;
      }
    }

    for (const wall of walls) {
      const left = wall.x - wall.width / 2;
      const right = wall.x + wall.width / 2;
      const top = wall.z - wall.height / 2;
      const bottom = wall.z + wall.height / 2;
      if (pointerWorld.x >= left && pointerWorld.x <= right && pointerWorld.z >= top && pointerWorld.z <= bottom) {
        dragTargetRef.current = {
          kind: "wall",
          id: wall.id,
          offsetX: pointerWorld.x - wall.x,
          offsetZ: pointerWorld.z - wall.z
        };
        setSelectedObstacle({ kind: "wall", id: wall.id });
        canvas.setPointerCapture(event.pointerId);
        return;
      }
    }
  };

  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const dragTarget = dragTargetRef.current;
    if (!dragTarget) {
      return;
    }

    const local = pointerToCanvas(event);
    const point = canvasToPoint(local.x, local.y, event.currentTarget.width);

    if (dragTarget.kind === "emitter") {
      updateEmitter(dragTarget.id, { x: point.x, z: point.z });
      return;
    }

    if (dragTarget.kind === "zone") {
      updateZone(dragTarget.id, {
        x: clamp(point.x - dragTarget.offsetX, -WORLD_RADIUS_M, WORLD_RADIUS_M),
        z: clamp(point.z - dragTarget.offsetZ, -WORLD_RADIUS_M, WORLD_RADIUS_M)
      });
      return;
    }

    updateWall(dragTarget.id, {
      x: clamp(point.x - dragTarget.offsetX, -WORLD_RADIUS_M, WORLD_RADIUS_M),
      z: clamp(point.z - dragTarget.offsetZ, -WORLD_RADIUS_M, WORLD_RADIUS_M)
    });
  };

  const onCanvasPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    dragTargetRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onCanvasDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const localX = ((event.clientX - bounds.left) / bounds.width) * canvas.width;
    const localY = ((event.clientY - bounds.top) / bounds.height) * canvas.height;
    const point = canvasToPoint(localX, localY, canvas.width);
    if (!collidesAt(point.x, point.z, EMITTER_RADIUS_M)) {
      addEmitter(point.x, point.z);
    }
  };

  return (
    <section className={styles.wrap}>
      <div className={styles.topRow}>
        <article className={styles.card}>
          <h2>Audio + Motion</h2>
          <p className={styles.subtle}>
            Start audio, move with <code>W/A/S/D</code>, rotate with <code>Q/E</code>.
          </p>
          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} onClick={audioRunning ? stopAudio : startAudio} type="button">
              {audioRunning ? "Pause Audio" : "Start Audio"}
            </button>
            <button className={styles.secondaryButton} onClick={() => setListener(INITIAL_LISTENER)} type="button">
              Reset Listener
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => addEmitter(listener.x + randomBetween(-2, 2), listener.z + randomBetween(-2, 2))}
              type="button"
            >
              Add Emitter
            </button>
          </div>

          <div className={styles.toggleGrid}>
            <label>
              <input type="checkbox" checked={walkMode} onChange={(event) => setWalkMode(event.target.checked)} />
              Walk mode
            </label>
            <label>
              <input
                type="checkbox"
                checked={movingEnabled}
                onChange={(event) => setMovingEnabled(event.target.checked)}
              />
              Moving emitters
            </label>
          </div>

          <p className={styles.status}>{status}</p>
        </article>

        <article className={styles.card}>
          <h2>Obstacles</h2>
          <p className={styles.subtle}>Drag obstacles on the map. Select one below to resize or delete it.</p>
          <div className={styles.buttonRow}>
            <button className={styles.secondaryButton} type="button" onClick={addZone}>
              Add Zone
            </button>
            <button className={styles.secondaryButton} type="button" onClick={addWall}>
              Add Wall
            </button>
            <button
              className={styles.dangerButton}
              type="button"
              onClick={removeSelectedObstacle}
              disabled={!selectedObstacle}
            >
              Delete Selected Obstacle
            </button>
          </div>

          {selectedZone ? (
            <div className={styles.editor}>
              <label className={styles.field}>
                <span>Zone Radius {selectedZone.radius.toFixed(2)} m</span>
                <input
                  type="range"
                  min={0.5}
                  max={3.5}
                  step={0.05}
                  value={selectedZone.radius}
                  onChange={(event) =>
                    updateZone(selectedZone.id, { radius: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          ) : null}

          {selectedWall ? (
            <div className={styles.editor}>
              <label className={styles.field}>
                <span>Wall Width {selectedWall.width.toFixed(2)} m</span>
                <input
                  type="range"
                  min={0.5}
                  max={8}
                  step={0.1}
                  value={selectedWall.width}
                  onChange={(event) =>
                    updateWall(selectedWall.id, { width: Number(event.target.value) })
                  }
                />
              </label>
              <label className={styles.field}>
                <span>Wall Height {selectedWall.height.toFixed(2)} m</span>
                <input
                  type="range"
                  min={0.5}
                  max={8}
                  step={0.1}
                  value={selectedWall.height}
                  onChange={(event) =>
                    updateWall(selectedWall.id, { height: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          ) : null}
        </article>
      </div>

      <div className={styles.worldGrid}>
        <article className={styles.card}>
          <h2>Digital World</h2>
          <p className={styles.subtle}>Drag emitters or obstacles directly on the map. Double-click to add emitter.</p>
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className={styles.canvas}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerLeave={onCanvasPointerUp}
            onDoubleClick={onCanvasDoubleClick}
          />
          <div className={styles.coordRow}>
            <span className={styles.badge}>X: {listener.x.toFixed(1)}m</span>
            <span className={styles.badge}>Z: {listener.z.toFixed(1)}m</span>
            <span className={styles.badge}>Heading: {listener.headingDeg.toFixed(0)}deg</span>
          </div>
        </article>

        <article className={styles.card}>
          <h2>Emitter Editor</h2>
          <div className={styles.emitterList}>
            {emitters.map((emitter) => (
              <button
                key={emitter.id}
                className={`${styles.emitterCard} ${emitter.id === selectedEmitterId ? styles.activeEmitter : ""}`}
                type="button"
                onClick={() => setSelectedEmitterId(emitter.id)}
              >
                <p>{emitter.name}</p>
                <small>
                  ({emitter.x.toFixed(1)}, {emitter.z.toFixed(1)}) {emitter.frequency.toFixed(0)} Hz
                </small>
              </button>
            ))}
          </div>

          {selectedEmitter ? (
            <div className={styles.editor}>
              <label className={styles.field}>
                <span>Frequency {selectedEmitter.frequency.toFixed(0)} Hz</span>
                <input
                  type="range"
                  min={180}
                  max={1600}
                  step={1}
                  value={selectedEmitter.frequency}
                  onChange={(event) =>
                    updateEmitter(selectedEmitter.id, { frequency: Number(event.target.value) })
                  }
                />
              </label>

              <label className={styles.field}>
                <span>Loudness {selectedEmitter.gain.toFixed(2)}</span>
                <input
                  type="range"
                  min={0.02}
                  max={0.3}
                  step={0.01}
                  value={selectedEmitter.gain}
                  onChange={(event) => updateEmitter(selectedEmitter.id, { gain: Number(event.target.value) })}
                />
              </label>

              <label className={styles.field}>
                <span>Elevation {selectedEmitter.y.toFixed(1)} m</span>
                <input
                  type="range"
                  min={-2}
                  max={2}
                  step={0.1}
                  value={selectedEmitter.y}
                  onChange={(event) => updateEmitter(selectedEmitter.id, { y: Number(event.target.value) })}
                />
              </label>

              <label className={styles.field}>
                <span>Waveform</span>
                <select
                  value={selectedEmitter.waveform}
                  onChange={(event) =>
                    updateEmitter(selectedEmitter.id, { waveform: event.target.value as OscillatorType })
                  }
                >
                  {WAVEFORMS.map((wave) => (
                    <option key={wave} value={wave}>
                      {wave}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={selectedEmitter.moving}
                  onChange={(event) => updateEmitter(selectedEmitter.id, { moving: event.target.checked })}
                />
                Moving emitter
              </label>

              <button className={styles.dangerButton} type="button" onClick={() => removeEmitter(selectedEmitter.id)}>
                Remove Selected
              </button>
            </div>
          ) : (
            <p className={styles.subtle}>No emitter selected.</p>
          )}
        </article>
      </div>
    </section>
  );
}
