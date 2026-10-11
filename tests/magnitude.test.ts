import { describe, expect, it } from "vitest"
import { logFrequencies, responseDb, sumCurves } from "../src/nova/magnitude"
import { parseStates } from "../src/nova/parse"
import type { NovaPreset } from "../src/nova/types"

const FOUR_EQUAL_CUTS = `<TDRNova bandSelected_1="Off" bandActive_1="On" bandGain_1="-11.0" bandQ_1="0.40" bandFreq_1="50" bandType_1="Bell" bandDynActive_1="Off" bandDynThreshold_1="0.0" bandDynRatio_1="2.0" bandDynSplit_1="On" bandDynAttack_1="20" bandDynRelease_1="200" bandSelected_2="Off" bandActive_2="On" bandGain_2="-11.0" bandQ_2="0.50" bandFreq_2="200" bandType_2="Bell" bandDynActive_2="Off" bandDynThreshold_2="0.0" bandDynRatio_2="2.0" bandDynSplit_2="On" bandDynAttack_2="10" bandDynRelease_2="180" bandSelected_3="Off" bandActive_3="On" bandGain_3="-11.0" bandQ_3="0.50" bandFreq_3="800" bandType_3="Bell" bandDynActive_3="Off" bandDynThreshold_3="0.0" bandDynRatio_3="2.0" bandDynSplit_3="On" bandDynAttack_3="5.0" bandDynRelease_3="160" bandSelected_4="On" bandActive_4="On" bandGain_4="-11.0" bandQ_4="1.30" bandFreq_4="2400" bandType_4="Bell" bandDynActive_4="Off" bandDynThreshold_4="0.0" bandDynRatio_4="2.0" bandDynSplit_4="On" bandDynAttack_4="4.0" bandDynRelease_4="23" hpSelected_master="Off" hpActive_master="Off" hpFreq_master="15" hpType_master="24dB/oct" lpSelected_master="Off" lpActive_master="Off" lpFreq_master="30000" lpType_master="24dB/oct" bandGain_wide="0.0" bandDynActive_wide="Off" bandDynThreshold_wide="0.0" bandDynRatio_wide="1.5" bandDynAttack_wide="8.0" bandDynRelease_wide="200" bypass_master="Off" delta_master="Off" dryMix_master="0.0" gain_master="0.0" eqAutoGainParam="Off" qualityParam="Precise-" channelsParam="Stereo" analyzerModeParam="Analyzer: In" displayEqRangeParam="-/+ 12 dB" displayFFTRangeParam="48 dB" sidechainModeParam="Int SC" analyzerSpeedParam="Normal" solo="Off"/>`

