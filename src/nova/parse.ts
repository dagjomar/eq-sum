import type { BandType, NovaFilter, NovaPreset } from "./types"

const TAG = /<TDRNova(GE)?\b([\s\S]*?)\/>/gi
const ATTR = /([A-Za-z_][\w]*)="([^"]*)"/g
const MAX_PRESETS = 24

export interface ParseResult {
  presets: NovaPreset[]
  error: string | null
}

export function parseStates(text: string): ParseResult {
  const presets: NovaPreset[] = []
  for (const match of text.matchAll(TAG)) {
    presets.push(parseTag(match[1] === "GE" ? "TDRNovaGE" : "TDRNova", match[2] ?? ""))
    if (presets.length >= MAX_PRESETS) break
  }
  if (presets.length === 0) {
    return {
      presets: [],
      error: "No TDR Nova state found. In Nova, use Copy State, then paste that text.",
    }
  }
  return { presets, error: null }
}

function parseTag(variant: NovaPreset["variant"], body: string): NovaPreset {
  const attrs = new Map<string, string>()
  for (const match of body.matchAll(ATTR)) attrs.set(match[1], match[2])

  const warnings: string[] = []
  const bands = parseBands(attrs, warnings)
  const highPass = parseEndFilter(attrs, warnings, "hp")
  const lowPass = parseEndFilter(attrs, warnings, "lp")
  const wideGainDb = readNumber(attrs.get("bandGain_wide")) ?? 0

  if (isOn(attrs.get("bandDynActive_wide")) || bands.some((band) => band.dynamics)) {
    warnings.push("Dynamics are on. The graph shows the static curve.")
  }
  const dryMix = readNumber(attrs.get("dryMix_master"))
  if (dryMix !== null && Math.abs(dryMix) > 0.001) {
    warnings.push("Dry mix is not zero. Nova blends this curve with the dry signal.")
  }
  if (isOn(attrs.get("eqAutoGainParam"))) {
    warnings.push("EQ auto-gain is on. Nova may offset the level.")
  }
  if (isOn(attrs.get("bypass_master"))) {
    warnings.push("Bypass is on in Nova. The plugin is not applying this curve.")
  }
  if (isOn(attrs.get("delta_master"))) {
    warnings.push("Delta is on in Nova. You hear the difference signal there.")
  }
  const output = attrs.get("gain_master")
  const outputNumber = readNumber(output)
  if (
    output !== undefined &&
    outputNumber !== null &&
    Math.abs(outputNumber) > 0.001 &&
    Math.abs(outputNumber - 1) > 0.001
  ) {
    warnings.push(`Output gain ${output} is not included in the curve.`)
  }

  return { variant, bands, highPass, lowPass, wideGainDb, warnings }
}

function parseBands(attrs: Map<string, string>, warnings: string[]): NovaPreset["bands"] {
  const indexes = [...attrs.keys()]
    .map((key) => /^bandActive_(\d+)$/.exec(key)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((a, b) => a - b)

  const bands: NovaPreset["bands"] = []
  for (const index of indexes) {
    if (!isOn(attrs.get(`bandActive_${index}`))) continue
    const type = parseBandType(attrs.get(`bandType_${index}`))
    const frequencyHz = readNumber(attrs.get(`bandFreq_${index}`))
    const gainDb = readNumber(attrs.get(`bandGain_${index}`))
    let q = readNumber(attrs.get(`bandQ_${index}`))
    if (type === null || frequencyHz === null || frequencyHz <= 0 || gainDb === null) {
      warnings.push(`Band ${index} was skipped because its type, frequency, or gain could not be read.`)
      continue
    }
    if (q === null || q <= 0) {
      q = type === "bell" ? 1 : 0.71
      warnings.push(`Band ${index} has no usable Q. Using ${q}.`)
    }
    bands.push({
      index,
      type,
      frequencyHz,
      gainDb,
      q,
      dynamics: isOn(attrs.get(`bandDynActive_${index}`)),
    })
  }
  return bands
}

function parseEndFilter(
  attrs: Map<string, string>,
  warnings: string[],
  kind: "hp" | "lp",
): NovaFilter | null {
  if (!isOn(attrs.get(`${kind}Active_master`))) return null
  const label = kind === "hp" ? "High-pass" : "Low-pass"
  const frequencyHz = readNumber(attrs.get(`${kind}Freq_master`))
  const slopeDbPerOct = parseSlope(attrs.get(`${kind}Type_master`))
  if (frequencyHz === null || frequencyHz <= 0 || slopeDbPerOct === null) {
    warnings.push(`${label} was skipped because its frequency or slope could not be read.`)
    return null
  }
  return { frequencyHz, slopeDbPerOct }
}

function parseBandType(value: string | undefined): BandType | null {
  const text = value?.trim().toLowerCase().replace(/[-_]+/g, " ") ?? ""
  if (text === "bell" || text === "peak" || text === "pk") return "bell"
  if (text === "low s" || text === "low shelf" || text === "lowshelf" || text === "ls") return "low-shelf"
  if (text === "high s" || text === "high shelf" || text === "highshelf" || text === "hs") return "high-shelf"
  return null
}

function parseSlope(value: string | undefined): number | null {
  const match = /^(\d+(?:\.\d+)?)/.exec(value?.trim() ?? "")
  if (!match) return null
  const slope = Number(match[1])
  if (!Number.isFinite(slope) || slope <= 0 || slope % 6 !== 0) return null
  return slope
}

function isOn(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "on" || value?.trim().toLowerCase() === "true"
}

function readNumber(value: string | undefined): number | null {
  if (value === undefined) return null
  const number = Number(value.trim())
  return Number.isFinite(number) ? number : null
}
