"use client";

/** Registers the renderer, scene and camera in lib/sceneRig.ts, for the voice's screenshot and shader warm-ups. */
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";

import { disposeFinish, renderView } from "@/lib/finish";
import { sceneRig } from "@/lib/sceneRig";

export function Capture() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    sceneRig.gl = gl;
    sceneRig.scene = scene;
    sceneRig.camera = camera;
    sceneRig.draw = () => renderView(gl, scene, camera);
    return () => {
      sceneRig.gl = sceneRig.scene = sceneRig.camera = null;
      sceneRig.draw = null;
      disposeFinish();
    };
  }, [gl, scene, camera]);
  return null;
}
