import { labelColor } from "../graph"
import { createKnob, type KnobController } from "../knob"
import { FILTER_SLOPES, stepSlope, toPreset, type MatchBand, type MatchFilter, type MatchInstance } from "../match"
import { formatFrequency, formatGain } from "../nova/format"
import { logFrequencies, responseDb } from "../nova/magnitude"
import { serializePreset } from "../nova/serialize"
import type { BandType } from "../nova/types"
import {
  CHECK_GAINS,
  FREQ_TICKS,
  dbToImageY,
  frequencyToImageX,
  imageToStage,
  imageXToFrequency,
  imageYToDb,
  nearestGuide,
  plotAlign,
  stageFrame,
  stageToImage,
  type AnchorX,
  type AnchorY,
  type GuideId,
  type PlotAlign,
  type StageFrame,
} from "./align"
import { blankState, clearShot, loadShot, loadState, saveShot, saveState } from "./store"

const SAMPLES = logFrequencies(640, 20, 20_000)
const BAND_GAIN_DB = 24
const CURVE = "#f0c36a"
const SHAPES: [BandType, string][] = [
  ["low-shelf", "M2 12 H8 C12 12 13 4 18 4 H30"],
  ["bell", "M2 12 C8 12 10 3 16 3 C22 3 24 12 30 12"],
  ["high-shelf", "M2 12 H12 C18 12 19 4 24 4 H30"],
]

type Step = "need-image" | "freqA" | "freqB" | "gainA" | "gainB" | "ready"
type Drag =
  | { kind: "node"; pointerId: number; handleId: string }
  | { kind: "guide"; pointerId: number; guide: GuideId }

interface Handle {
  id: string
  frequencyHz: number
  gainDb: number
  marker: "band" | "cut"
  label?: string
  selected: boolean
}

const saved = loadState()
let bitmap: ImageBitmap | null = null
let freqA: AnchorX | null = saved.freqA
let freqB: AnchorX | null = saved.freqB
let gainA: AnchorY | null = saved.gainA
let gainB: AnchorY | null = saved.gainB
let knownDb = saved.knownDb
let match: MatchInstance = saved.match
let selectedBandId: string | null = saved.selectedBandId
let selectedCut: "hp" | "lp" | null = saved.selectedCut
let showGuides = saved.showGuides
let drag: Drag | null = null
let slopeCarry = 0
let liveKnobs: { freq?: KnobController; gain?: KnobController; q?: KnobController; slope?: KnobController } = {}
let liveFilter: "hp" | "lp" | null = null

if (selectedBandId && !match.bands.some((band) => band?.id === selectedBandId)) selectedBandId = null
if (selectedCut === "hp" && !match.highPass) selectedCut = null
if (selectedCut === "lp" && !match.lowPass) selectedCut = null

const app = document.querySelector<HTMLElement>("#app")
if (!app) throw new Error("Missing #app")

app.innerHTML = `
  <div class="app trace-app">
    <header class="top">
      <div class="brand">
        <h1>Trace</h1>
        <span class="badge">Private</span>
      </div>
      <div class="actions">
        <button id="replace" type="button">Replace screenshot</button>
        <button id="realign" type="button">Realign</button>
        <button id="reset" type="button">Reset</button>
        <button id="guides" type="button">Guides</button>
        <button id="copy" class="primary" type="button">Copy state</button>
      </div>
    </header>
    <p id="prompt" class="hint trace-prompt"></p>
    <div class="trace-tools">
      <label id="field-freq-a">First tick
        <select id="hz-a" aria-label="First frequency tick"></select>
      </label>
      <label id="field-freq-b">Second tick
        <select id="hz-b" aria-label="Second frequency tick"></select>
      </label>
      <div id="field-zero" class="trace-field">
        <span>Zero line</span>
        <span class="trace-static">0 dB</span>
      </div>
      <label id="field-gain-b">Known gain
        <input id="db-b" type="number" step="0.1" aria-label="Known gain in decibels" />
      </label>
    </div>
    <div id="stage" class="trace-stage">
      <canvas id="overlay" aria-label="Match EQ screenshot with a Nova curve"></canvas>
      <button id="drop" class="trace-drop" type="button">Drop a Match EQ screenshot, or click to choose one</button>
    </div>
    <p id="readout" class="readout"></p>
    <section class="panel trace-editor">
      <div class="panel-head">
        <h2>Nova</h2>
        <span id="copy-note" class="meta"></span>
      </div>
      <div id="editor"></div>
    </section>
    <input id="file" type="file" accept="image/*" hidden />
  </div>
`

