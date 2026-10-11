export type BandType = "low-shelf" | "bell" | "high-shelf"

export interface NovaBand {
  index: number
  frequencyHz: number
  gainDb: number
  q: number
  type: BandType
  dynamics: boolean
}

export interface NovaFilter {
  frequencyHz: number
  slopeDbPerOct: number
}

export interface NovaPreset {
  variant: "TDRNova" | "TDRNovaGE"
  bands: NovaBand[]
  highPass: NovaFilter | null
  lowPass: NovaFilter | null
  wideGainDb: number
  warnings: string[]
}
