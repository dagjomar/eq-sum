import { describe, expect, it } from "vitest"
import { responseDb, sumCurves } from "../src/nova/magnitude"
import type { NovaPreset } from "../src/nova/types"

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

describe("responseDb", () => {
  it("places a bell peak on its center frequency", () => {
    const curve = responseDb(
      preset({
        bands: [{ index: 1, type: "bell", frequencyHz: 1000, gainDb: 6, q: 1, dynamics: false }],
      }),
      [100, 1000, 10_000],
    )
    expect(curve[1]).toBeCloseTo(6, 1)
    expect(Math.abs(curve[0] ?? 0)).toBeLessThan(0.35)
    expect(Math.abs(curve[2] ?? 0)).toBeLessThan(0.35)
  })

  it("reaches the shelf gain well below the corner and returns to zero well above it", () => {
    const curve = responseDb(
      preset({
        bands: [{ index: 1, type: "low-shelf", frequencyHz: 1000, gainDb: 6, q: 0.71, dynamics: false }],
      }),
      [20, 20_000],
    )
    expect(curve[0]).toBeCloseTo(6, 0)
    expect(curve[1]).toBeCloseTo(0, 0)
  })

  it("is 3 dB down at a Butterworth cutoff", () => {
    const curve = responseDb(
      preset({ highPass: { frequencyHz: 100, slopeDbPerOct: 24 } }),
      [100],
    )
    expect(curve[0]).toBeCloseTo(-3.01, 1)
  })

  it("adds preset curves in dB", () => {
    const low = responseDb(preset({ wideGainDb: 2 }), [1000])
    const high = responseDb(preset({ wideGainDb: 3 }), [1000])
    expect(sumCurves([low, high])[0]).toBeCloseTo(5, 5)
  })
})
