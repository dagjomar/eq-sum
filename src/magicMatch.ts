import { FILTER_SLOPES, fitError, toPreset, type MatchBand, type MatchFilter } from "./match"
import { logFrequencies, responseDb } from "./nova/magnitude"
import type { BandType } from "./nova/types"

const BAND_SLOTS = 4
const MIN_FREQ = 10
const MAX_FREQ = 40_000
const MIN_GAIN = -18
const MAX_GAIN = 18
const MIN_Q = 0.35
const MAX_Q = 10
const GAIN_DISABLE = 0.15
const SEARCH_POINTS = 144
/** Include ultrasonic edge so shelf vs bell at HF is visible to the scorer. */
const SEARCH_START_HZ = 10
const SEARCH_END_HZ = 40_000
const COVERAGE_DB = 0.75
const FEATURE_HALF_WIDTH = 0.55
const OVERSHOOT = 1.4
const GLOBAL_MEAN_WEIGHT = 0.15
const GLOBAL_MAX_WEIGHT = 0.35
const COVERAGE_WEIGHT = 1.1
const EDGE_WEIGHT = 0.85
/** Tiny cost per active node — not enough to drop a real residual feature. */
const SPARSITY = 0.01
/** Penalize leaving free slots empty while unmatched features remain. */
const UNDERUSE = 0.22
const QUICK_POP = 14
const QUICK_GENS = 28
const DEEP_POP = 20
const DEEP_GENS = 70
const DEEP_KEEP = 8
const F = 0.75
const CR = 0.9
const LOCKED_F = 0.22
const LOCKED_JITTER = 0.12

export interface MagicMatchResult {
  bands: (MatchBand | null)[]
  highPass: MatchFilter | null
  lowPass: MatchFilter | null
  error: { mean: number; max: number }
}

/** One slice of a multi-Nova fit. Free bands stay inside the frequency edges. */
export interface MatchRegion {
  minHz: number
  maxHz: number
  /** When false, the shared edge belongs to the region below. */
  includeMin: boolean
  includeMax: boolean
  allowHighPass: boolean
  allowLowPass: boolean
  allowLowShelf: boolean
  allowHighShelf: boolean
}

export interface MagicMatchOptions {
  /** Deterministic unit interval RNG for tests. Defaults to Math.random. */
  random?: () => number
  /**
   * Existing Match bands. Locked+enabled slots keep type/on; continuous
   * params may nudge slightly. Free slots are re-fit against the residual.
   */
  bands?: (MatchBand | null)[]
  /** Locked HP/LP stay on with fixed slope; frequency may nudge slightly. */
  highPass?: MatchFilter | null
  lowPass?: MatchFilter | null
  /**
   * Fit only this part of the curve. Samples outside are treated as 0 dB
   * so the Nova meets its neighbor at the edge instead of leaking across.
   */
  region?: MatchRegion
}

export interface MagicMatchTarget {
  bands?: (MatchBand | null)[]
  highPass?: MatchFilter | null
  lowPass?: MatchFilter | null
}

export interface MagicMatchAllResult {
  results: MagicMatchResult[]
  /** Interior split frequencies, low to high. Empty when only one Nova is fit. */
  splitHz: number[]
  error: { mean: number; max: number }
}

export interface Feature {
  index: number
  frequencyHz: number
  gainDb: number
  preferredType: BandType
  weight: number
  halfWidth: number
  openToLowEdge: boolean
  openToHighEdge: boolean
}

export interface EndFilterHints {
  highPass: boolean
  lowPass: boolean
}

interface BandGene {
  enabled: boolean
  type: BandType
  logFreq: number
  gainDb: number
  logQ: number
  locked: boolean
  id: string | null
}

interface FilterGene {
  enabled: boolean
  logFreq: number
  slopeIndex: number
  locked: boolean
}

interface Genotype {
  bands: BandGene[]
  highPass: FilterGene
  lowPass: FilterGene
}

interface Layout {
  types: (BandType | null)[]
  highPass: FilterGene
  lowPass: FilterGene
}

interface ScoreContext {
  frequencies: number[]
  reference: number[]
  features: Feature[]
  endHints: EndFilterHints
  region?: MatchRegion
}