const prompt = required<HTMLElement>("#prompt")
const stage = required<HTMLElement>("#stage")
const canvas = required<HTMLCanvasElement>("#overlay")
const dropButton = required<HTMLButtonElement>("#drop")
const readout = required<HTMLElement>("#readout")
const editor = required<HTMLElement>("#editor")
const copyNote = required<HTMLElement>("#copy-note")
const fileInput = required<HTMLInputElement>("#file")
const hzASelect = required<HTMLSelectElement>("#hz-a")
const hzBSelect = required<HTMLSelectElement>("#hz-b")
const dbInput = required<HTMLInputElement>("#db-b")
const guidesButton = required<HTMLButtonElement>("#guides")
const fieldFreqA = required<HTMLElement>("#field-freq-a")
const fieldFreqB = required<HTMLElement>("#field-freq-b")
const fieldZero = required<HTMLElement>("#field-zero")
const fieldGainB = required<HTMLElement>("#field-gain-b")

fillFrequencySelect(hzASelect, freqA?.hz ?? 100)
fillFrequencySelect(hzBSelect, freqB?.hz ?? 10_000)
dbInput.value = String(knownDb)
guidesButton.setAttribute("aria-pressed", String(showGuides))

required<HTMLButtonElement>("#replace").addEventListener("click", () => fileInput.click())
dropButton.addEventListener("click", () => fileInput.click())
required<HTMLButtonElement>("#realign").addEventListener("click", realign)
required<HTMLButtonElement>("#reset").addEventListener("click", () => void resetAll())
guidesButton.addEventListener("click", () => {
  showGuides = !showGuides
  guidesButton.setAttribute("aria-pressed", String(showGuides))
  persist()
  paint()
})
required<HTMLButtonElement>("#copy").addEventListener("click", () => void copyState())
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0]
  fileInput.value = ""
  if (file) void useImage(file, true)
})
hzASelect.addEventListener("change", () => onFrequencyChange("a"))
hzBSelect.addEventListener("change", () => onFrequencyChange("b"))
dbInput.addEventListener("input", onKnownGain)
stage.addEventListener("dragover", (event) => {
  event.preventDefault()
  stage.classList.add("is-dropping")
})
stage.addEventListener("dragleave", () => stage.classList.remove("is-dropping"))
stage.addEventListener("drop", (event) => {
  event.preventDefault()
  stage.classList.remove("is-dropping")
  const file = event.dataTransfer?.files[0]
  if (!file) return
  if (!file.type.startsWith("image/")) {
    setPrompt("Drop an image file.")
    return
  }
  void useImage(file, true)
})
canvas.addEventListener("pointerdown", onPointerDown)
canvas.addEventListener("pointermove", onPointerMove)
canvas.addEventListener("pointerup", onPointerUp)
canvas.addEventListener("pointercancel", onPointerUp)
canvas.addEventListener("dblclick", onDoubleClick)
canvas.addEventListener("wheel", onWheel, { passive: false })
editor.addEventListener("click", onEditorClick)
new ResizeObserver(() => paint()).observe(stage)

renderEditor()
setPrompt()
void restoreImage()

function step(): Step {
  if (!bitmap) return "need-image"
  if (!freqA) return "freqA"
  if (!freqB || freqA.x === freqB.x || freqA.hz === freqB.hz) return "freqB"
  if (!gainA) return "gainA"
  if (!gainB || gainA.y === gainB.y || gainA.db === gainB.db) return "gainB"
  return "ready"
}

function alignment(): PlotAlign | null {
  if (!freqA || !freqB || !gainA || !gainB) return null
  return plotAlign(freqA, freqB, gainA, gainB)
}

function promptFor(current: Step): string {
  if (current === "need-image") {
    return "Drop a screenshot of the Match EQ graph. Logic can't export the curve, so the picture is the reference. Nothing is uploaded."
  }
  if (current === "freqA") return `Click the ${formatFrequency(Number(hzASelect.value))} tick on the Match EQ graph. The middle of the label is fine.`
  if (current === "freqB") return `Click the ${formatFrequency(Number(hzBSelect.value))} tick. Two ticks fix the frequency scale.`
  if (current === "gainA") return "Click the 0 dB line, where the gold fill flattens against its baseline."
  if (current === "gainB") {
    return `Set Known gain to a dB you can read in Logic, then click that height. Dragging a point on the Match EQ curve shows its gain. ${formatGain(knownDb)} is the number that will be used.`
  }
  return "The yellow line is Nova, in the screenshot's scale. Double-click to add a band, drag a node, scroll to change Q. Drag a gold guide if a faint gridline misses its label. Changing Known gain stretches the vertical scale."
}

function setPrompt(override?: string): void {
  prompt.classList.toggle("error", Boolean(override))
  prompt.textContent = override ?? promptFor(step())
  const current = step()
  fieldFreqA.classList.toggle("is-current", current === "freqA")
  fieldFreqB.classList.toggle("is-current", current === "freqB")
  fieldZero.classList.toggle("is-current", current === "gainA")
  fieldGainB.classList.toggle("is-current", current === "gainB")
}

