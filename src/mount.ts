import { mountPond } from "ascii-pond";
import type { MountOptions, PondHandle } from "ascii-pond";
import { KoiSim } from "./koi.js";

// Mount a koi pond on a <canvas> or any element: water, two koi and lily pads. Takes the same
// options as ascii-pond's mountPond; a narrow grid (under 64 columns) gets half-size koi.
export function mountKoi(target: HTMLElement, options: Omit<MountOptions, "scene"> = {}): PondHandle {
  return mountPond(target, { ...options, scene: (cols, rows) => new KoiSim(cols, rows, cols < 64 ? 0.5 : 1) });
}
