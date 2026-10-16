/** Map a screenshot pixel to Hz (log) and dB (linear) from two anchors each. */

export const FREQ_TICKS = [20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000] as const
export const CHECK_GAINS = [-24, -18, -12, -6, 6, 12, 18, 24] as const

export interface AnchorX {
  hz: number
  /** Bitmap pixel, origin at the top-left of the source image. */
  x: number
}

export interface AnchorY {
  db: number
  /** Bitmap pixel, origin at the top-left of the source image. */
  y: number
}

export interface PlotAlign {
  freqA: AnchorX
  freqB: AnchorX
  gainA: AnchorY
  gainB: AnchorY
}

export type GuideId = "freqA" | "freqB" | "gainA" | "gainB"

export interface StageFrame {
  offsetX: number
  offsetY: number
  scale: number
}

export function plotAlign(freqA: AnchorX, freqB: AnchorX, gainA: AnchorY, gainB: AnchorY): PlotAlign | null {
  if (!(freqA.hz > 0) || !(freqB.hz > 0) || freqA.hz === freqB.hz) return null
  if (!Number.isFinite(freqA.x) || !Number.isFinite(freqB.x) || freqA.x === freqB.x) return null
  if (!Number.isFinite(gainA.db) || !Number.isFinite(gainB.db) || gainA.db === gainB.db) return null
  if (!Number.isFinite(gainA.y) || !Number.isFinite(gainB.y) || gainA.y === gainB.y) return null
  return { freqA, freqB, gainA, gainB }
}

export function frequencyToImageX(hz: number, align: PlotAlign): number {
  if (!(hz > 0)) return Number.NaN
  const t = (Math.log(hz) - Math.log(align.freqA.hz)) / (Math.log(align.freqB.hz) - Math.log(align.freqA.hz))
  return align.freqA.x + t * (align.freqB.x - align.freqA.x)
}

export function imageXToFrequency(x: number, align: PlotAlign): number {
  const span = align.freqB.x - align.freqA.x
  const t = span === 0 ? 0 : (x - align.freqA.x) / span
  return Math.exp(Math.log(align.freqA.hz) + t * (Math.log(align.freqB.hz) - Math.log(align.freqA.hz)))
}

export function dbToImageY(db: number, align: PlotAlign): number {
  const t = (db - align.gainA.db) / (align.gainB.db - align.gainA.db)
  return align.gainA.y + t * (align.gainB.y - align.gainA.y)
}

export function imageYToDb(y: number, align: PlotAlign): number {
  const span = align.gainB.y - align.gainA.y
  const t = span === 0 ? 0 : (y - align.gainA.y) / span
  return align.gainA.db + t * (align.gainB.db - align.gainA.db)
}

/** Object-fit contain. Scale is stage pixels per bitmap pixel. */
export function stageFrame(stageWidth: number, stageHeight: number, imageWidth: number, imageHeight: number): StageFrame {
  if (stageWidth <= 0 || stageHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { offsetX: 0, offsetY: 0, scale: 1 }
  }
  const scale = Math.min(stageWidth / imageWidth, stageHeight / imageHeight)
  return {
    offsetX: (stageWidth - imageWidth * scale) / 2,
    offsetY: (stageHeight - imageHeight * scale) / 2,
    scale,
  }
}

export function stageToImage(x: number, y: number, frame: StageFrame): { x: number; y: number } {
  return { x: (x - frame.offsetX) / frame.scale, y: (y - frame.offsetY) / frame.scale }
}

export function imageToStage(x: number, y: number, frame: StageFrame): { x: number; y: number } {
  return { x: frame.offsetX + x * frame.scale, y: frame.offsetY + y * frame.scale }
}

/** `slop` is in bitmap pixels. On a tie, a frequency guide wins. */
export function nearestGuide(align: PlotAlign, x: number, y: number, slop: number): GuideId | null {
  if (!(slop > 0)) return null
  const candidates: [GuideId, number][] = [
    ["freqA", Math.abs(x - align.freqA.x)],
    ["freqB", Math.abs(x - align.freqB.x)],
    ["gainA", Math.abs(y - align.gainA.y)],
    ["gainB", Math.abs(y - align.gainB.y)],
  ]
  let best: { id: GuideId; distance: number } | null = null
  for (const [id, distance] of candidates) {
    if (distance > slop) continue
    if (!best || distance < best.distance) best = { id, distance }
  }
  return best?.id ?? null
}