function onFrequencyChange(which: "a" | "b"): void {
  const select = which === "a" ? hzASelect : hzBSelect
  const other = which === "a" ? freqB : freqA
  const hz = Number(select.value)
  if (other?.hz === hz) {
    const kept = which === "a" ? freqA : freqB
    select.value = String(kept?.hz ?? (which === "a" ? 100 : 10_000))
    setPrompt("Pick two different frequency ticks.")
    return
  }
  if (which === "a" && freqA) freqA = { ...freqA, hz }
  if (which === "b" && freqB) freqB = { ...freqB, hz }
  persist()
  paint()
  setPrompt()
}

function onKnownGain(): void {
  const db = Number(dbInput.value)
  if (!Number.isFinite(db)) return
  if (db === (gainA?.db ?? 0)) {
    dbInput.value = String(gainB?.db ?? (knownDb === 0 ? 6 : knownDb))
    setPrompt("Known gain has to be something other than the zero line.")
    return
  }
  knownDb = db
  if (gainB) gainB = { ...gainB, db }
  persist()
  paint()
  setPrompt()
}

function realign(): void {
  freqA = null
  freqB = null
  gainA = null
  gainB = null
  persist()
  paint()
  setPrompt()
}

async function resetAll(): Promise<void> {
  const blank = blankState()
  bitmap?.close()
  bitmap = null
  drag = null
  freqA = null
  freqB = null
  gainA = null
  gainB = null
  knownDb = blank.knownDb
  match = blank.match
  selectedBandId = null
  selectedCut = null
  showGuides = true
  hzASelect.value = "100"
  hzBSelect.value = "10000"
  dbInput.value = String(blank.knownDb)
  guidesButton.setAttribute("aria-pressed", "true")
  copyNote.textContent = ""
  readout.textContent = ""
  fileInput.value = ""
  canvas.style.cursor = "crosshair"
  persist()
  renderEditor()
  paint()
  setPrompt()
  await clearShot()
}

async function restoreImage(): Promise<void> {
  const blob = await loadShot()
  if (!blob) {
    paint()
    return
  }
  try {
    bitmap?.close()
    bitmap = await createImageBitmap(blob)
  } catch {
    bitmap = null
    setPrompt("The saved screenshot could not be read. Drop it again.")
    paint()
    return
  }
  paint()
  setPrompt()
}

async function useImage(file: File, resetAlign: boolean): Promise<void> {
  try {
    const next = await createImageBitmap(file)
    bitmap?.close()
    bitmap = next
  } catch {
    setPrompt("That file isn't an image this page can read.")
    return
  }
  if (resetAlign) {
    freqA = null
    freqB = null
    gainA = null
    gainB = null
  }
  persist()
  paint()
  setPrompt()
  try {
    await saveShot(file)
  } catch {
    setPrompt("The screenshot is on screen, but it could not be saved for next time.")
  }
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  const point = localPoint(event)
  const frame = currentFrame()
  if (!point || !frame || !bitmap) return
  const image = stageToImage(point.x, point.y, frame)
  if (!insideImage(image.x, image.y)) return
  const fitted = alignment()
  if (!fitted) {
    placeAnchor(image)
    return
  }
  const handle = hitHandle(point, fitted, frame)
  if (handle) {
    drag = { kind: "node", pointerId: event.pointerId, handleId: handle.id }
    selectHandle(handle)
    capturePointer(event.pointerId)
    canvas.style.cursor = "grabbing"
    event.preventDefault()
    return
  }
  if (showGuides) {
    const guide = nearestGuide(fitted, image.x, image.y, 10 / frame.scale)
    if (guide) {
      drag = { kind: "guide", pointerId: event.pointerId, guide }
      capturePointer(event.pointerId)
      canvas.style.cursor = guide.startsWith("freq") ? "ew-resize" : "ns-resize"
      event.preventDefault()
    }
  }
}

function capturePointer(pointerId: number): void {
  try {
    canvas.setPointerCapture(pointerId)
  } catch {
    // The drag still follows pointermove if the browser has no active pointer to capture.
  }
}

function onPointerMove(event: PointerEvent): void {
  const point = localPoint(event)
  updateReadout(point)
  if (!drag || drag.pointerId !== event.pointerId) {
    if (point) hoverCursor(point)
    return
  }
  const frame = currentFrame()
  const fitted = alignment()
  if (!point || !frame || !fitted) return
  const image = stageToImage(point.x, point.y, frame)
  if (drag.kind === "guide") {
    moveGuide(drag.guide, image)
    paint()
    updateReadout(point)
    return
  }
  if (drag.handleId.endsWith(":hp") || drag.handleId.endsWith(":lp")) {
    const kind = drag.handleId.endsWith(":hp") ? "hp" : "lp"
    const filter = kind === "hp" ? match.highPass : match.lowPass
    if (filter) {
      filter.frequencyHz = clampFreq(imageXToFrequency(image.x, fitted))
      if (liveFilter === kind) liveKnobs.freq?.setValue(filter.frequencyHz)
    }
  } else {
    const band = findBand(drag.handleId)
    if (!band) return
    band.frequencyHz = clampFreq(imageXToFrequency(image.x, fitted))
    band.gainDb = clampGain(imageYToDb(image.y, fitted))
    liveKnobs.freq?.setValue(band.frequencyHz)
    liveKnobs.gain?.setValue(band.gainDb)
  }
  paint()
  updateReadout(point)
}

