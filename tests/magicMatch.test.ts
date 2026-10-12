import { describe, expect, it } from "vitest"
import { detectFeatures, magicMatch, seedFromResidual } from "../src/magicMatch"
import { fitError, toPreset } from "../src/match"
import { logFrequencies, responseDb } from "../src/nova/magnitude"
import { parseStates } from "../src/nova/parse"
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

function localAbsError(
  frequencies: number[],
  reference: number[],
  actual: number[],
  centerHz: number,
  halfWidth = 0.45,
): number {
  const center = Math.log(centerHz)
  let total = 0
  let count = 0
  for (let i = 0; i < frequencies.length; i++) {
    const frequency = frequencies[i] ?? 0
    if (Math.abs(Math.log(frequency) - center) > halfWidth) continue
    total += Math.abs((actual[i] ?? 0) - (reference[i] ?? 0))
    count += 1
  }
  return count === 0 ? Infinity : total / count
}

describe("magicMatch", () => {
  it("recovers a single mid-band bell tightly", () => {
    const reference = responseDb(
      preset({
        bands: [{ index: 1, type: "bell", frequencyHz: 1000, gainDb: 6, q: 1.2, dynamics: false }],
      }),
      FREQUENCIES,
    )
    const result = magicMatch(reference, FREQUENCIES, { random: mulberry32(7) })
    const enabled = result.bands.filter((band) => band?.enabled)
    expect(enabled.length).toBeGreaterThanOrEqual(1)
    expect(enabled.length).toBeLessThanOrEqual(2)
    expect(result.error.mean).toBeLessThan(0.35)
    expect(result.error.max).toBeLessThan(1.25)

    const closest = enabled.reduce((best, band) => {
      if (!band) return best
      if (!best) return band
      return Math.abs(Math.log(band.frequencyHz / 1000)) < Math.abs(Math.log(best.frequencyHz / 1000)) ? band : best
    }, null as (typeof enabled)[number])
    expect(closest).toBeTruthy()
    expect(closest!.type).toBe("bell")
    expect(closest!.frequencyHz).toBeGreaterThan(850)
    expect(closest!.frequencyHz).toBeLessThan(1200)
    expect(closest!.gainDb).toBeGreaterThan(5)
    expect(closest!.gainDb).toBeLessThan(7.2)
    expect(closest!.q).toBeGreaterThan(0.55)
  })

  it("nails both opposite-sign bells locally, not just the global mean", () => {
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
    expect(empty).toBeTruthy()
    expect(result.error.mean).toBeLessThan((empty?.mean ?? 99) * 0.35)
    expect(result.bands.filter((band) => band?.enabled).length).toBeGreaterThanOrEqual(2)
    expect(localAbsError(FREQUENCIES, reference, actual, 200)).toBeLessThan(1.1)
    expect(localAbsError(FREQUENCIES, reference, actual, 3000)).toBeLessThan(1.1)
  })

  it("avoids ultra-wide Q smear when a narrower bell fits the feature", () => {
    const reference = responseDb(
      preset({
        bands: [{ index: 1, type: "bell", frequencyHz: 2500, gainDb: -7, q: 1.6, dynamics: false }],
      }),
      FREQUENCIES,
    )
    const result = magicMatch(reference, FREQUENCIES, { random: mulberry32(11) })
    const enabled = result.bands.filter((band) => band?.enabled)
    expect(enabled.length).toBeGreaterThanOrEqual(1)
    const closest = enabled.reduce((best, band) => {
      if (!band) return best
      if (!best) return band
      return Math.abs(Math.log(band.frequencyHz / 2500)) < Math.abs(Math.log(best.frequencyHz / 2500)) ? band : best
    }, null as (typeof enabled)[number])
    expect(closest).toBeTruthy()
    expect(closest!.q).toBeGreaterThan(0.7)
    expect(result.error.mean).toBeLessThan(0.45)
  })

  it("prefers a low shelf when seeding a wide bass shelf residual", () => {
    const reference = responseDb(
      preset({
        bands: [{ index: 1, type: "low-shelf", frequencyHz: 180, gainDb: 5, q: 0.71, dynamics: false }],
      }),
      FREQUENCIES,
    )
    const searchFreqs = logFrequencies(160, 20, 40_000)
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
    const features = detectFeatures(searchFreqs, searchRef)
    expect(features.some((feature) => feature.preferredType === "low-shelf")).toBe(true)
    const seed = seedFromResidual(searchFreqs, searchRef)
    const active = seed.bands.filter((band) => band.enabled)
    expect(active.some((band) => band.type === "low-shelf")).toBe(true)
  })

  it("uses a bell for a closed sub dip that returns toward 0 at DC, not a low shelf", () => {
    const pasted = parseStates(`<TDRNova bandActive_1="On" bandGain_1="-13.2" bandQ_1="0.89" bandFreq_1="33.78" bandType_1="Bell" bandDynActive_1="Off" bandActive_2="On" bandGain_2="13.6" bandQ_2="1.31" bandFreq_2="121.98" bandType_2="Bell" bandDynActive_2="Off" bandActive_3="On" bandGain_3="-15.3" bandQ_3="0.48" bandFreq_3="599.85" bandType_3="Bell" bandDynActive_3="Off" bandActive_4="On" bandGain_4="16.3" bandQ_4="2.67" bandFreq_4="3546.36" bandType_4="Bell" bandDynActive_4="Off" hpActive_master="Off" hpFreq_master="20" hpType_master="12dB/oct" lpActive_master="Off" lpFreq_master="20000" lpType_master="12dB/oct" bandGain_wide="0.0" bandDynActive_wide="Off" dryMix_master="0.0" eqAutoGainParam="Off" bypass_master="Off" delta_master="Off" />`)
    expect(pasted.error).toBeNull()
    const reference = responseDb(pasted.presets[0]!, FREQUENCIES)
    const features = detectFeatures(FREQUENCIES, reference)
    const sub = features.find((feature) => feature.frequencyHz < 80)
    expect(sub).toBeTruthy()
    expect(sub!.openToLowEdge).toBe(false)
    expect(sub!.preferredType).toBe("bell")

    const result = magicMatch(reference, FREQUENCIES, { random: mulberry32(5) })
    const low = result.bands
      .filter((band) => band?.enabled)
      .sort((a, b) => (a!.frequencyHz) - (b!.frequencyHz))[0]
    expect(low).toBeTruthy()
    expect(low!.type).toBe("bell")
    expect(low!.frequencyHz).toBeLessThan(80)
    expect(low!.gainDb).toBeLessThan(-6)

    // Floor near 10–20 Hz should recover toward 0, not sit on a shelf plateau.
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
    const lowIndex = FREQUENCIES.findIndex((frequency) => frequency >= 15)
    expect(Math.abs(actual[lowIndex] ?? 99)).toBeLessThan(5)
  })

  it("prefers a high shelf for an open-ended high cut instead of a bell", () => {
    const reference = responseDb(
      preset({
        bands: [{ index: 1, type: "high-shelf", frequencyHz: 8000, gainDb: -8, q: 0.71, dynamics: false }],
      }),
      FREQUENCIES,
    )
    const features = detectFeatures(FREQUENCIES, reference)
    expect(features.some((feature) => feature.preferredType === "high-shelf" || feature.openToHighEdge)).toBe(true)
    const result = magicMatch(reference, FREQUENCIES, { random: mulberry32(23) })
    const enabled = result.bands.filter((band) => band?.enabled)
    expect(enabled.some((band) => band?.type === "high-shelf")).toBe(true)
    const shelf = enabled.find((band) => band?.type === "high-shelf")
    expect(shelf?.frequencyHz).toBeGreaterThan(2500)
  })

  it("keeps locked bands on, typed, and near their settings across Magic Match", () => {
    const reference = responseDb(
      preset({
        bands: [
          { index: 1, type: "bell", frequencyHz: 250, gainDb: -5, q: 0.9, dynamics: false },
          { index: 2, type: "high-shelf", frequencyHz: 7000, gainDb: -6, q: 0.7, dynamics: false },
        ],
      }),
      FREQUENCIES,
    )
    const lockedId = "locked-shelf"
    const result = magicMatch(reference, FREQUENCIES, {
      random: mulberry32(31),
      bands: [
        null,
        null,
        null,
        {
          id: lockedId,
          type: "high-shelf",
          frequencyHz: 9000,
          gainDb: -7,
          q: 0.8,
          enabled: true,
          locked: true,
        },
      ],
    })
    const locked = result.bands[3]
    expect(locked).toBeTruthy()
    expect(locked!.id).toBe(lockedId)
    expect(locked!.locked).toBe(true)
    expect(locked!.enabled).toBe(true)
    expect(locked!.type).toBe("high-shelf")
    expect(locked!.frequencyHz).toBeGreaterThan(7000)
    expect(locked!.frequencyHz).toBeLessThan(12_000)
    expect(locked!.gainDb).toBeGreaterThan(-10)
    expect(locked!.gainDb).toBeLessThan(-4)
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
