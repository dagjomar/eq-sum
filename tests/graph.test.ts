import { describe, expect, it } from "vitest"
import { dbToY, frequencyToX, labelColor, xToFrequency, yToDb } from "../src/graph"

describe("graph coordinates", () => {
  it("maps a frequency back to itself", () => {
    expect(xToFrequency(frequencyToX(1000, 800), 800)).toBeCloseTo(1000, 3)
  })

  it("maps a decibel value back to itself", () => {
    expect(yToDb(dbToY(-6, 400, 12), 400, 12)).toBeCloseTo(-6, 3)
  })
})

describe("label color", () => {
  it("uses near-black text on light instance colors", () => {
    for (const fill of ["#f0a35e", "#3ddc84", "#2dd4bf", "#c084fc", "#5b9dff", "#fb7185"]) {
      expect(labelColor(fill)).toBe("#141416")
    }
  })

  it("keeps light text on darker fills", () => {
    expect(labelColor("#ff5d6c")).toBe("#f4f1ea")
    expect(labelColor("#1a1a22")).toBe("#f4f1ea")
  })
})