function onPointerUp(event: PointerEvent): void {
  if (!drag || drag.pointerId !== event.pointerId) return
  drag = null
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  canvas.style.cursor = "crosshair"
  persist()
  paint()
}

function onDoubleClick(event: MouseEvent): void {
  const fitted = alignment()
  const frame = currentFrame()
  const point = localPoint(event)
  if (!fitted || !frame || !point || step() !== "ready") return
  if (hitHandle(point, fitted, frame)) return
  const image = stageToImage(point.x, point.y, frame)
  if (!insideImage(image.x, image.y)) return
  const slot = match.bands.findIndex((item) => !item)
  if (slot < 0) {
    setPrompt("All four bands are on.")
    return
  }
  const band = createBand()
  band.frequencyHz = clampFreq(imageXToFrequency(image.x, fitted))
  band.gainDb = clampGain(imageYToDb(image.y, fitted))
  match.bands[slot] = band
  selectedBandId = band.id
  selectedCut = null
  persist()
  renderEditor()
  paint()
  setPrompt()
}

function onWheel(event: WheelEvent): void {
  const fitted = alignment()
  const frame = currentFrame()
  if (!fitted || !frame || step() !== "ready") return
  event.preventDefault()
  const point = localPoint(event)
  const hit = point ? hitHandle(point, fitted, frame) : null
  const cut = cutFromHandle(hit) ?? (hit ? null : selectedCut)
  if (cut) {
    const filter = cut === "hp" ? match.highPass : match.lowPass
    if (!filter?.enabled) return
    if (hit) selectHandle(hit)
    const direction = slopeDirection(event.deltaY, event.deltaMode)
    if (!direction) return
    filter.slopeDbPerOct = stepSlope(filter.slopeDbPerOct, direction)
    if (liveFilter === cut) liveKnobs.slope?.setValue(filter.slopeDbPerOct)
    persist()
    paint()
    return
  }
  slopeCarry = 0
  const band = hit?.marker === "band" ? findBand(hit.id) : hit ? null : selectedBand()
  if (!band?.enabled) return
  if (hit?.marker === "band") selectHandle(hit)
  band.q = clamp(band.q * Math.exp(-event.deltaY * 0.0012), 0.1, 10, band.q)
  liveKnobs.q?.setValue(band.q)
  persist()
  paint()
}

function placeAnchor(image: { x: number; y: number }): void {
  const current = step()
  if (current === "freqA") freqA = { hz: Number(hzASelect.value), x: image.x }
  else if (current === "freqB") {
    if (freqA && Math.abs(image.x - freqA.x) < 1) {
      setPrompt("Click a different tick. Those two landed on the same pixel.")
      return
    }
    freqB = { hz: Number(hzBSelect.value), x: image.x }
  } else if (current === "gainA") gainA = { db: 0, y: image.y }
  else if (current === "gainB") {
    if (!Number.isFinite(knownDb) || knownDb === (gainA?.db ?? 0)) {
      setPrompt("Set Known gain to something other than 0 dB, then click that height.")
      return
    }
    if (gainA && Math.abs(image.y - gainA.y) < 1) {
      setPrompt("Click a different height. That one is on the zero line.")
      return
    }
    gainB = { db: knownDb, y: image.y }
  } else return
  persist()
  paint()
  setPrompt()
}

function moveGuide(guide: GuideId, image: { x: number; y: number }): void {
  if (guide === "freqA" && freqA && freqB && Math.abs(image.x - freqB.x) >= 1) freqA = { ...freqA, x: image.x }
  if (guide === "freqB" && freqB && freqA && Math.abs(image.x - freqA.x) >= 1) freqB = { ...freqB, x: image.x }
  if (guide === "gainA" && gainA && gainB && Math.abs(image.y - gainB.y) >= 1) gainA = { ...gainA, y: image.y }
  if (guide === "gainB" && gainB && gainA && Math.abs(image.y - gainA.y) >= 1) gainB = { ...gainB, y: image.y }
}

function fitStage(): void {
  if (!bitmap) {
    stage.style.height = ""
    return
  }
  const width = stage.clientWidth
  if (width < 2) return
  const maxHeight = Math.min(window.innerHeight * 0.72, 780)
  const natural = width * (bitmap.height / bitmap.width)
  const next = Math.round(Math.max(180, Math.min(maxHeight, natural)))
  if (Math.abs(stage.getBoundingClientRect().height - next) < 1) return
  stage.style.height = `${next}px`
}

