import type { BandType, NovaFilter, NovaPreset } from "./types"

const TYPE_NAME: Record<BandType, string> = {
  bell: "Bell",
  "low-shelf": "Low S",
  "high-shelf": "High S",
}

/** A Paste State string Nova can accept. Dynamics stay off. */
export function serializePreset(preset: NovaPreset): string {
  const byIndex = new Map(preset.bands.map((band) => [band.index, band]))
  const slots = [1, 2, 3, 4].map((index) => bandAttributes(index, byIndex.get(index)))
  const attributes = [
    ...slots,
    filterAttributes("hp", preset.highPass),
    filterAttributes("lp", preset.lowPass),
    `bandGain_wide="${preset.wideGainDb.toFixed(1)}"`,
    `bandDynActive_wide="Off"`,
    `dryMix_master="0.0"`,
    `eqAutoGainParam="Off"`,
    `bypass_master="Off"`,
    `delta_master="Off"`,
  ]
  const tag = preset.variant === "TDRNovaGE" ? "TDRNovaGE" : "TDRNova"
  return `<${tag} ${attributes.join(" ")} />`
}

function bandAttributes(index: number, band: NovaPreset["bands"][number] | undefined): string {
  const active = band ? "On" : "Off"
  return [
    `bandActive_${index}="${active}"`,
    `bandGain_${index}="${(band?.gainDb ?? 0).toFixed(1)}"`,
    `bandQ_${index}="${(band?.q ?? 1).toFixed(2)}"`,
    `bandFreq_${index}="${trim(band?.frequencyHz ?? 1000)}"`,
    `bandType_${index}="${band ? TYPE_NAME[band.type] : "Bell"}"`,
    `bandDynActive_${index}="Off"`,
  ].join(" ")
}

function filterAttributes(kind: "hp" | "lp", filter: NovaFilter | null): string {
  return [
    `${kind}Active_master="${filter ? "On" : "Off"}"`,
    `${kind}Freq_master="${trim(filter?.frequencyHz ?? (kind === "hp" ? 20 : 20000))}"`,
    `${kind}Type_master="${filter?.slopeDbPerOct ?? 12}dB/oct"`,
  ].join(" ")
}

function trim(value: number): string {
  return String(Math.round(value * 100) / 100)
}
