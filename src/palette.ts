export const COLORS = ["#ff5d6c", "#3ddc84", "#c084fc", "#5b9dff", "#f0a35e", "#2dd4bf", "#fb7185"]

const RETIRED_YELLOW = "#f2e38a"

/** Swap a saved copy of the retired yellow for a palette color siblings are not already using. */
export function remapInstanceColors<T extends { color: string }>(items: T[]): T[] {
  const used = new Set(items.filter((item) => item.color !== RETIRED_YELLOW).map((item) => item.color))
  let fallback = 0
  return items.map((item) => {
    if (item.color !== RETIRED_YELLOW) return item
    const open = COLORS.find((color) => !used.has(color))
    const replacement = open ?? COLORS[fallback % COLORS.length]
    if (!replacement) return item
    if (!open) fallback += 1
    used.add(replacement)
    return { ...item, color: replacement }
  })
}
