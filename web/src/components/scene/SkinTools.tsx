"use client";

/**
 * Clicking and brushing on the face: placing a scar or mark (lib/marks.ts) and sculpting (lib/sculpt.ts). While either
 * is armed the camera stops orbiting, the pointer is a crosshair, and the canvas's pointer goes to the tool: a click
 * places the mark; a drag sculpts (one dab per frame while the pointer moves; Grab drags the skin with it). Escape
 * disarms both.
 */
import { useThree } from "@react-three/fiber";
import { useEffect, useSyncExternalStore } from "react";
import { type Camera, Raycaster, Vector2, Vector3, type WebGLRenderer } from "three";

import { marksSnapshot, onMarksChange, placeMark, placingMark, startPlacing } from "@/lib/marks";
import { beginStroke, dab, dragTo, endStroke, onSculptChange, sculptSnapshot, sculptTool, setSculptTool } from "@/lib/sculpt";
import { pickSkin } from "@/lib/skinPick";

/** Take the canvas pointer for the tools until the returned cleanup (camera orbit off, crosshair). */
function armSkinTools(gl: WebGLRenderer, camera: Camera, controls: { enabled: boolean } | null): () => void {
  const canvas = gl.domElement;
  const raycaster = new Raycaster();
  if (controls) controls.enabled = false;
  canvas.style.cursor = "crosshair";
  const ndc = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  let down = false;
  let queued: PointerEvent | null = null;
  let raf = 0;
  const step = () => {
    raf = 0;
    const e = queued;
    queued = null;
    if (!e || !down) return;
    if (sculptTool.brush === "grab") {
      raycaster.setFromCamera(ndc(e), camera);
      dragTo(raycaster.ray);
    } else {
      const hit = pickSkin(ndc(e), camera);
      if (hit) dab(hit.world);
    }
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const hit = pickSkin(ndc(e), camera);
    if (placingMark()) {
      e.preventDefault();
      if (hit) placeMark(hit.rest.toArray() as [number, number, number], hit.restNormal.toArray() as [number, number, number]);
      return;
    }
    if (!sculptTool.on || !hit) return;
    e.preventDefault();
    down = true;
    canvas.setPointerCapture?.(e.pointerId);
    beginStroke(hit.world, camera.getWorldDirection(new Vector3()));
  };
  const onMove = (e: PointerEvent) => {
    if (!down) return;
    queued = e;
    if (!raf) raf = requestAnimationFrame(step);
  };
  const onUp = () => {
    if (!down) return;
    down = false;
    endStroke();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    startPlacing(null);
    setSculptTool({ on: false });
  };
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("keydown", onKey);
  return () => {
    canvas.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("keydown", onKey);
    cancelAnimationFrame(raf);
    if (down) endStroke();
    if (controls) controls.enabled = true;
    canvas.style.cursor = "";
  };
}

export function SkinTools() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const placing = useSyncExternalStore(onMarksChange, () => marksSnapshot().placing, () => null);
  const sculpting = useSyncExternalStore(onSculptChange, () => sculptSnapshot().tool.on, () => false);
  const active = !!placing || sculpting;

  useEffect(() => (active ? armSkinTools(gl, camera, controls) : undefined), [active, gl, camera, controls]);

  return null;
}
