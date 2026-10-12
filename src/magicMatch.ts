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
const SEARCH_POINTS = 128
const COVERAGE_DB = 0.75
const FEATURE_HALF_WIDTH = 0.55
const OVERSHOOT = 1.4
const GLOBAL_MEAN_WEIGHT = 0.15
const GLOBAL_MAX_WEIGHT = 0.35
const COVERAGE_WEIGHT = 1.1
const SPARSITY = 0.03
const QUICK_POP = 14
const QUICK_GENS = 28
const DEEP_POP = 20
const DEEP_GENS = 70
const DEEP_KEEP = 8
const F = 0.75
const CR = 0.9

export interface MagicMatchResult {
  bands: (MatchBand | null)[]
  highPass: MatchFilter | null
  lowPass: MatchFilter | null
  error: { mean: number; max: number }
}

export interface MagicMatchOptions {
  /** Deterministic unit interval RNG for tests. Defaults to Math.random. */
  random?: () => number
}

export interface Feature {
  index: number
  frequencyHz: number
  gainDb: number
  preferredType: BandType
  weight: number
  halfWidth: number
}

interface BandGene {
  enabled: boolean
  type: BandType
  logFreq: number
  gainDb: number
  logQ: number
}

interface FilterGene {
  enabled: boolean
  logFreq: number
  slopeIndex: number
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
}

