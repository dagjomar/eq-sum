import { describe, expect, it } from "vitest"
import { fitError, toPreset, type MatchInstance } from "../src/match"
import { serializePreset } from "../src/nova/serialize"
import { parseStates } from "../src/nova/parse"
import type { NovaPreset } from "../src/nova/types"

const PRESET: NovaPreset = {
  variant: "TDRNova",
  bands: [
    { index: 1, type: "low-shelf", frequencyHz: 120, gainDb: 4, q: 0.71, dynamics: false },
    { index: 2, type: "bell", frequencyHz: 3200, gainDb: -3, q: 1.4, dynamics: false },
  ],
  highPass: { frequencyHz: 25, slopeDbPerOct: 12 },
  lowPass: null,
  wideGainDb: 0,
  warnings: [],
}

describe("serializePreset", () => {
  it("round-trips bands and filters through the parser", () => {
    const parsed = parseStates(serializePreset(PRESET)).presets[0]
    expect(parsed?.bands.map((band) => band.type)).toEqual(["low-shelf", "bell"])
    expect(parsed?.bands[1]).toEqual(expect.objectContaining({ frequencyHz: 3200, gainDb: -3, q: 1.4 }))
    expect(parsed?.highPass).toEqual({ frequencyHz: 25, slopeDbPerOct: 12 })
    expect(parsed?.lowPass).toBeNull()
    expect(parsed?.warnings).toEqual([])
  })
})

describe("toPreset", () => {
  it("leaves a disabled slot empty so later bands keep their number", () => {
    const instance: MatchInstance = {
      id: "nova",
      name: "Nova 1",
      color: "#3ddc84",
      muted: false,
      solo: false,
      bands: [
        { id: "a", type: "bell", frequencyHz: 100, gainDb: 1, q: 1, enabled: true },
        { id: "b", type: "bell", frequencyHz: 200, gainDb: 1, q: 1, enabled: false },
        { id: "c", type: "bell", frequencyHz: 300, gainDb: 1, q: 1, enabled: true },
        null,
      ],
      highPass: { frequencyHz: 30, slopeDbPerOct: 12, enabled: false },
      lowPass: null,
    }
    const preset = toPreset(instance)
    expect(preset.bands.map((band) => band.index)).toEqual([1, 3])
    expect(preset.highPass).toBeNull()
    expect(serializePreset(preset)).toContain('bandActive_2="Off"')
    expect(serializePreset(preset)).toContain('bandActive_3="On"')
  })
})

describe("fitError", () => {
  it("measures the gap between a reference and a match inside 20 Hz to 20 kHz", () => {
    const error = fitError([10, 100, 1000, 30_000], [0, 2, 4, 9], [0, 1, 1, 0])
    expect(error?.mean).toBeCloseTo(2, 5)
    expect(error?.max).toBeCloseTo(3, 5)
  })
})