function paint(): void {
  const context = canvas.getContext("2d")
  if (!context) return
  fitStage()
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(width * dpr)
  canvas.height = Math.floor(height * dpr)
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)
  context.fillStyle = "#101114"
  context.fillRect(0, 0, width, height)
  dropButton.hidden = bitmap !== null
  if (!bitmap || width < 2 || height < 2) return
  const frame = stageFrame(width, height, bitmap.width, bitmap.height)
  context.imageSmoothingEnabled = true
  context.drawImage(bitmap, frame.offsetX, frame.offsetY, bitmap.width * frame.scale, bitmap.height * frame.scale)
  const fitted = alignment()
  context.save()
  context.beginPath()
  context.rect(frame.offsetX, frame.offsetY, bitmap.width * frame.scale, bitmap.height * frame.scale)
  context.clip()
  if (step() !== "ready" || !fitted) drawDraft(context, frame)
  else {
    if (showGuides) drawGuides(context, fitted, frame)
    drawCurve(context, fitted, frame)
    for (const handle of buildHandles()) drawHandle(context, handle, fitted, frame)
  }
  context.restore()
}

function drawDraft(context: CanvasRenderingContext2D, frame: StageFrame): void {
  if (freqA) drawVertical(context, frame, freqA.x, formatFrequency(freqA.hz))
  if (freqB) drawVertical(context, frame, freqB.x, formatFrequency(freqB.hz))
  if (gainA) drawHorizontal(context, frame, gainA.y, "0 dB")
  if (gainB) drawHorizontal(context, frame, gainB.y, formatGain(gainB.db))
}

function drawGuides(context: CanvasRenderingContext2D, fitted: PlotAlign, frame: StageFrame): void {
  context.save()
  context.strokeStyle = "rgba(244, 241, 234, 0.28)"
  context.lineWidth = 1
  context.setLineDash([3, 5])
  for (const hz of FREQ_TICKS) {
    if (hz === fitted.freqA.hz || hz === fitted.freqB.hz) continue
    const x = imageToStage(frequencyToImageX(hz, fitted), 0, frame).x
    context.beginPath()
    context.moveTo(x, frame.offsetY)
    context.lineTo(x, frame.offsetY + (bitmap?.height ?? 0) * frame.scale)
    context.stroke()
  }
  for (const db of CHECK_GAINS) {
    if (db === fitted.gainA.db || db === fitted.gainB.db) continue
    const y = imageToStage(0, dbToImageY(db, fitted), frame).y
    context.beginPath()
    context.moveTo(frame.offsetX, y)
    context.lineTo(frame.offsetX + (bitmap?.width ?? 0) * frame.scale, y)
    context.stroke()
  }
  context.restore()
  drawVertical(context, frame, fitted.freqA.x, formatFrequency(fitted.freqA.hz))
  drawVertical(context, frame, fitted.freqB.x, formatFrequency(fitted.freqB.hz))
  drawHorizontal(context, frame, fitted.gainA.y, "0 dB")
  drawHorizontal(context, frame, fitted.gainB.y, formatGain(fitted.gainB.db))
}

function drawVertical(context: CanvasRenderingContext2D, frame: StageFrame, imageX: number, label: string): void {
  const x = imageToStage(imageX, 0, frame).x
  const top = frame.offsetY
  const bottom = frame.offsetY + (bitmap?.height ?? 0) * frame.scale
  context.strokeStyle = "rgba(240, 195, 106, 0.95)"
  context.lineWidth = 1.25
  context.setLineDash([])
  context.beginPath()
  context.moveTo(x, top)
  context.lineTo(x, bottom)
  context.stroke()
  pill(context, x + 6, top + 14, label)
}

function drawHorizontal(context: CanvasRenderingContext2D, frame: StageFrame, imageY: number, label: string): void {
  const y = imageToStage(0, imageY, frame).y
  const left = frame.offsetX
  const right = frame.offsetX + (bitmap?.width ?? 0) * frame.scale
  context.strokeStyle = "rgba(240, 195, 106, 0.95)"
  context.lineWidth = 1.25
  context.setLineDash([])
  context.beginPath()
  context.moveTo(left, y)
  context.lineTo(right, y)
  context.stroke()
  pill(context, left + 8, y - 20, label)
}

function drawCurve(context: CanvasRenderingContext2D, fitted: PlotAlign, frame: StageFrame): void {
  const values = responseDb(toPreset(match), SAMPLES)
  context.beginPath()
  let open = false
  for (let index = 0; index < SAMPLES.length; index += 1) {
    const hz = SAMPLES[index] ?? 20
    const x = frequencyToImageX(hz, fitted)
    const y = dbToImageY(values[index] ?? 0, fitted)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      open = false
      continue
    }
    const stagePoint = imageToStage(x, y, frame)
    if (!open) {
      context.moveTo(stagePoint.x, stagePoint.y)
      open = true
    } else context.lineTo(stagePoint.x, stagePoint.y)
  }
  context.lineJoin = "round"
  context.lineCap = "round"
  context.strokeStyle = "rgba(8, 8, 10, 0.9)"
  context.lineWidth = 4.5
  context.stroke()
  context.strokeStyle = CURVE
  context.lineWidth = 1.75
  context.stroke()
}

