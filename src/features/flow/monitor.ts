// Geometry of the desktop monitor the simulators draw for a computer (pure: shared by layouts and the Konva drawing).

type Frame = { x: number; y: number; w: number; h: number };

/** Height of a desktop monitor's neck and base, drawn below its frame. */
export const MONITOR_STAND = 22;
/** The screen area inside a monitor's bezel: thin bezel at the sides and top, a chin at the bottom. */
export function monitorScreen(frame: Frame, side = 10, chin = 26): Frame {
  return { x: frame.x + side, y: frame.y + side, w: frame.w - 2 * side, h: frame.h - side - chin };
}
