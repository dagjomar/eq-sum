import { describe, expect, it } from "vitest"
import { dbToY, frequencyToX, xToFrequency, yToDb } from "../src/graph"

describe("graph coordinates", () => {
  it("maps a frequency back to itself", () => {
    expect(xToFrequency(frequencyToX(1000, 800), 800)).toBeCloseTo(1000, 3)
  })

  it("maps a decibel value back to itself", () => {
    expect(yToDb(dbToY(-6, 400, 12), 400, 12)).toBeCloseTo(-6, 3)
  })
})