function drawHandle(context: CanvasRenderingContext2D, handle: Handle, fitted: PlotAlign, frame: StageFrame): void {
  const point = imageToStage(frequencyToImageX(handle.frequencyHz, fitted), dbToImageY(handle.gainDb, fitted), frame)
  if (handle.marker === "cut") {
    context.beginPath()
    context.arc(point.x, point.y, handle.selected ? 13 : 11, 0, Math.PI * 2)
    context.fillStyle = CURVE
    context.fill()
    context.lineWidth = handle.selected ? 2.25 : 1.25
    context.strokeStyle = handle.selected ? "#f4f1ea" : "#0c0c0e"
    context.stroke()
    context.fillStyle = "#141416"
    context.font = "700 8px ui-sans-serif, system-ui, sans-serif"
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(handle.label ?? "", point.x, point.y + 0.5)
    return
  }
  context.beginPath()
  context.arc(point.x, point.y, handle.selected ? 7 : 5.5, 0, Math.PI * 2)
  context.fillStyle = CURVE
  context.fill()
  context.lineWidth = handle.selected ? 2 : 1.25
  context.strokeStyle = handle.selected ? "#f4f1ea" : "#0c0c0e"
  context.stroke()
}

function pill(context: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  context.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace"
  context.textAlign = "left"
  context.textBaseline = "middle"
  const width = context.measureText(text).width
  context.fillStyle = "rgba(12, 12, 14, 0.78)"
  context.fillRect(x, y - 9, width + 10, 18)
  context.fillStyle = "#f4f1ea"
  context.fillText(text, x + 5, y)
}

function buildHandles(): Handle[] {
  const handles: Handle[] = []
  for (const band of match.bands) {
    if (!band?.enabled) continue
    handles.push({
      id: band.id,
      frequencyHz: band.frequencyHz,
      gainDb: band.gainDb,
      marker: "band",
      selected: selectedCut === null && band.id === selectedBandId,
    })
  }
  if (match.highPass?.enabled) handles.push(cutHandle("hp", match.highPass))
  if (match.lowPass?.enabled) handles.push(cutHandle("lp", match.lowPass))
  return handles
}

function cutHandle(kind: "hp" | "lp", filter: MatchFilter): Handle {
  return {
    id: `${match.id}:${kind}`,
    frequencyHz: filter.frequencyHz,
    gainDb: responseDb(toPreset(match), [filter.frequencyHz])[0] ?? 0,
    marker: "cut",
    label: kind === "hp" ? "HP" : "LP",
    selected: selectedCut === kind,
  }
}

function hitHandle(point: { x: number; y: number }, fitted: PlotAlign, frame: StageFrame): Handle | null {
  const handles = buildHandles()
  for (let index = handles.length - 1; index >= 0; index -= 1) {
    const handle = handles[index]
    if (!handle) continue
    const at = imageToStage(frequencyToImageX(handle.frequencyHz, fitted), dbToImageY(handle.gainDb, fitted), frame)
    const dx = point.x - at.x
    const dy = point.y - at.y
    const radius = handle.marker === "cut" ? 14 : 12
    if (dx * dx + dy * dy <= radius * radius) return handle
  }
  return null
}

function hoverCursor(point: { x: number; y: number }): void {
  const fitted = alignment()
  const frame = currentFrame()
  if (!fitted || !frame) {
    canvas.style.cursor = "crosshair"
    return
  }
  if (hitHandle(point, fitted, frame)) {
    canvas.style.cursor = "grab"
    return
  }
  if (showGuides) {
    const image = stageToImage(point.x, point.y, frame)
    if (insideImage(image.x, image.y)) {
      const guide = nearestGuide(fitted, image.x, image.y, 10 / frame.scale)
      if (guide) {
        canvas.style.cursor = guide.startsWith("freq") ? "ew-resize" : "ns-resize"
        return
      }
    }
  }
  canvas.style.cursor = "crosshair"
}

function updateReadout(point: { x: number; y: number } | null): void {
  const fitted = alignment()
  const frame = currentFrame()
  if (!point || !fitted || !frame || !bitmap) {
    readout.textContent = ""
    return
  }
  const image = stageToImage(point.x, point.y, frame)
  if (!insideImage(image.x, image.y)) {
    readout.textContent = ""
    return
  }
  readout.textContent = `${formatFrequency(imageXToFrequency(image.x, fitted))} · ${formatGain(imageYToDb(image.y, fitted))}`
}

function selectHandle(handle: Handle): void {
  const previousBandId = selectedBandId
  const previousCut = selectedCut
  if (handle.marker === "band") {
    selectedBandId = handle.id
    selectedCut = null
  } else {
    selectedCut = handle.id.endsWith(":hp") ? "hp" : "lp"
  }
  const same =
    (handle.marker === "band" && previousCut === null && previousBandId === handle.id) ||
    (handle.marker === "cut" && previousCut === selectedCut)
  if (same) paint()
  else renderEditor()
}

