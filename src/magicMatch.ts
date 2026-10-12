import { FILTER_SLOPES, fitError, toPreset, type MatchBand, type MatchFilter } from "./match"
import { logFrequencies, responseDb } from "./nova/magnitude"
import type { BandType } from "./nova/types"

const BAND_SLOTS = 4
const MIN_FREQ = 10
const MAX_FREQ = 40_000
const MIN_GAIN = -18
const MAX_GAIN = 18
const MIN_Q = 0.1
const MAX_Q = 10
const GAIN_DISABLE = 0.15
const SEARCH_POINTS = 160
const POP_SIZE = 36
const GENERATIONS = 50
const F = 0.7
const CR = 0.9
const MAX_PENALTY = 0.25
const SPARSITY = 0.04

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

interface Extremum {
  index: number
  frequencyHz: number
  gainDb: number
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
  const seed = seedFromResidual(searchFreqs, searchRef)
  const population = buildPopulation(seed, POP_SIZE, random)

  let best = population[0]!
  let bestScore = scoreGenotype(best, searchFreqs, searchRef)

  const scores = population.map((gene) => scoreGenotype(gene, searchFreqs, searchRef))
  for (let i = 0; i < scores.length; i++) {
    if ((scores[i] ?? Infinity) < bestScore) {
      bestScore = scores[i]!
      best = population[i]!
    }
  }

  for (let generation = 0; generation < GENERATIONS; generation++) {
    for (let i = 0; i < POP_SIZE; i++) {
      const trial = mutate(population, i, generation, random)
      const trialScore = scoreGenotype(trial, searchFreqs, searchRef)
      if (trialScore <= (scores[i] ?? Infinity)) {
        population[i] = trial
        scores[i] = trialScore
        if (trialScore < bestScore) {
          bestScore = trialScore
          best = trial
        }
      }
    }
  }

  const polished = polish(best)
  const bands = genesToBands(polished.bands)
  const highPass = geneToFilter(polished.highPass)
  const lowPass = geneToFilter(polished.lowPass)
  const actual = responseDb(
    toPreset({
      id: "fit",
      name: "fit",
      color: "#000",
      muted: false,
      solo: false,
      bands,
      highPass,
      lowPass,
    }),
    frequencies,
  )
  const error = fitError(frequencies, referenceDb, actual) ?? { mean: 0, max: 0 }
  return { bands, highPass, lowPass, error }
}

/** Residual extrema → initial band layout. Exported for tests. */
export function seedFromResidual(frequencies: number[], reference: number[]): Genotype {
  const smoothed = smooth(reference, 2)
  const extrema = findExtrema(frequencies, smoothed).slice(0, BAND_SLOTS)
  const bands: BandGene[] = emptyBandGenes()
  extrema.forEach((peak, index) => {
    bands[index] = {
      enabled: Math.abs(peak.gainDb) >= 0.2,
      type: pickType(frequencies, smoothed, peak),
      logFreq: Math.log(clamp(peak.frequencyHz, MIN_FREQ, MAX_FREQ)),
      gainDb: clamp(peak.gainDb, MIN_GAIN, MAX_GAIN),
      logQ: Math.log(estimateQ(frequencies, smoothed, peak)),
    }
  })

  const highPass = detectEndFilter(frequencies, smoothed, "hp")
  const lowPass = detectEndFilter(frequencies, smoothed, "lp")
  return { bands, highPass, lowPass }
}

function emptyResult(): MagicMatchResult {
  return {
    bands: [null, null, null, null],
    highPass: null,
    lowPass: null,
    error: { mean: 0, max: 0 },
  }
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

function buildPopulation(seed: Genotype, size: number, random: () => number): Genotype[] {
  const population: Genotype[] = [cloneGene(seed)]
  while (population.length < size) {
    if (population.length < size * 0.45) {
      population.push(jitter(seed, 0.35, random))
    } else {
      population.push(randomGene(random))
    }
  }
  return population
}

function scoreGenotype(gene: Genotype, frequencies: number[], reference: number[]): number {
  const bands = genesToBands(gene.bands)
  const highPass = geneToFilter(gene.highPass)
  const lowPass = geneToFilter(gene.lowPass)
  const actual = responseDb(
    toPreset({
      id: "score",
      name: "score",
      color: "#000",
      muted: false,
      solo: false,
      bands,
      highPass,
      lowPass,
    }),
    frequencies,
  )
  const error = fitError(frequencies, reference, actual)
  if (!error) return Infinity
  const activeBands = gene.bands.filter((band) => band.enabled && Math.abs(band.gainDb) >= GAIN_DISABLE).length
  const activeFilters = (gene.highPass.enabled ? 1 : 0) + (gene.lowPass.enabled ? 1 : 0)
  return error.mean + MAX_PENALTY * error.max + SPARSITY * (activeBands + activeFilters)
}

function mutate(population: Genotype[], index: number, generation: number, random: () => number): Genotype {
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
    const from = base.bands[slot]!
    const left = donorB.bands[slot]!
    const right = donorC.bands[slot]!
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
    if (random() < 0.08) current.enabled = !current.enabled
    if (random() < 0.05) current.type = randomType(random)
    if (generation > GENERATIONS * 0.6 && Math.abs(current.gainDb) < GAIN_DISABLE) current.enabled = false
  }

  mutateFilter(trial.highPass, base.highPass, donorB.highPass, donorC.highPass, "hp", random)
  mutateFilter(trial.lowPass, base.lowPass, donorB.lowPass, donorC.lowPass, "lp", random)
  return trial
}

