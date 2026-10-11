export const PAD = { left: 54, right: 18, top: 16, bottom: 34 }

const FREQ_LABELS = [20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000]
const MIN_HZ = 10
const MAX_HZ = 40_000

export interface DrawnCurve {
  color: string
  width: number
  values: number[]
  fill: boolean
  dash?: number[]
}

export interface GraphHandle {
  id: string
  instanceId: string
  frequencyHz: number
  gainDb: number
  color: string
  selected: boolean
  marker: "band" | "cut"
  label?: string
}

export function drawGraph(
  canvas: HTMLCanvasElement,
  frequencies: number[],
  curves: DrawnCurve[],
  rangeDb: number,
  hoverIndex: number | null,
  handles: GraphHandle[] = [],
): void {
  const context = canvas.getContext("2d")
  if (!context) return
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  canvas.width = Math.floor(width * dpr)
  canvas.height = Math.floor(height * dpr)
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)

  const innerRight = width - PAD.right
  const innerBottom = height - PAD.bottom
  context.fillStyle = "#101114"
  context.fillRect(PAD.left, PAD.top, innerRight - PAD.left, innerBottom - PAD.top)

  context.save()
  context.beginPath()
  context.rect(PAD.left, PAD.top, innerRight - PAD.left, innerBottom - PAD.top)
  context.clip()

  drawGrid(context, width, height, rangeDb)
  for (const curve of curves) drawCurve(context, frequencies, curve, width, height, rangeDb)
  const ordered = [...handles.filter((handle) => !handle.selected), ...handles.filter((handle) => handle.selected)]
  for (const handle of ordered) drawHandle(context, handle, width, height, rangeDb)

  if (hoverIndex !== null && frequencies[hoverIndex] !== undefined) {
    const x = frequencyToX(frequencies[hoverIndex], width)
    context.strokeStyle = "rgba(231, 228, 220, 0.45)"
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(x, PAD.top)
    context.lineTo(x, innerBottom)
    context.stroke()
  }
  context.restore()

  drawLabels(context, width, height, rangeDb)
}

export function indexFromX(x: number, width: number, count: number): number | null {
  const inner = width - PAD.left - PAD.right
  if (inner <= 0 || count < 1) return null
  const t = (x - PAD.left) / inner
  if (t < 0 || t > 1) return null
  return Math.round(t * (count - 1))
}

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  rangeDb: number,
): void {
  context.lineWidth = 1
  context.strokeStyle = "#2a2a30"
  context.beginPath()
  for (const frequency of FREQ_LABELS) {
    const x = frequencyToX(frequency, width)
    context.moveTo(x, PAD.top)
    context.lineTo(x, height - PAD.bottom)
  }
  for (let db = -rangeDb; db <= rangeDb; db += rangeDb / 4) {
    const y = dbToY(db, height, rangeDb)
    context.moveTo(PAD.left, y)
    context.lineTo(width - PAD.right, y)
  }
  context.stroke()

  context.strokeStyle = "#5c5c66"
  context.beginPath()
  context.moveTo(PAD.left, dbToY(0, height, rangeDb))
  context.lineTo(width - PAD.right, dbToY(0, height, rangeDb))
  context.stroke()
}