const TWO_WIDE_CUTS = `<TDRNova bandSelected_1="Off" bandActive_1="On" bandGain_1="-12.0" bandQ_1="0.40" bandFreq_1="63" bandType_1="Bell" bandDynActive_1="Off" bandDynThreshold_1="0.0" bandDynRatio_1="2.0" bandDynSplit_1="On" bandDynAttack_1="20" bandDynRelease_1="200" bandSelected_2="Off" bandActive_2="On" bandGain_2="-12.0" bandQ_2="0.60" bandFreq_2="400" bandType_2="Bell" bandDynActive_2="Off" bandDynThreshold_2="0.0" bandDynRatio_2="2.0" bandDynSplit_2="On" bandDynAttack_2="10" bandDynRelease_2="180" bandSelected_3="Off" bandActive_3="Off" bandGain_3="0.0" bandQ_3="0.50" bandFreq_3="2200" bandType_3="Bell" bandDynActive_3="Off" bandDynThreshold_3="0.0" bandDynRatio_3="2.0" bandDynSplit_3="On" bandDynAttack_3="5.0" bandDynRelease_3="160" bandSelected_4="Off" bandActive_4="Off" bandGain_4="0.0" bandQ_4="0.60" bandFreq_4="6000" bandType_4="High S" bandDynActive_4="Off" bandDynThreshold_4="0.0" bandDynRatio_4="2.0" bandDynSplit_4="On" bandDynAttack_4="4.0" bandDynRelease_4="23" hpSelected_master="Off" hpActive_master="Off" hpFreq_master="15" hpType_master="24dB/oct" lpSelected_master="Off" lpActive_master="Off" lpFreq_master="30000" lpType_master="24dB/oct" bandGain_wide="0.0" bandDynActive_wide="Off" bandDynThreshold_wide="0.0" bandDynRatio_wide="1.5" bandDynAttack_wide="8.0" bandDynRelease_wide="200" bypass_master="Off" delta_master="Off" dryMix_master="0.0" gain_master="0.0" eqAutoGainParam="On" qualityParam="Precise-" channelsParam="Stereo" analyzerModeParam="Analyzer: In" displayEqRangeParam="-/+ 12 dB" displayFFTRangeParam="48 dB" sidechainModeParam="Int SC" analyzerSpeedParam="Normal" solo="Off"/>`

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

  it("keeps two wide cuts on their nodes instead of stacking past them", () => {
    const parsed = parseStates(TWO_WIDE_CUTS)
    expect(parsed.error).toBeNull()
    const state = parsed.presets[0]
    expect(state?.bands.map((band) => band.frequencyHz)).toEqual([63, 400])

    const [at63, at400, at10k, between] = responseDb(state!, [63, 400, 10_000, 200])
    expect(Math.abs((at63 ?? 0) + 12)).toBeLessThan(1.5)
    expect(Math.abs((at400 ?? 0) + 12)).toBeLessThan(1.5)
    expect(Math.abs(at10k ?? 0)).toBeLessThan(1.5)
    expect(between ?? 0).toBeGreaterThan(-9)
    expect(between ?? 0).toBeLessThan(-4)

    const sweep = responseDb(state!, logFrequencies(2048, 20, 20_000))
    expect(Math.min(...sweep)).toBeGreaterThan(-14)
  })

  it("rounds the seam where bell skirts cross", () => {
    const parsed = parseStates(FOUR_EQUAL_CUTS)
    expect(parsed.error).toBeNull()
    const state = parsed.presets[0]
    const [at50, at200, at800, at2400, seam] = responseDb(state!, [50, 200, 800, 2400, 1735])
    expect(Math.abs((at50 ?? 0) + 11)).toBeLessThan(1)
    expect(Math.abs((at200 ?? 0) + 11)).toBeLessThan(1)
    expect(Math.abs((at800 ?? 0) + 11)).toBeLessThan(1)
    expect(Math.abs((at2400 ?? 0) + 11)).toBeLessThan(1)
    expect(seam ?? 0).toBeLessThan(-7)
    expect(seam ?? 0).toBeGreaterThan(-9)

    const sweep = responseDb(state!, logFrequencies(1200, 800, 4000))
    let corner = 0
    for (let i = 2; i < sweep.length; i++) {
      corner = Math.max(corner, Math.abs((sweep[i] ?? 0) - 2 * (sweep[i - 1] ?? 0) + (sweep[i - 2] ?? 0)))
    }
    expect(corner).toBeLessThan(0.01)
  })

  it("sinks a tight pair of deep cuts below either node", () => {
    const curve = responseDb(
      preset({
        bands: [
          { index: 1, type: "bell", frequencyHz: 300, gainDb: -18, q: 0.5, dynamics: false },
          { index: 2, type: "bell", frequencyHz: 375, gainDb: -18, q: 0.5, dynamics: false },
        ],
      }),
      [300, 337, 375],
    )
    expect(curve[0] ?? 0).toBeLessThan(-20)
    expect(curve[1] ?? 0).toBeLessThan(-21)
    expect(curve[2] ?? 0).toBeLessThan(-20)
    expect(Math.min(...curve.map((value) => value ?? 0))).toBeGreaterThan(-26)
  })

  it("meets a low shelf and a high shelf in a round dome", () => {
    const curve = responseDb(
      preset({
        bands: [
          { index: 1, type: "low-shelf", frequencyHz: 280, gainDb: -18, q: 0.4, dynamics: false },
          { index: 4, type: "high-shelf", frequencyHz: 1019, gainDb: -18, q: 0.6, dynamics: false },
        ],
      }),
      [20, 680, 10_000],
    )
    expect(curve[0]).toBeCloseTo(-18, 0)
    expect(curve[2]).toBeCloseTo(-18, 0)
    expect(curve[1] ?? 0).toBeGreaterThan(-8)
    expect(curve[1] ?? 0).toBeLessThan(-4)

    const sweep = responseDb(preset({
      bands: [
        { index: 1, type: "low-shelf", frequencyHz: 280, gainDb: -18, q: 0.4, dynamics: false },
        { index: 4, type: "high-shelf", frequencyHz: 1019, gainDb: -18, q: 0.6, dynamics: false },
      ],
    }), logFrequencies(1600, 40, 8000))
    let corner = 0
    for (let i = 2; i < sweep.length; i++) {
      corner = Math.max(corner, Math.abs((sweep[i] ?? 0) - 2 * (sweep[i - 1] ?? 0) + (sweep[i - 2] ?? 0)))
    }
    expect(corner).toBeLessThan(0.02)
  })

  it("keeps spaced deep cuts on their nodes", () => {
    const curve = responseDb(
      preset({
        bands: [
          { index: 1, type: "bell", frequencyHz: 280, gainDb: -18, q: 0.5, dynamics: false },
          { index: 2, type: "bell", frequencyHz: 6200, gainDb: -18, q: 0.5, dynamics: false },
        ],
      }),
      [280, 6200],
    )
    expect(curve[0]).toBeCloseTo(-18, 0)
    expect(curve[1]).toBeCloseTo(-18, 0)
  })
})
