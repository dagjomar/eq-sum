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
  const bells: number[] = []
  let gain = preset.wideGainDb
  for (const band of preset.bands) {
    const response = biquadDb(band.type, frequency, band.frequencyHz, band.gainDb, Math.max(band.q, MIN_Q))
    if (band.type === "bell") bells.push(response)
    else gain += response
  }
  gain += parallelBellsDb(bells)
  if (preset.highPass) gain += endFilterDb(preset.highPass, frequency, "hp")
  if (preset.lowPass) gain += endFilterDb(preset.lowPass, frequency, "lp")
  return gain
}

/**
 * Width, in dB, of the round join where two bell skirts cross.
 * A hard min or max leaves a point there. The join moves the crossing by
 * SEAM_DB / 4 and fades out again once the skirts are this far apart.
 */
const SEAM_DB = 6

/**
 * Nova bells share one parallel path. Adding their magnitudes stacks overlapping
 * skirts, so two wide cuts sink below either band. Same-direction bands follow
 * the stronger skirt, with a round join where they cross. Opposite signs can
 * cancel, but they stay inside the range the individual bells already span.
 */
function parallelBellsDb(responses: number[]): number {
  if (responses.length === 0) return 0
  if (responses.length === 1) return responses[0] ?? 0
  const ordered = responses.slice().sort((a, b) => a - b)
  const low = ordered[0] ?? 0
  const high = ordered[ordered.length - 1] ?? 0
  if (high <= 0) return roundedToward(low, ordered[1] ?? low, -1)
  if (low >= 0) return roundedToward(high, ordered[ordered.length - 2] ?? high, 1)
  let sum = 0
  for (const response of responses) sum += response
  return Math.min(high, Math.max(low, sum))
}

function roundedToward(primary: number, other: number, direction: -1 | 1): number {
  const gap = Math.abs(primary - other)
  const room = Math.max(SEAM_DB - gap, 0) / SEAM_DB
  const bump = ((room * room * SEAM_DB) / 4) * seamGate(primary)
  return primary + direction * bump
}

/** Full rounding once a skirt is a few dB from zero, and none on a flat skirt. */
function seamGate(level: number): number {
  const t = Math.min(1, Math.max(0, Math.abs(level) / 3))
  return t * t * (3 - 2 * t)
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