function mutateFilter(
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
  if (random() < 0.1) {
    current.slopeIndex = clampInt(base.slopeIndex + Math.round(F * (left.slopeIndex - right.slopeIndex)), 0, FILTER_SLOPES.length - 1)
  }
  if (random() < 0.08) current.enabled = !current.enabled
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
  if (!next.highPass.enabled) next.highPass.enabled = false
  if (!next.lowPass.enabled) next.lowPass.enabled = false
  return next
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

function findExtrema(frequencies: number[], values: number[]): Extremum[] {
  const peaks: Extremum[] = []
  for (let i = 1; i < values.length - 1; i++) {
    const prev = values[i - 1] ?? 0
    const value = values[i] ?? 0
    const next = values[i + 1] ?? 0
    const isPeak = value >= prev && value >= next && Math.abs(value) >= 0.35
    const isValley = value <= prev && value <= next && Math.abs(value) >= 0.35
    if (!isPeak && !isValley) continue
    peaks.push({ index: i, frequencyHz: frequencies[i] ?? 1000, gainDb: value })
  }

  // Ends can matter even without a discrete local extremum.
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
  const chosen: Extremum[] = []
  for (const peak of peaks) {
    const tooClose = chosen.some((other) => Math.abs(Math.log(peak.frequencyHz) - Math.log(other.frequencyHz)) < 0.35)
    if (tooClose) continue
    chosen.push(peak)
    if (chosen.length >= BAND_SLOTS) break
  }
  chosen.sort((a, b) => a.frequencyHz - b.frequencyHz)
  return chosen
}

function pickType(frequencies: number[], values: number[], peak: Extremum): BandType {
  const freq = peak.frequencyHz
  const sign = Math.sign(peak.gainDb) || 1
  if (freq < 120) {
    const wide = sameSignSpan(frequencies, values, peak.index, sign) > 1.2
    if (wide) return "low-shelf"
  }
  if (freq > 6000) {
    const wide = sameSignSpan(frequencies, values, peak.index, sign) > 1.2
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

function estimateQ(frequencies: number[], values: number[], peak: Extremum): number {
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
    // Find approximate -3 dB point rising from the low end.
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

function randomGene(random: () => number): Genotype {
  const bands = emptyBandGenes().map((band) => {
    const enabled = random() < 0.55
    return {
      ...band,
      enabled,
      type: randomType(random),
      logFreq: Math.log(MIN_FREQ) + random() * (Math.log(MAX_FREQ) - Math.log(MIN_FREQ)),
      gainDb: enabled ? (random() * 2 - 1) * 12 : 0,
      logQ: Math.log(MIN_Q) + random() * (Math.log(MAX_Q) - Math.log(MIN_Q)),
    }
  })
  return {
    bands,
    highPass: {
      enabled: random() < 0.15,
      logFreq: Math.log(20 + random() * 380),
      slopeIndex: Math.floor(random() * FILTER_SLOPES.length),
    },
    lowPass: {
      enabled: random() < 0.15,
      logFreq: Math.log(4000 + random() * 30_000),
      slopeIndex: Math.floor(random() * FILTER_SLOPES.length),
    },
  }
}

function jitter(seed: Genotype, amount: number, random: () => number): Genotype {
  const next = cloneGene(seed)
  for (const band of next.bands) {
    if (!band.enabled && random() < 0.2) {
      band.enabled = true
      band.gainDb = (random() * 2 - 1) * 6
      band.logFreq = Math.log(MIN_FREQ) + random() * (Math.log(MAX_FREQ) - Math.log(MIN_FREQ))
      band.logQ = Math.log(0.4 + random() * 2)
      band.type = randomType(random)
      continue
    }
    band.logFreq = clamp(band.logFreq + gaussian(random) * amount, Math.log(MIN_FREQ), Math.log(MAX_FREQ))
    band.gainDb = clamp(band.gainDb + gaussian(random) * amount * 4, MIN_GAIN, MAX_GAIN)
    band.logQ = clamp(band.logQ + gaussian(random) * amount * 0.5, Math.log(MIN_Q), Math.log(MAX_Q))
    if (random() < 0.1) band.type = randomType(random)
  }
  if (random() < 0.2) next.highPass.enabled = !next.highPass.enabled
  if (random() < 0.2) next.lowPass.enabled = !next.lowPass.enabled
  next.highPass.logFreq = clamp(next.highPass.logFreq + gaussian(random) * amount, Math.log(15), Math.log(2000))
  next.lowPass.logFreq = clamp(next.lowPass.logFreq + gaussian(random) * amount, Math.log(1000), Math.log(MAX_FREQ))
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

function randomType(random: () => number): BandType {
  const types: BandType[] = ["bell", "low-shelf", "high-shelf"]
  return types[Math.floor(random() * types.length)] ?? "bell"
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

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
