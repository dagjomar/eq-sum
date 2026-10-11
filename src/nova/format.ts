import type { NovaPreset } from "./types"

export function formatFrequency(hz: number): string {
  if (hz >= 1000) {
    const kilo = hz / 1000
    return `${trimNumber(kilo, kilo >= 10 ? 1 : 2)} kHz`
  }
  return `${trimNumber(hz, hz >= 100 ? 0 : 1)} Hz`
}

export function formatGain(db: number): string {
  const sign = db > 0 ? "+" : db < 0 ? "−" : ""
  return `${sign}${trimNumber(Math.abs(db), 1)} dB`
}

export function describePreset(preset: NovaPreset): string {
  const parts: string[] = []
  for (const band of preset.bands) {
    const shape = band.type === "low-shelf" ? "Low shelf" : band.type === "high-shelf" ? "High shelf" : "Bell"
    parts.push(`${shape} ${formatGain(band.gainDb)} at ${formatFrequency(band.frequencyHz)}`)
  }
  if (preset.highPass) {
    parts.push(`HP ${formatFrequency(preset.highPass.frequencyHz)} ${preset.highPass.slopeDbPerOct} dB/oct`)
  }
  if (preset.lowPass) {
    parts.push(`LP ${formatFrequency(preset.lowPass.frequencyHz)} ${preset.lowPass.slopeDbPerOct} dB/oct`)
  }
  if (Math.abs(preset.wideGainDb) > 0.05) parts.push(`Wide ${formatGain(preset.wideGainDb)}`)
  return parts.length > 0 ? parts.join(" · ") : "Flat"
}

export function variantLabel(preset: NovaPreset): string {
  return preset.variant === "TDRNovaGE" ? "TDR Nova GE" : "TDR Nova"
}

function trimNumber(value: number, digits: number): string {
  return value.toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
}
