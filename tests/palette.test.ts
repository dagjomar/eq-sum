import { describe, expect, it } from "vitest"
import { COLORS, remapInstanceColors } from "../src/palette"

describe("instance colors", () => {
  it("leaves yellow out of the shared palette", () => {
    expect(COLORS).not.toContain("#f2e38a")
    expect(COLORS).not.toContain("#f0c36a")
    expect(new Set(COLORS).size).toBe(COLORS.length)
  })

  it("remaps a saved yellow instance and leaves the other colors", () => {
    const items = [
      { id: "a", color: "#ff5d6c" },
      { id: "b", color: "#f2e38a" },
      { id: "c", color: "#3ddc84" },
    ]
    const next = remapInstanceColors(items)
    expect(next[0]).toBe(items[0])
    expect(next[2]).toBe(items[2])
    expect(next[1]?.color).toBe("#c084fc")
    expect(next[1]?.id).toBe("b")
  })

  it("gives sibling yellows different free colors", () => {
    const next = remapInstanceColors([{ color: "#f2e38a" }, { color: "#f0a35e" }, { color: "#f2e38a" }])
    expect(next[1]?.color).toBe("#f0a35e")
    expect(next[0]?.color).toBe("#ff5d6c")
    expect(next[2]?.color).toBe("#3ddc84")
  })
})
