import { describe, expect, it } from "vitest"
import {
  dbToImageY,
  frequencyToImageX,
  imageToStage,
  imageXToFrequency,
  imageYToDb,
  nearestGuide,
  plotAlign,
  stageFrame,
  stageToImage,
} from "../src/trace/align"

const align = plotAlign(
  { hz: 100, x: 0 },
  { hz: 10_000, x: 200 },
  { db: 0, y: 100 },
  { db: 12, y: 40 },
)

describe("screenshot alignment", () => {
  it("rejects anchors that do not define a scale", () => {
    expect(plotAlign({ hz: 100, x: 0 }, { hz: 100, x: 200 }, { db: 0, y: 100 }, { db: 12, y: 40 })).toBeNull()
    expect(plotAlign({ hz: 100, x: 10 }, { hz: 1000, x: 10 }, { db: 0, y: 100 }, { db: 12, y: 40 })).toBeNull()
    expect(plotAlign({ hz: 100, x: 0 }, { hz: 1000, x: 80 }, { db: 0, y: 40 }, { db: 0, y: 80 })).toBeNull()
  })

  it("maps frequency through a log axis", () => {
    expect(align).not.toBeNull()
    if (!align) return
    expect(frequencyToImageX(100, align)).toBeCloseTo(0, 6)
    expect(frequencyToImageX(10_000, align)).toBeCloseTo(200, 6)
    expect(frequencyToImageX(1_000, align)).toBeCloseTo(100, 6)
    expect(imageXToFrequency(frequencyToImageX(2_500, align), align)).toBeCloseTo(2_500, 4)
  })

  it("maps gain through a linear axis, with positive gain above zero", () => {
    expect(align).not.toBeNull()
    if (!align) return
    expect(dbToImageY(0, align)).toBeCloseTo(100, 6)
    expect(dbToImageY(12, align)).toBeCloseTo(40, 6)
    expect(dbToImageY(6, align)).toBeCloseTo(70, 6)
    expect(dbToImageY(-12, align)).toBeCloseTo(160, 6)
    expect(imageYToDb(dbToImageY(-3.5, align), align)).toBeCloseTo(-3.5, 4)
  })

  it("stretches the gain scale when the named gain changes and the pixel stays", () => {
    const stretched = plotAlign({ hz: 100, x: 0 }, { hz: 10_000, x: 200 }, { db: 0, y: 100 }, { db: 6, y: 40 })
    expect(stretched).not.toBeNull()
    if (!stretched) return
    expect(dbToImageY(6, stretched)).toBeCloseTo(40, 6)
    expect(dbToImageY(12, stretched)).toBeCloseTo(-20, 6)
  })
})

describe("stage fit", () => {
  it("contains a wide image and round-trips a pixel", () => {
    const frame = stageFrame(1000, 500, 2000, 500)
    expect(frame.scale).toBeCloseTo(0.5, 6)
    expect(frame.offsetX).toBeCloseTo(0, 6)
    expect(frame.offsetY).toBeCloseTo(125, 6)
    const image = stageToImage(10, 125, frame)
    expect(image.x).toBeCloseTo(20, 6)
    expect(image.y).toBeCloseTo(0, 6)
    expect(imageToStage(image.x, image.y, frame).x).toBeCloseTo(10, 4)
  })
})

describe("guide hit testing", () => {
  it("picks the nearest anchor and ignores distant clicks", () => {
    expect(align).not.toBeNull()
    if (!align) return
    expect(nearestGuide(align, 4, 180, 8)).toBe("freqA")
    expect(nearestGuide(align, 190, 42, 8)).toBe("gainB")
    expect(nearestGuide(align, 0, 100, 8)).toBe("freqA")
    expect(nearestGuide(align, 80, 80, 8)).toBeNull()
  })
})