function drawCurve(
  context: CanvasRenderingContext2D,
  frequencies: number[],
  curve: DrawnCurve,
  width: number,
  height: number,
  rangeDb: number,
): void {
  if (curve.values.length === 0) return
  context.beginPath()
  curve.values.forEach((value, index) => {
    const x = frequencyToX(frequencies[index] ?? MIN_HZ, width)
    const y = dbToY(value, height, rangeDb)
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
  if (curve.fill) {
    const zero = dbToY(0, height, rangeDb)
    const lastX = frequencyToX(frequencies[frequencies.length - 1] ?? MAX_HZ, width)
    const firstX = frequencyToX(frequencies[0] ?? MIN_HZ, width)
    context.lineTo(lastX, zero)
    context.lineTo(firstX, zero)
    context.closePath()
    context.fillStyle = hexWithAlpha(curve.color, 0.14)
    context.fill()
    context.beginPath()
    curve.values.forEach((value, index) => {
      const x = frequencyToX(frequencies[index] ?? MIN_HZ, width)
      const y = dbToY(value, height, rangeDb)
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
  }
  context.strokeStyle = curve.color
  context.lineWidth = curve.width
  context.lineJoin = "round"
  context.setLineDash(curve.dash ?? [])
  context.stroke()
  context.setLineDash([])
}

function drawLabels(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  rangeDb: number,
): void {
  context.fillStyle = "#8e8e96"
  context.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace"
  context.textAlign = "right"
  context.textBaseline = "middle"
  for (let db = -rangeDb; db <= rangeDb; db += rangeDb / 2) {
    context.fillText(db > 0 ? `+${db}` : `${db}`, PAD.left - 8, dbToY(db, height, rangeDb))
  }

  context.textAlign = "center"
  context.textBaseline = "top"
  let previousX = -Infinity
  for (const frequency of FREQ_LABELS) {
    const x = frequencyToX(frequency, width)
    if (x - previousX < 42) continue
    previousX = x
    context.fillText(frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`, x, height - PAD.bottom + 8)
  }
}

export function frequencyToX(frequency: number, width: number): number {
  const t = (Math.log(frequency) - Math.log(MIN_HZ)) / (Math.log(MAX_HZ) - Math.log(MIN_HZ))
  return PAD.left + t * (width - PAD.left - PAD.right)
}

export function xToFrequency(x: number, width: number): number {
  const span = width - PAD.left - PAD.right
  const t = span <= 0 ? 0 : Math.min(1, Math.max(0, (x - PAD.left) / span))
  return Math.exp(Math.log(MIN_HZ) + t * (Math.log(MAX_HZ) - Math.log(MIN_HZ)))
}

export function dbToY(db: number, height: number, rangeDb: number): number {
  const t = (rangeDb - db) / (2 * rangeDb)
  return PAD.top + t * (height - PAD.top - PAD.bottom)
}

export function yToDb(y: number, height: number, rangeDb: number): number {
  const span = height - PAD.top - PAD.bottom
  const t = span <= 0 ? 0 : Math.min(1, Math.max(0, (y - PAD.top) / span))
  return rangeDb - t * 2 * rangeDb
}

export function handleAtPoint(
  handles: GraphHandle[],
  x: number,
  y: number,
  width: number,
  height: number,
  rangeDb: number,
): GraphHandle | null {
  for (let index = handles.length - 1; index >= 0; index -= 1) {
    const handle = handles[index]
    if (!handle) continue
    const dx = x - frequencyToX(handle.frequencyHz, width)
    const dy = y - dbToY(handle.gainDb, height, rangeDb)
    const radius = handle.marker === "cut" ? 16 : 12
    if (dx * dx + dy * dy <= radius * radius) return handle
  }
  return null
}

function drawHandle(
  context: CanvasRenderingContext2D,
  handle: GraphHandle,
  width: number,
  height: number,
  rangeDb: number,
): void {
  const x = frequencyToX(handle.frequencyHz, width)
  const y = dbToY(handle.gainDb, height, rangeDb)
  if (handle.marker === "cut") {
    const radius = handle.selected ? 13 : 11
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fillStyle = handle.color
    context.fill()
    context.lineWidth = handle.selected ? 2.25 : 1.25
    context.strokeStyle = handle.selected ? "#f0c36a" : "#0c0c0e"
    context.stroke()
    context.fillStyle = labelColor(handle.color)
    context.font = "700 8px ui-sans-serif, system-ui, sans-serif"
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(handle.label ?? "", x, y + 0.5)
    return
  }
  context.beginPath()
  context.arc(x, y, handle.selected ? 7 : 5.5, 0, Math.PI * 2)
  context.fillStyle = handle.color
  context.fill()
  context.lineWidth = handle.selected ? 2 : 1.25
  context.strokeStyle = handle.selected ? "#f0c36a" : "#0c0c0e"
  context.stroke()
}

const DARK_LABEL = "#141416"
const LIGHT_LABEL = "#f4f1ea"
// sRGB relative luminance. Pale fills (yellow, peach, pink, and lighter) use
// near-black; darker fills such as #ff5d6c stay on the light label.
const LIGHT_FILL = 0.32

function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "")
  const channels = [0, 2, 4].map((start) => {
    const channel = Number.parseInt(value.slice(start, start + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const red = channels[0] ?? 0
  const green = channels[1] ?? 0
  const blue = channels[2] ?? 0
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function labelColor(fill: string): string {
  return relativeLuminance(fill) > LIGHT_FILL ? DARK_LABEL : LIGHT_LABEL
}

function hexWithAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "")
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