function renderEditor(): void {
  liveKnobs = {}
  liveFilter = null
  editor.replaceChildren()
  if (selectedCut === "hp" && !match.highPass) selectedCut = null
  if (selectedCut === "lp" && !match.lowPass) selectedCut = null
  const band = match.bands.find((item) => item?.id === selectedBandId) ?? null
  if (selectedBandId && !band) selectedBandId = null
  editor.append(renderSlots())
  if (selectedCut) appendFilterDeck(selectedCut)
  else if (!band) {
    const note = document.createElement("p")
    note.className = "meta"
    note.textContent = "Double-click the screenshot to add a band, or turn on HP, a band, or LP."
    editor.append(note)
  } else appendBandDeck(band)
}

function renderSlots(): HTMLElement {
  const picks = document.createElement("div")
  picks.className = "band-picks"
  picks.append(cutSlot("hp"), ...[0, 1, 2, 3].map((slot) => bandSlot(slot)), cutSlot("lp"))
  return picks
}

function bandSlot(slot: number): HTMLButtonElement {
  const band = match.bands[slot]
  const on = Boolean(band?.enabled)
  const current = selectedCut === null && band?.id === selectedBandId
  const button = document.createElement("button")
  button.type = "button"
  button.className = `pick${on ? " is-on" : " is-off"}${current ? " is-current" : ""}`
  button.dataset.action = "select-band"
  button.dataset.slot = String(slot)
  button.textContent = `${slot + 1}`
  button.title = `Band ${slot + 1}`
  if (on) paintOn(button)
  button.setAttribute("aria-pressed", String(on))
  button.setAttribute("aria-label", on ? `Band ${slot + 1} on` : `Band ${slot + 1} off`)
  return button
}

function cutSlot(kind: "hp" | "lp"): HTMLButtonElement {
  const filter = kind === "hp" ? match.highPass : match.lowPass
  const on = Boolean(filter?.enabled)
  const current = selectedCut === kind
  const button = document.createElement("button")
  button.type = "button"
  button.className = `pick pick-cut${on ? " is-on" : " is-off"}${current ? " is-current" : ""}`
  button.dataset.action = "select-cut"
  button.dataset.filter = kind
  button.textContent = kind === "hp" ? "HP" : "LP"
  if (on) paintOn(button)
  button.setAttribute("aria-pressed", String(on))
  button.setAttribute("aria-label", kind === "hp" ? "High-pass" : "Low-pass")
  return button
}

function paintOn(button: HTMLButtonElement): void {
  button.style.background = CURVE
  button.style.setProperty("--pick-ink", labelColor(CURVE))
}

function appendBandDeck(band: MatchBand): void {
  const deck = document.createElement("div")
  deck.className = "eq-deck"
  const shapes = document.createElement("div")
  shapes.className = "shapes"
  shapes.setAttribute("role", "group")
  shapes.setAttribute("aria-label", "Filter shape")
  for (const [type, path] of SHAPES) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "shape"
    button.dataset.action = "shape"
    button.dataset.shape = type
    button.setAttribute("aria-label", type === "bell" ? "Bell" : type === "low-shelf" ? "Low shelf" : "High shelf")
    button.setAttribute("aria-pressed", String(band.type === type))
    button.innerHTML = `<svg viewBox="0 0 32 16" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`
    shapes.append(button)
  }
  const change = () => {
    persist()
    paint()
  }
  const freq = createKnob({
    label: "FREQ",
    value: band.frequencyHz,
    min: 10,
    max: 40_000,
    size: 74,
    curve: "log",
    format: formatFrequency,
    onChange(value) {
      band.frequencyHz = value
      change()
    },
  })
  const gain = createKnob({
    label: "GAIN",
    value: band.gainDb,
    min: -BAND_GAIN_DB,
    max: BAND_GAIN_DB,
    size: 96,
    curve: "linear",
    format: formatGain,
    onChange(value) {
      band.gainDb = value
      change()
    },
  })
  const q = createKnob({
    label: "Q",
    value: band.q,
    min: 0.1,
    max: 10,
    size: 74,
    curve: "log",
    format: (value) => value.toFixed(2),
    onChange(value) {
      band.q = value
      change()
    },
  })
  liveKnobs = { freq, gain, q }
  deck.append(shapes, q.element, freq.element, gain.element)
  editor.append(deck)
}

