import { describe, expect, it } from "vitest"
import { magicMatch, seedFromResidual } from "../src/magicMatch"
import { fitError, toPreset } from "../src/match"
import { logFrequencies, responseDb } from "../src/nova/magnitude"
import type { NovaPreset } from "../src/nova/types"

const FREQUENCIES = logFrequencies(320)

function preset(overrides: Partial<NovaPreset> = {}): NovaPreset {
  return {
    variant: "TDRNova",
    bands: [],
    highPass: null,
    lowPass: null,
    wideGainDb: 0,
    warnings: [],
    ...overrides,
  }
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe("magicMatch", () => {
  it("recovers a single mid-band bell roughly", () => {
    const reference = responseDb(
      preset({
        bands: [{ index: 1, type: "bell", frequencyHz: 1000, gainDb: 6, q: 1.2, dynamics: false }],
      }),
      FREQUENCIES,
    )
    const result = magicMatch(reference, FREQUENCIES, { random: mulberry32(7) })
    const enabled = result.bands.filter((band) => band?.enabled)
    expect(enabled.length).toBeGreaterThanOrEqual(1)
    expect(enabled.length).toBeLessThanOrEqual(4)
    expect(result.error.mean).toBeLessThan(0.75)
    expect(result.error.max).toBeLessThan(2.5)

    const closest = enabled.reduce((best, band) => {
      if (!band) return best
      if (!best) return band
      return Math.abs(Math.log(band.frequencyHz / 1000)) < Math.abs(Math.log(best.frequencyHz / 1000)) ? band : best
    }, null as (typeof enabled)[number])
    expect(closest).toBeTruthy()
    expect(closest!.frequencyHz).toBeGreaterThan(700)
    expect(closest!.frequencyHz).toBeLessThan(1400)
    expect(closest!.gainDb).toBeGreaterThan(4)
    expect(closest!.gainDb).toBeLessThan(8)
  })

  it("fits two opposite-sign bells better than an empty Nova", () => {
    const reference = responseDb(
      preset({
        bands: [
          { index: 1, type: "bell", frequencyHz: 200, gainDb: -6, q: 0.9, dynamics: false },
          { index: 2, type: "bell", frequencyHz: 3000, gainDb: 5, q: 1.1, dynamics: false },
        ],
      }),
      FREQUENCIES,
    )
    const empty = fitError(FREQUENCIES, reference, FREQUENCIES.map(() => 0))
    const result = magicMatch(reference, FREQUENCIES, { random: mulberry32(19) })
    expect(empty).toBeTruthy()
    expect(result.error.mean).toBeLessThan((empty?.mean ?? 99) * 0.45)
    expect(result.bands.filter((band) => band?.enabled).length).toBeGreaterThanOrEqual(2)
    expect(result.bands.filter((band) => band?.enabled).length).toBeLessThanOrEqual(4)
    expect(Number.isFinite(result.error.mean)).toBe(true)
    expect(Number.isFinite(result.error.max)).toBe(true)
  })

  it("prefers a low shelf when seeding a wide bass shelf residual", () => {
    const reference = responseDb(
      preset({
        bands: [{ index: 1, type: "low-shelf", frequencyHz: 180, gainDb: 5, q: 0.71, dynamics: false }],
      }),
      FREQUENCIES,
    )
    const searchFreqs = logFrequencies(160, 20, 20_000)
    const searchRef = searchFreqs.map((frequency) => {
      let best = 0
      let bestDistance = Infinity
      for (let i = 0; i < FREQUENCIES.length; i++) {
        const distance = Math.abs(Math.log((FREQUENCIES[i] ?? 1) / frequency))
        if (distance < bestDistance) {
          bestDistance = distance
          best = reference[i] ?? 0
        }
      }
      return best
    })
    const seed = seedFromResidual(searchFreqs, searchRef)
    const active = seed.bands.filter((band) => band.enabled)
    expect(active.some((band) => band.type === "low-shelf")).toBe(true)
  })

  it("always returns a finite fitError and at most four enabled bands", () => {
    const reference = responseDb(
      preset({
        bands: [
          { index: 1, type: "bell", frequencyHz: 80, gainDb: -4, q: 0.7, dynamics: false },
          { index: 2, type: "bell", frequencyHz: 800, gainDb: 3, q: 1.4, dynamics: false },
          { index: 3, type: "high-shelf", frequencyHz: 6000, gainDb: -3, q: 0.7, dynamics: false },
        ],
        highPass: { frequencyHz: 40, slopeDbPerOct: 12 },
      }),
      FREQUENCIES,
    )
    const result = magicMatch(reference, FREQUENCIES, { random: mulberry32(42) })
    expect(result.bands).toHaveLength(4)
    expect(result.bands.filter((band) => band?.enabled).length).toBeLessThanOrEqual(4)
    expect(result.error.mean).toBeGreaterThanOrEqual(0)
    expect(result.error.max).toBeGreaterThanOrEqual(result.error.mean)

    const actual = responseDb(
      toPreset({
        id: "x",
        name: "x",
        color: "#000",
        muted: false,
        solo: false,
        bands: result.bands,
        highPass: result.highPass,
        lowPass: result.lowPass,
      }),
      FREQUENCIES,
    )
    const scored = fitError(FREQUENCIES, reference, actual)
    expect(scored?.mean).toBeCloseTo(result.error.mean, 5)
  })
})