/** Fit one Nova (4 bands + optional HP/LP) to a reference magnitude curve. */
export function magicMatch(
  referenceDb: number[],
  frequencies: number[],
  options: MagicMatchOptions = {},
): MagicMatchResult {
  if (referenceDb.length === 0 || referenceDb.length !== frequencies.length) {
    return emptyResult()
  }

  const random = options.random ?? Math.random
  const searchFreqs = logFrequencies(SEARCH_POINTS, 20, 20_000)
  const searchRef = sampleCurve(frequencies, referenceDb, searchFreqs)
  const features = detectFeatures(searchFreqs, searchRef)
  const ctx: ScoreContext = { frequencies: searchFreqs, reference: searchRef, features }
  const layouts = enumerateLayouts(features, searchFreqs, searchRef)
  if (layouts.length === 0) {
    return emptyResult()
  }

  let best: Genotype | null = null
  let bestScore = Infinity

  const seeded = layouts
    .map((layout) => {
      const gene = seedLayout(layout, features, searchFreqs, searchRef)
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

  const polished = polish(best ?? seedFromResidual(searchFreqs, searchRef))
  const bands = genesToBands(polished.bands)
  const highPass = geneToFilter(polished.highPass)
  const lowPass = geneToFilter(polished.lowPass)
  const actual = responseDb(dummyPreset(bands, highPass, lowPass), frequencies)
  const error = fitError(frequencies, referenceDb, actual) ?? { mean: 0, max: 0 }
  return { bands, highPass, lowPass, error }
}

/** Ordered residual features for search / tests. */
export function detectFeatures(frequencies: number[], reference: number[]): Feature[] {
  const smoothed = smooth(reference, 2)
  const extrema = findExtrema(frequencies, smoothed)
  const maxAbs = Math.max(...extrema.map((peak) => Math.abs(peak.gainDb)), 0.5)
  return extrema.map((peak) => {
    const span = sameSignSpan(frequencies, smoothed, peak.index, Math.sign(peak.gainDb) || 1)
    const halfWidth = clamp(0.28 + span * 0.18, 0.28, FEATURE_HALF_WIDTH + 0.35)
    return {
      index: peak.index,
      frequencyHz: peak.frequencyHz,
      gainDb: peak.gainDb,
      preferredType: pickType(frequencies, smoothed, peak),
      weight: 1.2 + 3.8 * (Math.abs(peak.gainDb) / maxAbs),
      halfWidth,
    }
  })
}

/** Residual extrema → preferred overshoot seed. Exported for tests. */
export function seedFromResidual(frequencies: number[], reference: number[]): Genotype {
  const features = detectFeatures(frequencies, reference)
  const highPass = detectEndFilter(frequencies, smooth(reference, 2), "hp")
  const lowPass = detectEndFilter(frequencies, smooth(reference, 2), "lp")
  const types: (BandType | null)[] = [null, null, null, null]
  features.slice(0, BAND_SLOTS).forEach((feature, index) => {
    types[index] = feature.preferredType
  })
  return seedLayout({ types, highPass, lowPass }, features, frequencies, reference)
}

function emptyResult(): MagicMatchResult {
  return {
    bands: [null, null, null, null],
    highPass: null,
    lowPass: null,
    error: { mean: 0, max: 0 },
  }
}

function enumerateLayouts(features: Feature[], frequencies: number[], reference: number[]): Layout[] {
  const smoothed = smooth(reference, 2)
  const hpOff: FilterGene = { enabled: false, logFreq: Math.log(30), slopeIndex: 1 }
  const lpOff: FilterGene = { enabled: false, logFreq: Math.log(16_000), slopeIndex: 1 }
  const hpOn = detectEndFilter(frequencies, smoothed, "hp")
  const lpOn = detectEndFilter(frequencies, smoothed, "lp")
  const filterOptions: Array<{ highPass: FilterGene; lowPass: FilterGene }> = [{ highPass: hpOff, lowPass: lpOff }]
  if (hpOn.enabled) filterOptions.push({ highPass: hpOn, lowPass: lpOff })
  if (lpOn.enabled) filterOptions.push({ highPass: hpOff, lowPass: lpOn })
  if (hpOn.enabled && lpOn.enabled) filterOptions.push({ highPass: hpOn, lowPass: lpOn })

  const layouts: Layout[] = []
  const seen = new Set<string>()
  if (features.length === 0) {
    for (const filters of filterOptions) {
      layouts.push({
        types: ["bell", null, null, null],
        highPass: { ...filters.highPass },
        lowPass: { ...filters.lowPass },
      })
    }
    return layouts
  }

  const count = Math.min(BAND_SLOTS, features.length)

  for (let k = 1; k <= count; k++) {
    const chosen = features.slice(0, k)
    const typeSets = typeVariants(chosen)
    for (const types of typeSets) {
      const slotted = slotTypesByFrequency(chosen, types)
      if (!layoutAllowed(slotted, chosen)) continue
      for (const filters of filterOptions) {
        const layout: Layout = { types: slotted, highPass: { ...filters.highPass }, lowPass: { ...filters.lowPass } }
        const key = layoutKey(layout)
        if (seen.has(key)) continue
        seen.add(key)
        layouts.push(layout)
      }
    }
  }

  // Always include a pure-bell take on the top features.
  const bells = features.slice(0, count).map(() => "bell" as BandType)
  const slotted = slotTypesByFrequency(features.slice(0, count), bells)
  for (const filters of filterOptions) {
    const layout: Layout = { types: slotted, highPass: { ...filters.highPass }, lowPass: { ...filters.lowPass } }
    const key = layoutKey(layout)
    if (!seen.has(key)) {
      seen.add(key)
      layouts.push(layout)
    }
  }

  return layouts
}

function typeVariants(features: Feature[]): BandType[][] {
  if (features.length === 0) return [["bell"]]
  const bases = features.map((feature) => feature.preferredType)
  const variants: BandType[][] = [bases]

  features.forEach((feature, index) => {
    if (feature.preferredType === "bell") {
      if (feature.frequencyHz < 180) {
        const alt = bases.slice() as BandType[]
        alt[index] = "low-shelf"
        variants.push(alt)
      }
      if (feature.frequencyHz > 5000) {
        const alt = bases.slice() as BandType[]
        alt[index] = "high-shelf"
        variants.push(alt)
      }
      return
    }
    const asBell = bases.slice() as BandType[]
    asBell[index] = "bell"
    variants.push(asBell)
  })

  return variants
}

function slotTypesByFrequency(features: Feature[], types: BandType[]): (BandType | null)[] {
  const slots: (BandType | null)[] = [null, null, null, null]
  const ordered = features
    .map((feature, index) => ({ feature, type: types[index] ?? "bell" as BandType }))
    .sort((a, b) => a.feature.frequencyHz - b.feature.frequencyHz)
  ordered.forEach((item, slot) => {
    if (slot < BAND_SLOTS) slots[slot] = item.type
  })
  return slots
}

function layoutAllowed(types: (BandType | null)[], features: Feature[]): boolean {
  const active = types.filter((type) => type !== null)
  if (active.length === 0) return false
  const lowShelves = active.filter((type) => type === "low-shelf").length
  const highShelves = active.filter((type) => type === "high-shelf").length
  if (lowShelves > 1 || highShelves > 1) return false

  // Shelves only make sense near the ends unless a feature already preferred them.
  for (let slot = 0; slot < types.length; slot++) {
    const type = types[slot]
    if (!type || type === "bell") continue
    const feature = [...features].sort((a, b) => a.frequencyHz - b.frequencyHz)[slot]
    if (!feature) continue
    if (type === "low-shelf" && feature.frequencyHz > 900 && feature.preferredType !== "low-shelf") return false
    if (type === "high-shelf" && feature.frequencyHz < 2500 && feature.preferredType !== "high-shelf") return false
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
): Genotype {
  const smoothed = smooth(reference, 1)
  const bands = emptyBandGenes()
  const orderedFeatures = [...features].sort((a, b) => a.frequencyHz - b.frequencyHz)
  let featureCursor = 0

  for (let slot = 0; slot < BAND_SLOTS; slot++) {
    const type = layout.types[slot]
    if (!type) continue
    const feature = orderedFeatures[featureCursor++]
    if (!feature) continue
    const q = clamp(estimateQ(frequencies, smoothed, feature) * 1.25, MIN_Q, MAX_Q)
    const gain = clamp(feature.gainDb * OVERSHOOT, MIN_GAIN, MAX_GAIN)
    bands[slot] = {
      enabled: true,
      type,
      logFreq: Math.log(clamp(feature.frequencyHz, MIN_FREQ, MAX_FREQ)),
      gainDb: gain,
      logQ: Math.log(q),
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
  const actual = responseDb(
    dummyPreset(genesToBands(gene.bands), geneToFilter(gene.highPass), geneToFilter(gene.lowPass)),
    ctx.frequencies,
  )
  let mean = 0
  let max = 0
  let coverage = 0
  let count = 0
  for (let i = 0; i < ctx.frequencies.length; i++) {
    const frequency = ctx.frequencies[i] ?? 0
    if (frequency < 20 || frequency > 20_000) continue
    const delta = Math.abs((actual[i] ?? 0) - (ctx.reference[i] ?? 0))
    mean += delta
    if (delta > max) max = delta
    if (delta <= COVERAGE_DB) coverage += 1
    count += 1
  }
  if (count === 0) return Infinity
  mean /= count
  coverage /= count

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

  return (
    featureCost +
    GLOBAL_MEAN_WEIGHT * mean +
    GLOBAL_MAX_WEIGHT * max +
    COVERAGE_WEIGHT * (1 - coverage) +
    SPARSITY * (activeBands + activeFilters) +
    widePenalty
  )
}

function mutateContinuous(population: Genotype[], index: number, random: () => number): Genotype {
  const size = population.length
  let a = index
  let b = index
  let c = index
  while (a === index) a = Math.floor(random() * size)
  while (b === index || b === a) b = Math.floor(random() * size)
  while (c === index || c === a || c === b) c = Math.floor(random() * size)

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
    // Keep discrete type/enable fixed during settle — layouts own that.
    current.type = target.bands[slot]!.type
    current.enabled = true
    if (random() < CR) {
      current.logFreq = clamp(
        from.logFreq + F * (left.logFreq - right.logFreq),
        Math.log(MIN_FREQ),
        Math.log(MAX_FREQ),
      )
    }
    if (random() < CR) {
      current.gainDb = clamp(from.gainDb + F * (left.gainDb - right.gainDb), MIN_GAIN, MAX_GAIN)
    }
    if (random() < CR) {
      current.logQ = clamp(from.logQ + F * (left.logQ - right.logQ), Math.log(MIN_Q), Math.log(MAX_Q))
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
  if (random() < CR) {
    current.logFreq = clamp(base.logFreq + F * (left.logFreq - right.logFreq), minLog, maxLog)
  }
  // Slope stays with the layout.
  current.slopeIndex = current.slopeIndex
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
      for (const step of steps) {
        for (const dir of [-1, 1] as const) {
          const trial = cloneGene(current)
          const target = trial.bands[slot]!
          target.logFreq = clamp(target.logFreq + dir * step.logFreq, Math.log(MIN_FREQ), Math.log(MAX_FREQ))
          target.gainDb = clamp(target.gainDb + dir * step.gainDb, MIN_GAIN, MAX_GAIN)
          target.logQ = clamp(target.logQ + dir * step.logQ, Math.log(MIN_Q), Math.log(MAX_Q))
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
      for (const dir of [-1, 1] as const) {
        const trial = cloneGene(current)
        const minLog = Math.log(key === "highPass" ? 15 : 1000)
        const maxLog = Math.log(key === "highPass" ? 2000 : MAX_FREQ)
        trial[key].logFreq = clamp(trial[key].logFreq + dir * 0.1, minLog, maxLog)
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

function polish(gene: Genotype): Genotype {
  const next = cloneGene(gene)
  for (const band of next.bands) {
    band.logFreq = clamp(band.logFreq, Math.log(MIN_FREQ), Math.log(MAX_FREQ))
    band.gainDb = clamp(band.gainDb, MIN_GAIN, MAX_GAIN)
    band.logQ = clamp(band.logQ, Math.log(MIN_Q), Math.log(MAX_Q))
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
  }))
}

function genesToBands(genes: BandGene[]): (MatchBand | null)[] {
  return genes.map((gene) => {
    if (!gene.enabled) return null
    return {
      id: crypto.randomUUID(),
      type: gene.type,
      frequencyHz: Math.exp(gene.logFreq),
      gainDb: gene.gainDb,
      q: Math.exp(gene.logQ),
      enabled: true,
    }
  })
}

function geneToFilter(gene: FilterGene): MatchFilter | null {
  if (!gene.enabled) return null
  return {
    frequencyHz: Math.exp(gene.logFreq),
    slopeDbPerOct: FILTER_SLOPES[gene.slopeIndex] ?? 12,
    enabled: true,
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

function pickType(
  frequencies: number[],
  values: number[],
  peak: { index: number; frequencyHz: number; gainDb: number },
): BandType {
  const freq = peak.frequencyHz
  const sign = Math.sign(peak.gainDb) || 1
  if (freq < 160) {
    const wide = sameSignSpan(frequencies, values, peak.index, sign) > 1.15
    if (wide) return "low-shelf"
  }
  if (freq > 5500) {
    const wide = sameSignSpan(frequencies, values, peak.index, sign) > 1.15
    if (wide) return "high-shelf"
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

function detectEndFilter(frequencies: number[], values: number[], kind: "hp" | "lp"): FilterGene {
  const defaultLog = Math.log(kind === "hp" ? 30 : 16_000)
  const defaultGene: FilterGene = { enabled: false, logFreq: defaultLog, slopeIndex: 1 }
  if (values.length < 8) return defaultGene

  if (kind === "hp") {
    const edge = values[0] ?? 0
    const mid = values[Math.floor(values.length * 0.15)] ?? 0
    if (edge > -4 || mid > -1.5) return defaultGene
    let cutIndex = 0
    for (let i = 0; i < values.length; i++) {
      if ((values[i] ?? 0) > -3) {
        cutIndex = i
        break
      }
    }
    const freq = frequencies[cutIndex] ?? 30
    if (freq > 800) return defaultGene
    const drop = Math.abs(edge - mid)
    const slopeIndex = drop > 18 ? 3 : drop > 10 ? 2 : 1
    return { enabled: true, logFreq: Math.log(clamp(freq, 15, 2000)), slopeIndex }
  }

  const edge = values[values.length - 1] ?? 0
  const mid = values[Math.floor(values.length * 0.85)] ?? 0
  if (edge > -4 || mid > -1.5) return defaultGene
  let cutIndex = values.length - 1
  for (let i = values.length - 1; i >= 0; i--) {
    if ((values[i] ?? 0) > -3) {
      cutIndex = i
      break
    }
  }
  const freq = frequencies[cutIndex] ?? 16_000
  if (freq < 2000) return defaultGene
  const drop = Math.abs(edge - mid)
  const slopeIndex = drop > 18 ? 3 : drop > 10 ? 2 : 1
  return { enabled: true, logFreq: Math.log(clamp(freq, 1000, MAX_FREQ)), slopeIndex }
}

function jitter(seed: Genotype, amount: number, random: () => number): Genotype {
  const next = cloneGene(seed)
  for (const band of next.bands) {
    if (!band.enabled) continue
    band.logFreq = clamp(band.logFreq + gaussian(random) * amount * 0.55, Math.log(MIN_FREQ), Math.log(MAX_FREQ))
    band.gainDb = clamp(band.gainDb + gaussian(random) * amount * 5, MIN_GAIN, MAX_GAIN)
    band.logQ = clamp(band.logQ + gaussian(random) * amount * 0.35, Math.log(MIN_Q), Math.log(MAX_Q))
  }
  if (next.highPass.enabled) {
    next.highPass.logFreq = clamp(next.highPass.logFreq + gaussian(random) * amount * 0.4, Math.log(15), Math.log(2000))
  }
  if (next.lowPass.enabled) {
    next.lowPass.logFreq = clamp(next.lowPass.logFreq + gaussian(random) * amount * 0.4, Math.log(1000), Math.log(MAX_FREQ))
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