/** Fit one Nova (4 bands + optional HP/LP) to a reference magnitude curve. */
export function magicMatch(
  referenceDb: number[],
  frequencies: number[],
  options: MagicMatchOptions = {},
): MagicMatchResult {
  if (referenceDb.length === 0 || referenceDb.length !== frequencies.length) {
    return emptyResult(options)
  }

  const random = options.random ?? Math.random
  const region = options.region
  const lockedSlots = readLockedSlots(options.bands)
  const lockedHighPass = readLockedFilter(options.highPass, "hp")
  const lockedLowPass = readLockedFilter(options.lowPass, "lp")
  const searchFreqs = logFrequencies(SEARCH_POINTS, SEARCH_START_HZ, SEARCH_END_HZ)
  const searchRef = maskRegion(sampleCurve(frequencies, referenceDb, searchFreqs), searchFreqs, region)

  // Fit free bands to residual after locked contribution.
  const lockedCurve = lockedResponse(lockedSlots, lockedHighPass, lockedLowPass, searchFreqs)
  const residual = searchRef.map((value, index) => value - (lockedCurve[index] ?? 0))
  const endHints = detectEndFilterHints(searchFreqs, searchRef)
  const features = keepFeatures(detectFeatures(searchFreqs, residual, endHints), region)
  const ctx: ScoreContext = {
    frequencies: searchFreqs,
    reference: searchRef,
    features: keepFeatures(detectFeatures(searchFreqs, searchRef, endHints), region),
    endHints,
    region,
  }
  // Free-slot search still uses residual features; full reference for scoring.
  const freeFeatures = features
  const layouts = enumerateLayouts(
    freeFeatures,
    searchFreqs,
    residual,
    lockedSlots,
    endHints,
    lockedHighPass,
    lockedLowPass,
    region,
  )
  if (layouts.length === 0) {
    return emptyResult(options)
  }

  let best: Genotype | null = null
  let bestScore = Infinity

  const seeded = layouts
    .map((layout) => {
      const gene = seedLayout(layout, freeFeatures, searchFreqs, residual, lockedSlots)
      return { gene, score: scoreGenotype(gene, ctx) }
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, Math.min(layouts.length, 18))

  const ranked: { gene: Genotype; score: number }[] = []
  for (const candidate of seeded) {
    const settled = settle(candidate.gene, ctx, QUICK_POP, QUICK_GENS, random, false)
    const score = scoreGenotype(settled, ctx)
    ranked.push({ gene: settled, score })
    if (score < bestScore) {
      bestScore = score
      best = settled
    }
  }

  ranked.sort((a, b) => a.score - b.score)
  for (const candidate of ranked.slice(0, DEEP_KEEP)) {
    const deep = settle(candidate.gene, ctx, DEEP_POP, DEEP_GENS, random, true)
    const score = scoreGenotype(deep, ctx)
    if (score < bestScore) {
      bestScore = score
      best = deep
    }
  }

  const polished = polish(
    best ?? seedFromResidual(searchFreqs, residual, lockedSlots, lockedHighPass, lockedLowPass),
    region,
  )
  const bands = genesToBands(polished.bands)
  const highPass = geneToFilter(polished.highPass)
  const lowPass = geneToFilter(polished.lowPass)
  const actual = responseDb(dummyPreset(bands, highPass, lowPass), frequencies)
  const target = maskRegion(referenceDb, frequencies, region)
  const error = fitError(frequencies, target, actual) ?? { mean: 0, max: 0 }
  return { bands, highPass, lowPass, error }
}

const FIT_LOW_HZ = 20
const FIT_HIGH_HZ = 20_000
const CROSS_DB = 0.8

/**
 * Fit each target to its own part of the reference.
 * One target is a normal Magic Match. Two or more split the curve at 0 dB
 * crossings near the log-spaced division points. The lowest Nova keeps the
 * high-pass and gives up the low-pass; the highest does the opposite.
 * Each Nova is fit to what's left after the Novas below it, so a low-side
 * tail doesn't get matched a second time.
 */
export function magicMatchAll(
  referenceDb: number[],
  frequencies: number[],
  targets: MagicMatchTarget[],
  options: { random?: () => number } = {},
): MagicMatchAllResult {
  if (targets.length === 0) return { results: [], splitHz: [], error: { mean: 0, max: 0 } }
  if (targets.length === 1) {
    const only = targets[0]!
    const result = magicMatch(referenceDb, frequencies, {
      bands: only.bands,
      highPass: only.highPass,
      lowPass: only.lowPass,
      random: options.random,
    })
    return { results: [result], splitHz: [], error: result.error }
  }

  const splitHz = splitFrequencies(frequencies, referenceDb, targets.length)
  const regions = matchRegions(splitHz)
  const results: MagicMatchResult[] = []
  const accounted = new Array<number>(frequencies.length).fill(0)
  targets.forEach((target, index) => {
    const residual = referenceDb.map((value, bin) => value - (accounted[bin] ?? 0))
    const result = magicMatch(residual, frequencies, {
      bands: target.bands,
      highPass: target.highPass,
      lowPass: target.lowPass,
      random: options.random,
      region: regions[index],
    })
    results.push(result)
    const actual = responseDb(dummyPreset(result.bands, result.highPass, result.lowPass), frequencies)
    for (let bin = 0; bin < accounted.length; bin++) accounted[bin] = (accounted[bin] ?? 0) + (actual[bin] ?? 0)
  })
  const error = fitError(frequencies, referenceDb, accounted) ?? { mean: 0, max: 0 }
  return { results, splitHz, error }
}

/** Interior split points for `parts` Novas, each near a 0 dB crossing. */
export function splitFrequencies(frequencies: number[], reference: number[], parts: number): number[] {
  if (parts <= 1 || frequencies.length < 2 || frequencies.length !== reference.length) return []
  const smoothed = smooth(reference, 1)
  const anchors = Array.from({ length: parts - 1 }, (_, index) => logLerp(FIT_LOW_HZ, FIT_HIGH_HZ, (index + 1) / parts))
  const cuts: number[] = []
  let previous = 40
  anchors.forEach((anchor, index) => {
    const window = searchWindow(anchor, index, anchors)
    const crossings = meaningfulCrossings(frequencies, smoothed, window.minHz, window.maxHz)
    const near = crossings.length > 0 ? closestHz(crossings, anchor) : quietestNear(frequencies, smoothed, anchor, window.minHz, window.maxHz)
    const hz = Math.min(window.maxHz, Math.max(near, previous * 1.25))
    cuts.push(hz)
    previous = hz
  })
  return cuts
}

/** Region permissions for Novas ordered low to high around `splitHz`. */
export function matchRegions(splitHz: number[]): MatchRegion[] {
  const edges = [MIN_FREQ, ...splitHz, MAX_FREQ]
  const last = splitHz.length
  return Array.from({ length: splitHz.length + 1 }, (_, index) => ({
    minHz: edges[index] ?? MIN_FREQ,
    maxHz: edges[index + 1] ?? MAX_FREQ,
    includeMin: index === 0,
    includeMax: true,
    allowHighPass: index === 0,
    allowLowPass: index === last,
    allowLowShelf: index === 0,
    allowHighShelf: index === last,
  }))
}

function logLerp(low: number, high: number, t: number): number {
  return Math.exp(Math.log(low) + (Math.log(high) - Math.log(low)) * t)
}

function searchWindow(anchor: number, index: number, anchors: number[]): { minHz: number; maxHz: number } {
  const span = 2 ** (anchors.length === 1 ? 2 : 1.5)
  let minHz = anchor / span
  let maxHz = anchor * span
  if (index > 0) minHz = Math.max(minHz, (anchors[index - 1] ?? anchor) * 1.2)
  if (index < anchors.length - 1) maxHz = Math.min(maxHz, (anchors[index + 1] ?? anchor) / 1.2)
  if (maxHz <= minHz * 1.1) {
    minHz = anchor / 1.5
    maxHz = anchor * 1.5
  }
  return { minHz: Math.max(40, minHz), maxHz: Math.min(16_000, maxHz) }
}

function meaningfulCrossings(frequencies: number[], values: number[], minHz: number, maxHz: number): number[] {
  const found: number[] = []
  for (let i = 1; i < frequencies.length; i++) {
    const f0 = frequencies[i - 1] ?? 0
    const f1 = frequencies[i] ?? 0
    if (f1 < minHz || f0 > maxHz) continue
    const y0 = values[i - 1] ?? 0
    const y1 = values[i] ?? 0
    if (!(y0 === 0 || y1 === 0 || y0 * y1 < 0)) continue
    if (y0 === 0 && y1 === 0) continue
    const reach = Math.max(excursion(frequencies, values, i - 1, -1), excursion(frequencies, values, i, 1))
    if (reach < CROSS_DB) continue
    const denom = Math.abs(y0) + Math.abs(y1)
    const t = denom === 0 ? 0 : Math.abs(y0) / denom
    const hz = Math.exp(Math.log(Math.max(f0, 1)) + t * (Math.log(Math.max(f1, 1)) - Math.log(Math.max(f0, 1))))
    if (hz >= minHz && hz <= maxHz) found.push(hz)
  }
  return found
}

function excursion(frequencies: number[], values: number[], index: number, direction: -1 | 1): number {
  const origin = Math.log(Math.max(frequencies[index] ?? 1, 1))
  let peak = Math.abs(values[index] ?? 0)
  for (let i = index + direction; i >= 0 && i < values.length; i += direction) {
    const hz = Math.max(frequencies[i] ?? 1, 1)
    if (Math.abs(Math.log(hz) - origin) > 0.55) break
    peak = Math.max(peak, Math.abs(values[i] ?? 0))
  }
  return peak
}

function closestHz(values: number[], anchor: number): number {
  return values.reduce((best, hz) => (Math.abs(Math.log(hz / anchor)) < Math.abs(Math.log(best / anchor)) ? hz : best))
}

function quietestNear(frequencies: number[], values: number[], anchor: number, minHz: number, maxHz: number): number {
  let bestHz = clamp(anchor, minHz, maxHz)
  let best = Infinity
  for (let i = 0; i < frequencies.length; i++) {
    const hz = frequencies[i] ?? 0
    if (hz < minHz || hz > maxHz) continue
    const octaves = Math.abs(Math.log(hz / anchor) / Math.LN2)
    const score = Math.abs(values[i] ?? 0) + octaves * 0.85
    if (score < best) {
      best = score
      bestHz = hz
    }
  }
  return bestHz
}

function maskRegion(values: number[], frequencies: number[], region?: MatchRegion): number[] {
  if (!region) return values
  return values.map((value, index) => (frequencyInRegion(frequencies[index] ?? 0, region) ? value : 0))
}

function frequencyInRegion(frequency: number, region: MatchRegion): boolean {
  // The log grid's last step can land a hair above 40 kHz. Keep that bin when
  // the region owns the outer edge, so a low-pass doesn't look like it returns to 0.
  const minEdge = region.minHz <= MIN_FREQ * 1.01 ? region.minHz * 0.999 : region.minHz
  const maxEdge = region.maxHz >= MAX_FREQ * 0.99 ? region.maxHz * 1.001 : region.maxHz
  const above = region.includeMin ? frequency >= minEdge : frequency > region.minHz
  const below = region.includeMax ? frequency <= maxEdge : frequency < region.maxHz
  return above && below
}

function keepFeatures(features: Feature[], region?: MatchRegion): Feature[] {
  if (!region) return features
  return features.filter((feature) => frequencyInRegion(feature.frequencyHz, region))
}

function coerceType(type: BandType, region?: MatchRegion): BandType {
  if (!region) return type
  if (type === "low-shelf" && !region.allowLowShelf) return "bell"
  if (type === "high-shelf" && !region.allowHighShelf) return "bell"
  return type
}

function clampToRegion(gene: Genotype, region?: MatchRegion): void {
  if (!region) return
  const minHz = clamp(region.minHz, MIN_FREQ, MAX_FREQ)
  const maxHz = clamp(region.maxHz, minHz, MAX_FREQ)
  for (const band of gene.bands) {
    if (!band.enabled || band.locked) continue
    band.logFreq = clamp(band.logFreq, Math.log(minHz), Math.log(maxHz))
    band.type = coerceType(band.type, region)
  }
  if (!region.allowHighPass && !gene.highPass.locked) gene.highPass.enabled = false
  if (!region.allowLowPass && !gene.lowPass.locked) gene.lowPass.enabled = false
  if (gene.lowPass.enabled && !gene.lowPass.locked && region.allowLowPass) {
    const lpMin = Math.max(1000, region.minHz)
    gene.lowPass.logFreq = clamp(gene.lowPass.logFreq, Math.log(lpMin), Math.log(MAX_FREQ))
  }
}

/** Ordered residual features for search / tests. */
export function detectFeatures(
  frequencies: number[],
  reference: number[],
  endHints: EndFilterHints = detectEndFilterHints(frequencies, reference),
): Feature[] {
  // Nova same-sign bands join in parallel, so one curve pass often hides
  // weaker bells. Peel features off the residual until slots are filled.
  let residual = smooth(reference, 2)
  const collected: Feature[] = []
  for (let round = 0; round < BAND_SLOTS; round++) {
    const peaks = findExtrema(frequencies, residual).filter((peak) => {
      if (endHints.highPass && peak.index <= 2) return false
      if (endHints.lowPass && peak.index >= frequencies.length - 3) return false
      const near = collected.some(
        (feature) => Math.abs(Math.log(feature.frequencyHz / peak.frequencyHz)) < 0.28,
      )
      return !near && Math.abs(peak.gainDb) >= 0.55
    })
    const peak = peaks[0]
    if (!peak) break
    const span = sameSignSpan(frequencies, residual, peak.index, Math.sign(peak.gainDb) || 1)
    const openToLowEdge = !endHints.highPass && isOpenToEdge(frequencies, residual, peak, "low")
    const openToHighEdge = !endHints.lowPass && isOpenToEdge(frequencies, residual, peak, "high")
    const halfWidth = clamp(0.28 + span * 0.18, 0.28, FEATURE_HALF_WIDTH + 0.35)
    collected.push({
      index: peak.index,
      frequencyHz: peak.frequencyHz,
      gainDb: peak.gainDb,
      preferredType: pickType(frequencies, residual, peak, openToLowEdge, openToHighEdge),
      weight: 1,
      halfWidth,
      openToLowEdge,
      openToHighEdge,
    })
    residual = subtractProvisionalBand(frequencies, residual, peak)
  }

  const maxAbs = Math.max(...collected.map((feature) => Math.abs(feature.gainDb)), 0.5)
  return collected
    .map((feature) => ({
      ...feature,
      weight: 1.2 + 3.8 * (Math.abs(feature.gainDb) / maxAbs),
    }))
    .sort((a, b) => Math.abs(b.gainDb) - Math.abs(a.gainDb))
}

/** Remove an approximate bell from the residual so weaker neighbors can surface. */
function subtractProvisionalBand(
  frequencies: number[],
  residual: number[],
  peak: { frequencyHz: number; gainDb: number },
): number[] {
  const probe = responseDb(
    {
      variant: "TDRNova",
      bands: [
        {
          index: 1,
          type: "bell",
          frequencyHz: peak.frequencyHz,
          gainDb: peak.gainDb,
          q: 1,
          dynamics: false,
        },
      ],
      highPass: null,
      lowPass: null,
      wideGainDb: 0,
      warnings: [],
    },
    frequencies,
  )
  return residual.map((value, index) => value - (probe[index] ?? 0))
}

/** True when the extreme keeps falling steeply (HP/LP), not leveling like a shelf. */
export function detectEndFilterHints(frequencies: number[], reference: number[]): EndFilterHints {
  const smoothed = smooth(reference, 2)
  return {
    highPass: looksLikeEndFilter(frequencies, smoothed, "hp"),
    lowPass: looksLikeEndFilter(frequencies, smoothed, "lp"),
  }
}

/** Residual extrema → preferred overshoot seed. Exported for tests. */
export function seedFromResidual(
  frequencies: number[],
  reference: number[],
  lockedSlots: (BandGene | null)[] = emptyLockedSlots(),
  lockedHighPass: FilterGene | null = null,
  lockedLowPass: FilterGene | null = null,
): Genotype {
  const endHints = detectEndFilterHints(frequencies, reference)
  const features = detectFeatures(frequencies, reference, endHints)
  const highPass =
    lockedHighPass ?? detectEndFilter(frequencies, smooth(reference, 2), "hp", endHints)
  const lowPass =
    lockedLowPass ?? detectEndFilter(frequencies, smooth(reference, 2), "lp", endHints)
  const types: (BandType | null)[] = lockedSlots.map((slot) => (slot?.enabled ? slot.type : null))
  const free = freeSlotIndices(lockedSlots)
  features.slice(0, free.length).forEach((feature, index) => {
    const slot = free[index]
    if (slot === undefined) return
    types[slot] = feature.preferredType
  })
  return seedLayout({ types, highPass, lowPass }, features, frequencies, reference, lockedSlots)
}

function emptyResult(options: MagicMatchOptions = {}): MagicMatchResult {
  return {
    bands: options.bands ? options.bands.map((band) => (band ? { ...band } : null)) : [null, null, null, null],
    highPass: options.highPass?.locked && options.highPass.enabled ? { ...options.highPass } : null,
    lowPass: options.lowPass?.locked && options.lowPass.enabled ? { ...options.lowPass } : null,
    error: { mean: 0, max: 0 },
  }
}

function offFilter(kind: "hp" | "lp"): FilterGene {
  return {
    enabled: false,
    logFreq: Math.log(kind === "hp" ? 30 : 16_000),
    slopeIndex: 1,
    locked: false,
  }
}

function readLockedFilter(filter: MatchFilter | null | undefined, _kind: "hp" | "lp"): FilterGene | null {
  if (!filter?.locked || !filter.enabled) return null
  let slopeIndex = FILTER_SLOPES.indexOf(filter.slopeDbPerOct)
  if (slopeIndex < 0) slopeIndex = 1
  return {
    enabled: true,
    logFreq: Math.log(clamp(filter.frequencyHz, MIN_FREQ, MAX_FREQ)),
    slopeIndex,
    locked: true,
  }
}

function emptyLockedSlots(): (BandGene | null)[] {
  return [null, null, null, null]
}

function readLockedSlots(bands: (MatchBand | null)[] | undefined): (BandGene | null)[] {
  const slots = emptyLockedSlots()
  if (!bands) return slots
  bands.forEach((band, index) => {
    if (!band || index > 3 || !band.locked || !band.enabled) return
    slots[index] = {
      enabled: true,
      type: band.type,
      logFreq: Math.log(clamp(band.frequencyHz, MIN_FREQ, MAX_FREQ)),
      gainDb: clamp(band.gainDb, MIN_GAIN, MAX_GAIN),
      logQ: Math.log(clamp(band.q, MIN_Q, MAX_Q)),
      locked: true,
      id: band.id,
    }
  })
  return slots
}

function lockedResponse(
  lockedSlots: (BandGene | null)[],
  lockedHighPass: FilterGene | null,
  lockedLowPass: FilterGene | null,
  frequencies: number[],
): number[] {
  const bands = lockedSlots.map((slot) => {
    if (!slot?.enabled) return null
    return {
      id: slot.id ?? "locked",
      type: slot.type,
      frequencyHz: Math.exp(slot.logFreq),
      gainDb: slot.gainDb,
      q: Math.exp(slot.logQ),
      enabled: true,
      locked: true,
    } satisfies MatchBand
  })
  const highPass = geneToFilter(lockedHighPass ?? offFilter("hp"))
  const lowPass = geneToFilter(lockedLowPass ?? offFilter("lp"))
  if (!bands.some((band) => band) && !highPass && !lowPass) return frequencies.map(() => 0)
  return responseDb(dummyPreset(bands, highPass, lowPass), frequencies)
}

function freeSlotIndices(lockedSlots: (BandGene | null)[]): number[] {
  const free: number[] = []
  for (let slot = 0; slot < BAND_SLOTS; slot++) {
    if (!lockedSlots[slot]?.enabled) free.push(slot)
  }
  return free
}

function enumerateLayouts(
  features: Feature[],
  frequencies: number[],
  reference: number[],
  lockedSlots: (BandGene | null)[],
  endHints: EndFilterHints,
  lockedHighPass: FilterGene | null,
  lockedLowPass: FilterGene | null,
  region?: MatchRegion,
): Layout[] {
  const smoothed = smooth(reference, 2)
  const hpOff = offFilter("hp")
  const lpOff = offFilter("lp")
  const allowHighPass = !region || region.allowHighPass || Boolean(lockedHighPass)
  const allowLowPass = !region || region.allowLowPass || Boolean(lockedLowPass)
  const hpCandidates = lockedHighPass
    ? [lockedHighPass]
    : allowHighPass
      ? endFilterCandidates(frequencies, smoothed, "hp", endHints)
      : [hpOff]
  const lpCandidates = lockedLowPass
    ? [lockedLowPass]
    : allowLowPass
      ? endFilterCandidates(frequencies, smoothed, "lp", endHints)
      : [lpOff]
  const filterOptions: Array<{ highPass: FilterGene; lowPass: FilterGene }> = []
  // When ends look like HP/LP, skip the no-filter option so shelves cannot win by default.
  const forceFilters =
    (endHints.highPass && allowHighPass) ||
    (endHints.lowPass && allowLowPass) ||
    Boolean(lockedHighPass) ||
    Boolean(lockedLowPass)
  if (!forceFilters) filterOptions.push({ highPass: hpOff, lowPass: lpOff })
  for (const highPass of hpCandidates.length ? hpCandidates : [hpOff]) {
    for (const lowPass of lpCandidates.length ? lpCandidates : [lpOff]) {
      if (!highPass.enabled && !lowPass.enabled && forceFilters) continue
      filterOptions.push({
        highPass: { ...highPass, locked: Boolean(lockedHighPass) },
        lowPass: { ...lowPass, locked: Boolean(lockedLowPass) },
      })
    }
  }
  if (filterOptions.length === 0) filterOptions.push({ highPass: hpOff, lowPass: lpOff })

  const free = freeSlotIndices(lockedSlots)
  const layouts: Layout[] = []
  const seen = new Set<string>()

  const pushLayout = (freeTypes: (BandType | null)[], filters: { highPass: FilterGene; lowPass: FilterGene }) => {
    const types: (BandType | null)[] = lockedSlots.map((slot) => (slot?.enabled ? slot.type : null))
    free.forEach((slot, index) => {
      types[slot] = freeTypes[index] ?? null
    })
    if (!layoutAllowed(types, features, lockedSlots, region)) return
    const layout: Layout = { types, highPass: { ...filters.highPass }, lowPass: { ...filters.lowPass } }
    const key = layoutKey(layout)
    if (seen.has(key)) return
    seen.add(key)
    layouts.push(layout)
  }

  if (free.length === 0) {
    for (const filters of filterOptions) {
      pushLayout([], filters)
    }
    return layouts
  }

  if (features.length === 0) {
    for (const filters of filterOptions) {
      const types = free.map((_, index) => (index === 0 ? ("bell" as BandType) : null))
      pushLayout(types, filters)
    }
    return layouts
  }

  const count = Math.min(free.length, features.length)
  for (let k = 1; k <= count; k++) {
    const chosen = features.slice(0, k)
    for (const typeSet of typeVariants(chosen, region)) {
      const ordered = slotFreeTypes(chosen, typeSet, free.length)
      for (const filters of filterOptions) pushLayout(ordered, filters)
    }
  }

  // Always keep a full-slot pure-bell layout when we have enough features —
  // sparsity must not win by never trying all four bands.
  const full = features.slice(0, Math.min(free.length, features.length))
  if (full.length > 0) {
    const bells = full.map(() => "bell" as BandType)
    const ordered = slotFreeTypes(full, bells, free.length)
    for (const filters of filterOptions) pushLayout(ordered, filters)
  }

  return layouts
}

function typeVariants(features: Feature[], region?: MatchRegion): BandType[][] {
  if (features.length === 0) return [["bell"]]
  const bases = features.map((feature) => coerceType(feature.preferredType, region))
  const variants: BandType[][] = [bases]

  features.forEach((feature, index) => {
    const preferred = bases[index]
    if (preferred === "high-shelf" || preferred === "low-shelf") {
      // Edge shelves: keep shelf-first; only optionally try bell as a weaker alt.
      if (!feature.openToHighEdge && !feature.openToLowEdge) {
        const asBell = bases.slice() as BandType[]
        asBell[index] = "bell"
        variants.push(asBell)
      }
      return
    }
    // Only offer shelves for truly open edges — closed bass/treble dips stay bells.
    if (feature.openToLowEdge && (!region || region.allowLowShelf)) {
      const alt = bases.slice() as BandType[]
      alt[index] = "low-shelf"
      variants.push(alt)
    }
    if ((feature.openToHighEdge || feature.frequencyHz > 4500) && (!region || region.allowHighShelf)) {
      const alt = bases.slice() as BandType[]
      alt[index] = "high-shelf"
      variants.push(alt)
    }
  })

  return variants
}

/** Map feature types onto free-slot list ordered by feature frequency. */
function slotFreeTypes(features: Feature[], types: BandType[], freeCount: number): (BandType | null)[] {
  const slots: (BandType | null)[] = Array.from({ length: freeCount }, () => null)
  const ordered = features
    .map((feature, index) => ({ feature, type: types[index] ?? ("bell" as BandType) }))
    .sort((a, b) => a.feature.frequencyHz - b.feature.frequencyHz)
  ordered.forEach((item, index) => {
    if (index < freeCount) slots[index] = item.type
  })
  return slots
}

function layoutAllowed(
  types: (BandType | null)[],
  features: Feature[],
  lockedSlots: (BandGene | null)[],
  region?: MatchRegion,
): boolean {
  const active = types.filter((type) => type !== null)
  if (active.length === 0 && !lockedSlots.some((slot) => slot?.enabled)) return false
  const lowShelves = active.filter((type) => type === "low-shelf").length
  const highShelves = active.filter((type) => type === "high-shelf").length
  if (lowShelves > 1 || highShelves > 1) return false

  for (let slot = 0; slot < types.length; slot++) {
    if (lockedSlots[slot]?.enabled) continue
    const type = types[slot]
    if (!type || type === "bell") continue
    if (type === "low-shelf" && region && !region.allowLowShelf) return false
    if (type === "high-shelf" && region && !region.allowHighShelf) return false
    // Free shelves should live toward the ends.
    if (type === "low-shelf" && slot > 1) return false
    if (type === "high-shelf" && slot < 2 && features.every((feature) => !feature.openToHighEdge)) return false
  }
  return true
}

function layoutKey(layout: Layout): string {
  const bands = layout.types.map((type) => type ?? "-").join(",")
  const hp = layout.highPass.enabled ? `${layout.highPass.slopeIndex}:${layout.highPass.logFreq.toFixed(3)}` : "off"
  const lp = layout.lowPass.enabled ? `${layout.lowPass.slopeIndex}:${layout.lowPass.logFreq.toFixed(3)}` : "off"
  return `${bands}|${hp}|${lp}`
}

function seedLayout(
  layout: Layout,
  features: Feature[],
  frequencies: number[],
  reference: number[],
  lockedSlots: (BandGene | null)[],
): Genotype {
  const smoothed = smooth(reference, 1)
  const bands = emptyBandGenes()
  const orderedFeatures = [...features].sort((a, b) => a.frequencyHz - b.frequencyHz)
  let featureCursor = 0

  for (let slot = 0; slot < BAND_SLOTS; slot++) {
    const locked = lockedSlots[slot]
    if (locked?.enabled) {
      bands[slot] = { ...locked }
      continue
    }
    const type = layout.types[slot]
    if (!type) continue
    const feature = orderedFeatures[featureCursor++]
    if (!feature) continue
    const qBias = type === "bell" ? 1.25 : 1.05
    const q = clamp(estimateQ(frequencies, smoothed, feature) * qBias, MIN_Q, MAX_Q)
    const gain = clamp(feature.gainDb * OVERSHOOT, MIN_GAIN, MAX_GAIN)
    bands[slot] = {
      enabled: true,
      type,
      logFreq: Math.log(clamp(feature.frequencyHz, MIN_FREQ, MAX_FREQ)),
      gainDb: gain,
      logQ: Math.log(q),
      locked: false,
      id: null,
    }
  }

  return {
    bands,
    highPass: { ...layout.highPass },
    lowPass: { ...layout.lowPass },
  }
}

function settle(
  seed: Genotype,
  ctx: ScoreContext,
  popSize: number,
  generations: number,
  random: () => number,
  polishCoords: boolean,
): Genotype {
  const population = buildPopulation(seed, popSize, random)
  const scores = population.map((gene) => scoreGenotype(gene, ctx))
  let best = population[0]!
  let bestScore = scores[0] ?? Infinity

  for (let i = 0; i < scores.length; i++) {
    if ((scores[i] ?? Infinity) < bestScore) {
      bestScore = scores[i]!
      best = population[i]!
    }
  }

  let stall = 0
  for (let generation = 0; generation < generations; generation++) {
    let improved = false
    for (let i = 0; i < popSize; i++) {
      const trial = mutateContinuous(population, i, random)
      const trialScore = scoreGenotype(trial, ctx)
      if (trialScore <= (scores[i] ?? Infinity)) {
        population[i] = trial
        scores[i] = trialScore
        if (trialScore < bestScore) {
          bestScore = trialScore
          best = trial
          improved = true
        }
      }
    }
    stall = improved ? 0 : stall + 1
    if (stall > 18) break
  }

  return polishCoords ? coordinatePolish(best, ctx) : best
}

function buildPopulation(seed: Genotype, size: number, random: () => number): Genotype[] {
  const population: Genotype[] = [cloneGene(seed)]
  while (population.length < size) {
    population.push(jitter(seed, population.length < size * 0.7 ? 0.45 : 0.9, random))
  }
  return population
}

function scoreGenotype(gene: Genotype, ctx: ScoreContext): number {
  clampToRegion(gene, ctx.region)
  const actual = responseDb(
    dummyPreset(genesToBands(gene.bands), geneToFilter(gene.highPass), geneToFilter(gene.lowPass)),
    ctx.frequencies,
  )
  let mean = 0
  let max = 0
  let coverage = 0
  let count = 0
  let edge = 0
  let edgeCount = 0
  for (let i = 0; i < ctx.frequencies.length; i++) {
    const frequency = ctx.frequencies[i] ?? 0
    if (frequency < 20 || frequency > 40_000) continue
    const delta = Math.abs((actual[i] ?? 0) - (ctx.reference[i] ?? 0))
    // Display fit still cares most about 20–20k; keep that as the mean/coverage core.
    if (frequency <= 20_000) {
      mean += delta
      if (delta > max) max = delta
      if (delta <= COVERAGE_DB) coverage += 1
      count += 1
    }
    if (frequency >= 8_000) {
      edge += delta
      edgeCount += 1
    }
    if (frequency <= 120) {
      edge += delta
      edgeCount += 1
    }
  }
  if (count === 0) return Infinity
  mean /= count
  coverage /= count
  const edgeMean = edgeCount > 0 ? edge / edgeCount : 0

  let featureCost = 0
  let featureWeightSum = 0
  for (const feature of ctx.features) {
    let local = 0
    let localCount = 0
    const center = Math.log(feature.frequencyHz)
    for (let i = 0; i < ctx.frequencies.length; i++) {
      const frequency = ctx.frequencies[i] ?? 0
      if (Math.abs(Math.log(frequency) - center) > feature.halfWidth) continue
      local += Math.abs((actual[i] ?? 0) - (ctx.reference[i] ?? 0))
      localCount += 1
    }
    if (localCount === 0) continue
    featureCost += feature.weight * (local / localCount)
    featureWeightSum += feature.weight
  }
  if (featureWeightSum > 0) featureCost /= featureWeightSum

  const activeBands = gene.bands.filter((band) => band.enabled && Math.abs(band.gainDb) >= GAIN_DISABLE).length
  const activeFilters = (gene.highPass.enabled ? 1 : 0) + (gene.lowPass.enabled ? 1 : 0)
  const widePenalty = gene.bands.reduce((total, band) => {
    if (!band.enabled) return total
    const q = Math.exp(band.logQ)
    return total + (q < 0.45 ? 0.12 * (0.45 - q) : 0)
  }, 0)
  const shelfMismatch = edgeShelfPenalty(gene, ctx)
  const filterMismatch = endFilterPenalty(gene, ctx)
  const notableFeatures = ctx.features.filter((feature) => Math.abs(feature.gainDb) >= 1.5).length
  const underuse = Math.max(0, Math.min(BAND_SLOTS, notableFeatures) - activeBands) * UNDERUSE

  return (
    featureCost +
    GLOBAL_MEAN_WEIGHT * mean +
    GLOBAL_MAX_WEIGHT * max +
    COVERAGE_WEIGHT * (1 - coverage) +
    EDGE_WEIGHT * edgeMean +
    SPARSITY * (activeBands + activeFilters) +
    underuse +
    widePenalty +
    shelfMismatch +
    filterMismatch
  )
}

/**
 * Prefer shelves only for open edges; punish shelves that flatten a closed
 * dip/peak that returns toward 0 at the extreme (typical sub-bass bell).
 */
function edgeShelfPenalty(gene: Genotype, ctx: ScoreContext): number {
  let penalty = 0
  for (const feature of ctx.features) {
    const nearest = gene.bands
      .filter((band) => band.enabled)
      .map((band) => ({
        band,
        distance: Math.abs(Math.log(Math.exp(band.logFreq) / feature.frequencyHz)),
      }))
      .sort((a, b) => a.distance - b.distance)[0]

    if (feature.openToHighEdge || feature.openToLowEdge) {
      const wanted = feature.openToHighEdge ? "high-shelf" : "low-shelf"
      if (!nearest || nearest.distance > 0.9) {
        penalty += 0.35 * feature.weight
        continue
      }
      if (nearest.band.type !== wanted) penalty += 0.55 * feature.weight
      continue
    }

    // Closed feature near an end: a shelf flattens past the extremum.
    if (!nearest || nearest.distance > 0.9) continue
    const closedLow = feature.frequencyHz < 200 && nearest.band.type === "low-shelf"
    const closedHigh = feature.frequencyHz > 5000 && nearest.band.type === "high-shelf"
    if (closedLow || closedHigh) penalty += 0.7 * feature.weight
  }
  return penalty
}

/** Prefer HP/LP when the reference keeps rolling off; punish shelf plateaus there. */
function endFilterPenalty(gene: Genotype, ctx: ScoreContext): number {
  let penalty = 0
  if (ctx.endHints.highPass) {
    if (!gene.highPass.enabled) penalty += 1.4
    if (gene.bands.some((band) => band.enabled && band.type === "low-shelf")) penalty += 1.1
  }
  if (ctx.endHints.lowPass) {
    if (!gene.lowPass.enabled) penalty += 1.4
    if (gene.bands.some((band) => band.enabled && band.type === "high-shelf")) penalty += 1.1
  }
  return penalty
}

function mutateContinuous(population: Genotype[], index: number, random: () => number): Genotype {
  const size = population.length
  let a = index
  let b = index
  let c = index
  let guard = 0
  while (a === index && guard < 16) {
    a = Math.floor(random() * size)
    guard += 1
  }
  if (a === index) a = (index + 1) % size
  guard = 0
  while ((b === index || b === a) && guard < 16) {
    b = Math.floor(random() * size)
    guard += 1
  }
  if (b === index || b === a) b = (a + 1) % size
  guard = 0
  while ((c === index || c === a || c === b) && guard < 16) {
    c = Math.floor(random() * size)
    guard += 1
  }
  if (c === index || c === a || c === b) c = (b + 1) % size

  const target = population[index]!
  const base = population[a]!
  const donorB = population[b]!
  const donorC = population[c]!
  const trial = cloneGene(target)

  for (let slot = 0; slot < BAND_SLOTS; slot++) {
    const current = trial.bands[slot]!
    if (!current.enabled) continue
    const from = base.bands[slot]!
    const left = donorB.bands[slot]!
    const right = donorC.bands[slot]!
    current.type = target.bands[slot]!.type
    current.enabled = true
    current.locked = target.bands[slot]!.locked
    current.id = target.bands[slot]!.id
    const scale = current.locked ? LOCKED_F : F
    if (random() < CR) {
      current.logFreq = clamp(
        from.logFreq + scale * (left.logFreq - right.logFreq),
        Math.log(MIN_FREQ),
        Math.log(MAX_FREQ),
      )
    }
    if (random() < CR) {
      current.gainDb = clamp(from.gainDb + scale * (left.gainDb - right.gainDb), MIN_GAIN, MAX_GAIN)
    }
    if (random() < CR) {
      current.logQ = clamp(from.logQ + scale * (left.logQ - right.logQ), Math.log(MIN_Q), Math.log(MAX_Q))
    }
    if (current.locked) {
      // Stay near the locked seed — slight adjust only.
      const seed = target.bands[slot]!
      current.logFreq = clamp(current.logFreq, seed.logFreq - 0.2, seed.logFreq + 0.2)
      current.gainDb = clamp(current.gainDb, seed.gainDb - 2.5, seed.gainDb + 2.5)
      current.logQ = clamp(current.logQ, seed.logQ - 0.25, seed.logQ + 0.25)
    }
  }

  if (trial.highPass.enabled) {
    mutateFilterContinuous(trial.highPass, base.highPass, donorB.highPass, donorC.highPass, "hp", random)
  }
  if (trial.lowPass.enabled) {
    mutateFilterContinuous(trial.lowPass, base.lowPass, donorB.lowPass, donorC.lowPass, "lp", random)
  }
  return trial
}

function mutateFilterContinuous(
  current: FilterGene,
  base: FilterGene,
  left: FilterGene,
  right: FilterGene,
  kind: "hp" | "lp",
  random: () => number,
): void {
  const minLog = Math.log(kind === "hp" ? 15 : 1000)
  const maxLog = Math.log(kind === "hp" ? 2000 : MAX_FREQ)
  const scale = current.locked ? LOCKED_F : F
  const seedLog = current.logFreq
  const seedSlope = current.slopeIndex
  if (random() < CR) {
    current.logFreq = clamp(base.logFreq + scale * (left.logFreq - right.logFreq), minLog, maxLog)
  }
  if (current.locked) {
    current.logFreq = clamp(current.logFreq, seedLog - 0.2, seedLog + 0.2)
    current.slopeIndex = seedSlope
  }
  current.enabled = true
}

function coordinatePolish(gene: Genotype, ctx: ScoreContext): Genotype {
  let current = cloneGene(gene)
  let bestScore = scoreGenotype(current, ctx)
  const steps = [
    { logFreq: 0.08, gainDb: 0, logQ: 0 },
    { logFreq: 0, gainDb: 0.6, logQ: 0 },
    { logFreq: 0, gainDb: 0, logQ: 0.12 },
  ]

  for (let pass = 0; pass < 3; pass++) {
    for (let slot = 0; slot < BAND_SLOTS; slot++) {
      const band = current.bands[slot]
      if (!band?.enabled) continue
      const scale = band.locked ? 0.35 : 1
      for (const step of steps) {
        for (const dir of [-1, 1] as const) {
          const trial = cloneGene(current)
          const target = trial.bands[slot]!
          target.logFreq = clamp(target.logFreq + dir * step.logFreq * scale, Math.log(MIN_FREQ), Math.log(MAX_FREQ))
          target.gainDb = clamp(target.gainDb + dir * step.gainDb * scale, MIN_GAIN, MAX_GAIN)
          target.logQ = clamp(target.logQ + dir * step.logQ * scale, Math.log(MIN_Q), Math.log(MAX_Q))
          const score = scoreGenotype(trial, ctx)
          if (score < bestScore) {
            bestScore = score
            current = trial
          }
        }
      }
    }

    for (const key of ["highPass", "lowPass"] as const) {
      if (!current[key].enabled) continue
      const step = current[key].locked ? 0.04 : 0.1
      for (const dir of [-1, 1] as const) {
        const trial = cloneGene(current)
        const minLog = Math.log(key === "highPass" ? 15 : 1000)
        const maxLog = Math.log(key === "highPass" ? 2000 : MAX_FREQ)
        trial[key].logFreq = clamp(trial[key].logFreq + dir * step, minLog, maxLog)
        trial[key].slopeIndex = current[key].slopeIndex
        trial[key].locked = current[key].locked
        trial[key].enabled = true
        const score = scoreGenotype(trial, ctx)
        if (score < bestScore) {
          bestScore = score
          current = trial
        }
      }
    }
  }

  return current
}

function polish(gene: Genotype, region?: MatchRegion): Genotype {
  const next = cloneGene(gene)
  clampToRegion(next, region)
  for (const band of next.bands) {
    band.logFreq = clamp(band.logFreq, Math.log(MIN_FREQ), Math.log(MAX_FREQ))
    band.gainDb = clamp(band.gainDb, MIN_GAIN, MAX_GAIN)
    band.logQ = clamp(band.logQ, Math.log(MIN_Q), Math.log(MAX_Q))
    if (band.locked) {
      band.enabled = true
      continue
    }
    if (!band.enabled || Math.abs(band.gainDb) < GAIN_DISABLE) {
      band.enabled = false
      band.gainDb = 0
    }
  }
  return next
}

function emptyBandGenes(): BandGene[] {
  return Array.from({ length: BAND_SLOTS }, () => ({
    enabled: false,
    type: "bell" as BandType,
    logFreq: Math.log(1000),
    gainDb: 0,
    logQ: Math.log(1),
    locked: false,
    id: null,
  }))
}

function genesToBands(genes: BandGene[]): (MatchBand | null)[] {
  return genes.map((gene) => {
    if (!gene.enabled) return null
    return {
      id: gene.id ?? crypto.randomUUID(),
      type: gene.type,
      frequencyHz: Math.exp(gene.logFreq),
      gainDb: gene.gainDb,
      q: Math.exp(gene.logQ),
      enabled: true,
      locked: gene.locked,
    }
  })
}

function geneToFilter(gene: FilterGene): MatchFilter | null {
  if (!gene.enabled) return null
  return {
    frequencyHz: Math.exp(gene.logFreq),
    slopeDbPerOct: FILTER_SLOPES[gene.slopeIndex] ?? 12,
    enabled: true,
    locked: gene.locked,
  }
}

function dummyPreset(
  bands: (MatchBand | null)[],
  highPass: MatchFilter | null,
  lowPass: MatchFilter | null,
) {
  return toPreset({
    id: "fit",
    name: "fit",
    color: "#000",
    muted: false,
    solo: false,
    bands,
    highPass,
    lowPass,
  })
}

function findExtrema(frequencies: number[], values: number[]): Array<{ index: number; frequencyHz: number; gainDb: number }> {
  const peaks: Array<{ index: number; frequencyHz: number; gainDb: number }> = []
  for (let i = 1; i < values.length - 1; i++) {
    const prev = values[i - 1] ?? 0
    const value = values[i] ?? 0
    const next = values[i + 1] ?? 0
    const isPeak = value >= prev && value >= next && Math.abs(value) >= 0.35
    const isValley = value <= prev && value <= next && Math.abs(value) >= 0.35
    if (!isPeak && !isValley) continue
    peaks.push({ index: i, frequencyHz: frequencies[i] ?? 1000, gainDb: value })
  }

  const first = values[0] ?? 0
  const last = values[values.length - 1] ?? 0
  if (Math.abs(first) >= 0.8) {
    peaks.push({ index: 0, frequencyHz: frequencies[0] ?? 20, gainDb: first })
  }
  if (Math.abs(last) >= 0.8) {
    peaks.push({
      index: values.length - 1,
      frequencyHz: frequencies[values.length - 1] ?? 20_000,
      gainDb: last,
    })
  }

  peaks.sort((a, b) => Math.abs(b.gainDb) - Math.abs(a.gainDb))
  const chosen: typeof peaks = []
  for (const peak of peaks) {
    const tooClose = chosen.some((other) => Math.abs(Math.log(peak.frequencyHz) - Math.log(other.frequencyHz)) < 0.32)
    if (tooClose) continue
    chosen.push(peak)
    if (chosen.length >= BAND_SLOTS) break
  }
  return chosen
}

function isOpenToEdge(
  _frequencies: number[],
  values: number[],
  peak: { index: number; frequencyHz: number; gainDb: number },
  side: "low" | "high",
): boolean {
  const sign = Math.sign(peak.gainDb) || 1
  const endIndex = side === "high" ? values.length - 1 : 0
  const end = values[endIndex] ?? 0
  const peakAbs = Math.abs(peak.gainDb)
  if (peakAbs < 0.8) return false
  if (Math.abs(end) < 1.25) return false
  if (Math.sign(end) !== sign) return false
  // Recovering toward 0 at the extreme ⇒ closed bell, not an open shelf.
  if (Math.abs(end) < peakAbs * 0.55) return false

  if (side === "high") {
    if (peak.frequencyHz < 3500) return false
    let same = 0
    let total = 0
    let closestToZero = peakAbs
    for (let i = peak.index; i < values.length; i++) {
      total += 1
      const value = values[i] ?? 0
      closestToZero = Math.min(closestToZero, Math.abs(value))
      if (Math.sign(value) === sign || Math.abs(value) < 0.45) same += 1
    }
    if (closestToZero < peakAbs * 0.4) return false
    return total > 0 && same / total > 0.72
  }

  if (peak.frequencyHz > 500) return false
  let same = 0
  let total = 0
  let closestToZero = peakAbs
  for (let i = peak.index; i >= 0; i--) {
    total += 1
    const value = values[i] ?? 0
    closestToZero = Math.min(closestToZero, Math.abs(value))
    if (Math.sign(value) === sign || Math.abs(value) < 0.45) same += 1
  }
  if (closestToZero < peakAbs * 0.4) return false
  return total > 0 && same / total > 0.72
}

function pickType(
  frequencies: number[],
  values: number[],
  peak: { index: number; frequencyHz: number; gainDb: number },
  openToLowEdge: boolean,
  openToHighEdge: boolean,
): BandType {
  // Shelves only when the residual stays open to that edge. A sub dip that
  // returns toward 0 at 10 Hz is a bell — a low shelf would flatten the floor.
  if (openToHighEdge) return "high-shelf"
  if (openToLowEdge) return "low-shelf"

  const freq = peak.frequencyHz
  const sign = Math.sign(peak.gainDb) || 1
  if (freq > 5500) {
    const wide = sameSignSpan(frequencies, values, peak.index, sign) > 1.15
    const end = values[values.length - 1] ?? 0
    if (wide || (Math.sign(end) === sign && Math.abs(end) > 2)) return "high-shelf"
  }
  return "bell"
}

function sameSignSpan(frequencies: number[], values: number[], index: number, sign: number): number {
  let left = index
  let right = index
  while (left > 0 && Math.sign(values[left - 1] ?? 0) === sign && Math.abs(values[left - 1] ?? 0) > 0.25) left -= 1
  while (right < values.length - 1 && Math.sign(values[right + 1] ?? 0) === sign && Math.abs(values[right + 1] ?? 0) > 0.25) {
    right += 1
  }
  const low = frequencies[left] ?? 20
  const high = frequencies[right] ?? 20_000
  return Math.log(high / low)
}

function estimateQ(
  frequencies: number[],
  values: number[],
  peak: { index: number; frequencyHz: number; gainDb: number },
): number {
  const target = peak.gainDb * 0.5
  let left = peak.index
  let right = peak.index
  while (left > 0 && Math.abs(values[left] ?? 0) > Math.abs(target)) left -= 1
  while (right < values.length - 1 && Math.abs(values[right] ?? 0) > Math.abs(target)) right += 1
  const low = frequencies[left] ?? peak.frequencyHz / 2
  const high = frequencies[right] ?? peak.frequencyHz * 2
  const bandwidth = Math.max(high / low, 1.05)
  const q = 1 / (2 * Math.sinh(Math.log(bandwidth) / 2))
  return clamp(q, MIN_Q, MAX_Q)
}

function looksLikeEndFilter(frequencies: number[], values: number[], kind: "hp" | "lp"): boolean {
  if (values.length < 12) return false
  const slope = edgeSlopeDbPerOct(frequencies, values, kind)
  const edge = kind === "hp" ? (values[0] ?? 0) : (values[values.length - 1] ?? 0)
  // Shelf plateaus (shallow edge slope); HP/LP keeps falling. Allow gentle 6 dB/oct.
  if (edge < -3 && slope >= 2.8) return true
  // Mild HP: deepish edge that rises toward the first octave (even if slope is soft).
  if (kind === "hp" && edge < -5) {
    const f0 = frequencies[0] ?? 10
    let i1 = 0
    while (i1 < frequencies.length - 1 && (frequencies[i1] ?? 0) < f0 * 3) i1 += 1
    return (values[i1] ?? 0) - edge > 2.5
  }
  return false
}

function edgeSlopeDbPerOct(frequencies: number[], values: number[], kind: "hp" | "lp"): number {
  if (kind === "hp") {
    const f0 = frequencies[0] ?? 10
    const target = f0 * 2.2
    let i1 = 0
    while (i1 < frequencies.length - 1 && (frequencies[i1] ?? 0) < target) i1 += 1
    const f1 = frequencies[i1] ?? f0 * 2
    const oct = Math.log2(Math.max(f1 / f0, 1.05))
    return Math.abs(((values[i1] ?? 0) - (values[0] ?? 0)) / oct)
  }
  const last = values.length - 1
  const f1 = frequencies[last] ?? 40_000
  const target = f1 / 2.2
  let i0 = last
  while (i0 > 0 && (frequencies[i0] ?? 0) > target) i0 -= 1
  const f0 = frequencies[i0] ?? f1 / 2
  const oct = Math.log2(Math.max(f1 / f0, 1.05))
  return Math.abs(((values[last] ?? 0) - (values[i0] ?? 0)) / oct)
}

function detectEndFilter(
  frequencies: number[],
  values: number[],
  kind: "hp" | "lp",
  endHints?: EndFilterHints,
): FilterGene {
  const candidates = endFilterCandidates(frequencies, values, kind, endHints)
  return candidates[0] ?? offFilter(kind)
}

function endFilterCandidates(
  frequencies: number[],
  values: number[],
  kind: "hp" | "lp",
  endHints?: EndFilterHints,
): FilterGene[] {
  const forced = kind === "hp" ? endHints?.highPass : endHints?.lowPass
  if (values.length < 8) return []

  if (kind === "hp") {
    const edge = values[0] ?? 0
    const mid = values[Math.floor(values.length * 0.15)] ?? 0
    const rollOff = looksLikeEndFilter(frequencies, values, "hp")
    if (!forced && !rollOff && (edge > -4 || mid > -1.5)) return []
    let cutIndex = 0
    for (let i = 0; i < values.length; i++) {
      if ((values[i] ?? 0) > -3) {
        cutIndex = i
        break
      }
    }
    const freq = frequencies[cutIndex] ?? 30
    if (freq > 1200 && !forced && !rollOff) return []
    const slope = edgeSlopeDbPerOct(frequencies, values, "hp")
    const primary = slope > 30 ? 3 : slope > 16 ? 2 : slope > 8 ? 1 : 0
    const slopes = [primary, clampInt(primary + 1, 0, 3), clampInt(primary - 1, 0, 3)]
    const unique = [...new Set(slopes)]
    return unique.slice(0, 2).map((slopeIndex) => ({
      enabled: true,
      logFreq: Math.log(clamp(freq, 15, 2000)),
      slopeIndex,
      locked: false,
    }))
  }

  const edge = values[values.length - 1] ?? 0
  const mid = values[Math.floor(values.length * 0.85)] ?? 0
  const rollOff = looksLikeEndFilter(frequencies, values, "lp")
  if (!forced && !rollOff && (edge > -4 || mid > -1.5)) return []
  let cutIndex = values.length - 1
  for (let i = values.length - 1; i >= 0; i--) {
    if ((values[i] ?? 0) > -3) {
      cutIndex = i
      break
    }
  }
  const freq = frequencies[cutIndex] ?? 16_000
  if (freq < 1500 && !forced && !rollOff) return []
  const slope = edgeSlopeDbPerOct(frequencies, values, "lp")
  const primary = slope > 30 ? 3 : slope > 16 ? 2 : slope > 8 ? 1 : 0
  const slopes = [primary, clampInt(primary + 1, 0, 3), clampInt(primary - 1, 0, 3)]
  const unique = [...new Set(slopes)]
  return unique.slice(0, 2).map((slopeIndex) => ({
    enabled: true,
    logFreq: Math.log(clamp(freq, 1000, MAX_FREQ)),
    slopeIndex,
    locked: false,
  }))
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function jitter(seed: Genotype, amount: number, random: () => number): Genotype {
  const next = cloneGene(seed)
  for (const band of next.bands) {
    if (!band.enabled) continue
    const scale = band.locked ? LOCKED_JITTER : amount
    band.logFreq = clamp(band.logFreq + gaussian(random) * scale * 0.55, Math.log(MIN_FREQ), Math.log(MAX_FREQ))
    band.gainDb = clamp(band.gainDb + gaussian(random) * scale * 5, MIN_GAIN, MAX_GAIN)
    band.logQ = clamp(band.logQ + gaussian(random) * scale * 0.35, Math.log(MIN_Q), Math.log(MAX_Q))
    if (band.locked) {
      // Re-read seed constraints from current values already near seed after small jitter.
      band.type = seed.bands.find((item) => item.id === band.id)?.type ?? band.type
      band.enabled = true
      band.locked = true
    }
  }
  if (next.highPass.enabled) {
    const scale = next.highPass.locked ? LOCKED_JITTER : amount
    next.highPass.logFreq = clamp(next.highPass.logFreq + gaussian(random) * scale * 0.4, Math.log(15), Math.log(2000))
  }
  if (next.lowPass.enabled) {
    const scale = next.lowPass.locked ? LOCKED_JITTER : amount
    next.lowPass.logFreq = clamp(next.lowPass.logFreq + gaussian(random) * scale * 0.4, Math.log(1000), Math.log(MAX_FREQ))
  }
  return next
}

function cloneGene(gene: Genotype): Genotype {
  return {
    bands: gene.bands.map((band) => ({ ...band })),
    highPass: { ...gene.highPass },
    lowPass: { ...gene.lowPass },
  }
}

function sampleCurve(sourceFreqs: number[], sourceValues: number[], targetFreqs: number[]): number[] {
  return targetFreqs.map((frequency) => {
    let best = 0
    let bestDistance = Infinity
    for (let i = 0; i < sourceFreqs.length; i++) {
      const distance = Math.abs(Math.log((sourceFreqs[i] ?? 1) / frequency))
      if (distance < bestDistance) {
        bestDistance = distance
        best = sourceValues[i] ?? 0
      }
    }
    return best
  })
}

function smooth(values: number[], passes: number): number[] {
  let current = values.slice()
  for (let pass = 0; pass < passes; pass++) {
    const next = current.slice()
    for (let i = 1; i < current.length - 1; i++) {
      next[i] = ((current[i - 1] ?? 0) + 2 * (current[i] ?? 0) + (current[i + 1] ?? 0)) / 4
    }
    current = next
  }
  return current
}

function gaussian(random: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = random()
  while (v === 0) v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
