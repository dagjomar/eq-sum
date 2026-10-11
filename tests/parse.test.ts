import { describe, expect, it } from "vitest"
import { EXAMPLE_PASTE } from "../src/example"
import { parseStates } from "../src/nova/parse"

const BELL = `<TDRNovaGE bandActive_1="Off" bandGain_1="9.0" bandQ_1="0.50" bandFreq_1="80" bandType_1="Low S" bandDynActive_1="Off" bandActive_2="On" bandGain_2="3.5" bandQ_2="1.20" bandFreq_2="1000" bandType_2="Bell" bandDynActive_2="On" hpActive_master="On" hpFreq_master="30" hpType_master="12dB/oct" lpActive_master="Off" lpFreq_master="18000" lpType_master="24dB/oct" bandGain_wide="1.5" bandDynActive_wide="Off" dryMix_master="0.0" eqAutoGainParam="Off" />`

describe("parseStates", () => {
  it("reads an active bell, high-pass, wideband gain, and a dynamics warning", () => {
    const result = parseStates(BELL)
    expect(result.error).toBeNull()
    expect(result.presets).toHaveLength(1)
    const preset = result.presets[0]
    expect(preset?.variant).toBe("TDRNovaGE")
    expect(preset?.bands).toEqual([
      expect.objectContaining({ index: 2, type: "bell", frequencyHz: 1000, gainDb: 3.5, q: 1.2, dynamics: true }),
    ])
    expect(preset?.highPass).toEqual({ frequencyHz: 30, slopeDbPerOct: 12 })
    expect(preset?.lowPass).toBeNull()
    expect(preset?.wideGainDb).toBe(1.5)
    expect(preset?.warnings.join(" ")).toMatch(/Dynamics are on/)
  })

  it("reads both states from the example paste", () => {
    const result = parseStates(`notes before\n${EXAMPLE_PASTE}\n`)
    expect(result.presets).toHaveLength(2)
    expect(result.presets[0]?.bands[0]).toEqual(
      expect.objectContaining({ type: "low-shelf", gainDb: 4, frequencyHz: 120 }),
    )
    expect(result.presets[1]?.highPass?.slopeDbPerOct).toBe(12)
    expect(result.presets[1]?.lowPass?.frequencyHz).toBe(16000)
  })

  it("reports text that is not a Nova state", () => {
    expect(parseStates("hello").presets).toHaveLength(0)
    expect(parseStates("hello").error).toMatch(/Copy State/)
  })
})
