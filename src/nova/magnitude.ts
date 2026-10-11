import type { BandType, NovaFilter, NovaPreset } from "./types"

/** Display sample rate. High enough that bilinear warping stays small through 20 kHz. */
const SAMPLE_RATE = 192_000
const MIN_Q = 0.05

export function responseDb(preset: NovaPreset, frequencies: number[]): number[] {
  return frequencies.map((frequency) => gainAt(preset, frequency))
}

export function sumCurves(curves: number[][]): number[] {
  if (curves.length === 0) return []
  const length = curves[0].length
  const sum = new Array<number>(length).fill(0)
  for (const curve of curves) {
    for (let i = 0; i < length; i++) sum[i] += curve[i] ?? 0
  }
  return sum
}

export function logFrequencies(count: number, startHz = 10, endHz = 40_000): number[] {
  const start = Math.log(startHz)
  const end = Math.log(endHz)
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0 : index / (count - 1)
    return Math.exp(start + (end - start) * t)
  })
}

function gainAt(preset: NovaPreset, frequency: number): number {
  const cuts: number[] = []
  const boosts: number[] = []
  let gain = preset.wideGainDb
  for (const band of preset.bands) {
    const response = biquadDb(band.type, frequency, band.frequencyHz, band.gainDb, Math.max(band.q, MIN_Q))
    if (response < -1e-4) cuts.push(response)
    else if (response > 1e-4) boosts.push(response)
  }
  gain += parallelGroup(cuts, -1)
  gain += parallelGroup(boosts, 1)
  if (preset.highPass) gain += endFilterDb(preset.highPass, frequency, "hp")
  if (preset.lowPass) gain += endFilterDb(preset.lowPass, frequency, "lp")
  return gain
}

/**
 * Bells and shelves share one parallel path. Same-sign bands follow the stronger
 * skirt instead of stacking, so a low shelf and a high shelf meet in a dome.
 * The soft pair keeps that crossing round. A tight pair still sinks a little
 * below either node. Opposite signs add, but each side stays in its own group.
 */
function parallelGroup(responses: number[], direction: -1 | 1): number {
  if (responses.length === 0) return 0
  if (responses.length === 1) return responses[0] ?? 0
  let primary = direction < 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  let second = primary
  for (const response of responses) {
    const stronger = direction < 0 ? response < primary : response > primary
    const runner = direction < 0 ? response < second : response > second
    if (stronger) {
      second = primary
      primary = response
    } else if (runner) {
      second = response
    }
  }
  if (!Number.isFinite(second)) return primary
  return smoothPair(primary, second, direction)
}

function smoothPair(primary: number, other: number, direction: -1 | 1): number {
  const depth = Math.abs(primary)
  const tau = 0.9 + (depth / 18) * 5.2
  if (direction < 0) {
    const floor = Math.min(primary, other)
    return floor - tau * Math.log(Math.exp(-(primary - floor) / tau) + Math.exp(-(other - floor) / tau))
  }
  const ceiling = Math.max(primary, other)
  return ceiling + tau * Math.log(Math.exp((primary - ceiling) / tau) + Math.exp((other - ceiling) / tau))
}

function endFilterDb(filter: NovaFilter, frequency: number, kind: "hp" | "lp"): number {
  const order = filter.slopeDbPerOct / 6
  const ratio = frequency / filter.frequencyHz
  const power = ratio ** (2 * order)
  const magnitude = kind === "lp" ? 1 / Math.sqrt(1 + power) : ratio ** order / Math.sqrt(1 + power)
  return 20 * Math.log10(Math.max(magnitude, 1e-12))
}

function biquadDb(
  type: BandType,
  frequency: number,
  centerHz: number,
  gainDb: number,
  q: number,
): number {
  const omega = (2 * Math.PI * centerHz) / SAMPLE_RATE
  const sine = Math.sin(omega)
  const cosine = Math.cos(omega)
  const alpha = sine / (2 * q)
  const a = 10 ** (gainDb / 40)
  const [b0, b1, b2, a0, a1, a2] =
    type === "bell"
      ? peaking(a, alpha, cosine)
      : type === "low-shelf"
        ? lowShelf(a, alpha, cosine)
        : highShelf(a, alpha, cosine)
  return magnitudeDb(b0, b1, b2, a0, a1, a2, (2 * Math.PI * frequency) / SAMPLE_RATE)
}

function peaking(a: number, alpha: number, cosine: number): number[] {
  return [1 + alpha * a, -2 * cosine, 1 - alpha * a, 1 + alpha / a, -2 * cosine, 1 - alpha / a]
}

function lowShelf(a: number, alpha: number, cosine: number): number[] {
  const root = 2 * Math.sqrt(a) * alpha
  const aPlus = a + 1
  const aMinus = a - 1
  return [
    a * (aPlus - aMinus * cosine + root),
    2 * a * (aMinus - aPlus * cosine),
    a * (aPlus - aMinus * cosine - root),
    aPlus + aMinus * cosine + root,
    -2 * (aMinus + aPlus * cosine),
    aPlus + aMinus * cosine - root,
  ]
}

function highShelf(a: number, alpha: number, cosine: number): number[] {
  const root = 2 * Math.sqrt(a) * alpha
  const aPlus = a + 1
  const aMinus = a - 1
  return [
    a * (aPlus + aMinus * cosine + root),
    -2 * a * (aMinus + aPlus * cosine),
    a * (aPlus + aMinus * cosine - root),
    aPlus - aMinus * cosine + root,
    2 * (aMinus - aPlus * cosine),
    aPlus - aMinus * cosine - root,
  ]
}

function magnitudeDb(
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number,
  omega: number,
): number {
  const cosine = Math.cos(omega)
  const sine = Math.sin(omega)
  const cosine2 = Math.cos(2 * omega)
  const sine2 = Math.sin(2 * omega)
  const numeratorReal = b0 + b1 * cosine + b2 * cosine2
  const numeratorImag = -(b1 * sine + b2 * sine2)
  const denominatorReal = a0 + a1 * cosine + a2 * cosine2
  const denominatorImag = -(a1 * sine + a2 * sine2)
  const numerator = numeratorReal * numeratorReal + numeratorImag * numeratorImag
  const denominator = denominatorReal * denominatorReal + denominatorImag * denominatorImag
  if (denominator === 0) return 0
  return 10 * Math.log10(Math.max(numerator / denominator, 1e-24))
}
