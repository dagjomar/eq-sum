import { describe, expect, it } from "vitest"
import { stepSlope } from "../src/match"

describe("filter slope", () => {
  it("steps between 6, 12, 24, and 72 dB/oct", () => {
    expect(stepSlope(6, 1)).toBe(12)
    expect(stepSlope(12, 1)).toBe(24)
    expect(stepSlope(24, 1)).toBe(72)
    expect(stepSlope(72, -1)).toBe(24)
  })

  it("stops at the shallowest and steepest slopes", () => {
    expect(stepSlope(6, -1)).toBe(6)
    expect(stepSlope(72, 1)).toBe(72)
  })
})