function appendFilterDeck(kind: "hp" | "lp"): void {
  const filter = kind === "hp" ? match.highPass : match.lowPass
  if (!filter) return
  const deck = document.createElement("div")
  deck.className = "eq-deck"
  const change = () => {
    persist()
    paint()
  }
  const freq = createKnob({
    label: "FREQ",
    value: filter.frequencyHz,
    min: 10,
    max: 40_000,
    size: 74,
    curve: "log",
    format: formatFrequency,
    onChange(value) {
      filter.frequencyHz = value
      change()
    },
  })
  const slope = createKnob({
    label: "SLOPE",
    value: filter.slopeDbPerOct,
    min: FILTER_SLOPES[0] ?? 6,
    max: FILTER_SLOPES[FILTER_SLOPES.length - 1] ?? 72,
    size: 96,
    curve: "linear",
    steps: FILTER_SLOPES,
    format: (value) => `${value} dB/oct`,
    onChange(value) {
      filter.slopeDbPerOct = value
      change()
    },
  })
  liveKnobs = { freq, slope }
  liveFilter = kind
  deck.append(freq.element, slope.element)
  editor.append(deck)
}

function onEditorClick(event: Event): void {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]")
  if (!button) return
  const action = button.dataset.action
  if (action === "select-band") {
    const slot = Number(button.dataset.slot)
    if (slot >= 0 && slot < 4) selectBandSlot(slot)
  }
  if (action === "select-cut" && (button.dataset.filter === "hp" || button.dataset.filter === "lp")) {
    selectCutSlot(button.dataset.filter)
  }
  if (action === "shape" && button.dataset.shape) {
    const band = selectedBand()
    if (band) band.type = button.dataset.shape as BandType
  }
  persist()
  renderEditor()
  paint()
}

function selectBandSlot(slot: number): void {
  const current = match.bands[slot]
  const selectedAlready = Boolean(current && current.id === selectedBandId && selectedCut === null)
  if (selectedAlready && current) {
    current.enabled = !current.enabled
    return
  }
  const band = current ?? createBand()
  band.enabled = true
  match.bands[slot] = band
  selectedBandId = band.id
  selectedCut = null
}

function selectCutSlot(kind: "hp" | "lp"): void {
  const key = kind === "hp" ? "highPass" : "lowPass"
  const current = match[key]
  if (selectedCut === kind && current) {
    current.enabled = !current.enabled
    return
  }
  const filter = current ?? { frequencyHz: kind === "hp" ? 30 : 16_000, slopeDbPerOct: 12, enabled: true }
  filter.enabled = true
  match[key] = filter
  selectedCut = kind
}

function createBand(): MatchBand {
  return { id: crypto.randomUUID(), type: "bell", frequencyHz: 1000, gainDb: 0, q: 1, enabled: true }
}

function selectedBand(): MatchBand | null {
  return match.bands.find((band) => band?.id === selectedBandId) ?? null
}

function findBand(id: string): MatchBand | null {
  return match.bands.find((band) => band?.id === id) ?? null
}

function cutFromHandle(handle: Handle | null): "hp" | "lp" | null {
  if (!handle || handle.marker !== "cut") return null
  return handle.id.endsWith(":hp") ? "hp" : "lp"
}

async function copyState(): Promise<void> {
  const text = serializePreset(toPreset(match))
  try {
    await navigator.clipboard.writeText(text)
    copyNote.textContent = "Copied"
  } catch {
    const area = document.createElement("textarea")
    area.value = text
    document.body.append(area)
    area.select()
    const copied = document.execCommand("copy")
    area.remove()
    copyNote.textContent = copied ? "Copied" : "Copy failed"
  }
  window.setTimeout(() => {
    if (copyNote.textContent === "Copied") copyNote.textContent = ""
  }, 1600)
}

function currentFrame(): StageFrame | null {
  if (!bitmap) return null
  const rect = canvas.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return null
  return stageFrame(rect.width, rect.height, bitmap.width, bitmap.height)
}

function localPoint(event: MouseEvent): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function insideImage(x: number, y: number): boolean {
  if (!bitmap) return false
  return x >= 0 && y >= 0 && x <= bitmap.width && y <= bitmap.height
}

function slopeDirection(deltaY: number, deltaMode: number): 1 | -1 | 0 {
  if (deltaMode === 1) return deltaY === 0 ? 0 : deltaY < 0 ? 1 : -1
  slopeCarry += deltaY
  if (Math.abs(slopeCarry) < 40) return 0
  const direction: 1 | -1 = slopeCarry < 0 ? 1 : -1
  slopeCarry = 0
  return direction
}

function clampFreq(value: number): number {
  return clamp(value, 10, 40_000, 1000)
}

function clampGain(value: number): number {
  return clamp(value, -BAND_GAIN_DB, BAND_GAIN_DB, 0)
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function fillFrequencySelect(select: HTMLSelectElement, selected: number): void {
  for (const hz of FREQ_TICKS) {
    const option = document.createElement("option")
    option.value = String(hz)
    option.textContent = formatFrequency(hz)
    option.selected = hz === selected
    select.append(option)
  }
  if (select.value === "") select.value = String(selected)
}

function persist(): void {
  saveState({ freqA, freqB, gainA, gainB, knownDb, match, selectedBandId, selectedCut, showGuides })
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector}`)
  return element
}
