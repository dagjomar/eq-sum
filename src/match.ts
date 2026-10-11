import type { BandType, NovaPreset } from "./nova/types"

export type NodeBudget = 4 | 8 | 12

export const FILTER_SLOPES = [6, 12, 24, 72]

/** Move one slope step. Scroll up is steeper. Stops at the ends. */
export function stepSlope(current: number, direction: 1 | -1): number {
  let index = FILTER_SLOPES.indexOf(current)
  if (index < 0) {
    index = 0
    let best = Infinity
    FILTER_SLOPES.forEach((slope, candidate) => {
      const distance = Math.abs(slope - current)
      if (distance < best) {
        best = distance
        index = candidate
      }
    })
  }
  const next = Math.min(FILTER_SLOPES.length - 1, Math.max(0, index + direction))
  return FILTER_SLOPES[next] ?? current
}

export interface MatchBand {
  id: string
  type: BandType
  frequencyHz: number
  gainDb: number
  q: number
  enabled: boolean
}

export interface MatchFilter {
  frequencyHz: number
  slopeDbPerOct: number
  enabled: boolean
}

export interface MatchInstance {
  id: string
  name: string
  color: string
  muted: boolean
  solo: boolean
  bands: (MatchBand | null)[]
  highPass: MatchFilter | null
  lowPass: MatchFilter | null
}

export function emptyBands(): (MatchBand | null)[] {
  return [null, null, null, null]
}

/** Keep four fixed slots. Older saves stored only the bands that were on. */
export function normalizeMatch(instance: MatchInstance): MatchInstance {
  const bands = emptyBands()
  instance.bands.forEach((band, index) => {
    if (!band || index > 3) return
    bands[index] = { ...band, enabled: band.enabled !== false }
  })
  return { ...instance, bands, highPass: normalizeFilter(instance.highPass), lowPass: normalizeFilter(instance.lowPass) }
}

function normalizeFilter(filter: MatchFilter | null): MatchFilter | null {
  if (!filter || !Number.isFinite(filter.frequencyHz) || !Number.isFinite(filter.slopeDbPerOct)) return null
  return { ...filter, enabled: filter.enabled !== false }
}

export function nodeCount(instances: MatchInstance[]): number {
  return instances.reduce((total, instance) => total + instance.bands.filter((band) => band?.enabled).length, 0)
}

export function instanceLimit(budget: NodeBudget): number {
  return budget / 4
}

export function toPreset(instance: MatchInstance): NovaPreset {
  return {
    variant: "TDRNova",
    bands: instance.bands.flatMap((band, index) => {
      if (!band?.enabled) return []
      return [{ index: index + 1, type: band.type, frequencyHz: band.frequencyHz, gainDb: band.gainDb, q: band.q, dynamics: false as const }]
    }),
    highPass: instance.highPass?.enabled ? instance.highPass : null,
    lowPass: instance.lowPass?.enabled ? instance.lowPass : null,
    wideGainDb: 0,
    warnings: [],
  }
}

/** Mean and max absolute error from 20 Hz to 20 kHz. */
export function fitError(
  frequencies: number[],
  reference: number[],
  actual: number[],
): { mean: number; max: number } | null {
  if (reference.length === 0 || actual.length !== reference.length) return null
  let count = 0
  let total = 0
  let max = 0
  for (let i = 0; i < frequencies.length; i++) {
    const frequency = frequencies[i] ?? 0
    if (frequency < 20 || frequency > 20_000) continue
    const delta = Math.abs((actual[i] ?? 0) - (reference[i] ?? 0))
    total += delta
    if (delta > max) max = delta
    count += 1
  }
  if (count === 0) return null
  return { mean: total / count, max }
}
