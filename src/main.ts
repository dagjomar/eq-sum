import { EXAMPLE_PASTE } from "./example"
import { drawGraph, handleAtPoint, indexFromX, labelColor, xToFrequency, yToDb, type DrawnCurve, type GraphHandle } from "./graph"
import { createKnob, type KnobController } from "./knob"
import {
  FILTER_SLOPES,
  emptyBands,
  normalizeMatch,
  stepSlope,
  toPreset,
  type MatchBand,
  type MatchFilter,
  type MatchInstance,
  type NodeBudget,
} from "./match"
import { describePreset, formatFrequency, formatGain, variantLabel } from "./nova/format"
import { logFrequencies, responseDb, sumCurves } from "./nova/magnitude"
import { parseStates } from "./nova/parse"
import { serializePreset } from "./nova/serialize"
import type { BandType, NovaPreset } from "./nova/types"

const STORAGE_KEY = "eq-sum/v1"
const FREQUENCIES = logFrequencies(640)
const COLORS = ["#ff5d6c", "#3ddc84", "#c084fc", "#5b9dff", "#f0a35e", "#f2e38a", "#2dd4bf", "#fb7185"]
const SUM_COLOR = "#f0c36a"
const BAND_GAIN_DB = 18
const SHAPES: [BandType, string][] = [
  ["low-shelf", "M2 12 H8 C12 12 13 4 18 4 H30"],
  ["bell", "M2 12 C8 12 10 3 16 3 C22 3 24 12 30 12"],
  ["high-shelf", "M2 12 H12 C18 12 19 4 24 4 H30"],
]

const ICONS = {
  up: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  down: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  solo: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/></svg>`,
  mute: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h3.5L12 6.5v11L7.5 14H4v-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 9.5a3.8 3.8 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  muted: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h3.5L12 6.5v11L7.5 14H4v-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M8 7l.8 12h6.4L16 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
}

interface Instance {
  id: string
  name: string
  color: string
  muted: boolean
  solo: boolean
  preset: NovaPreset
}

interface Persisted {
  version: 2
  rangeDb: 12 | 24
  instances: Instance[]
  mode: "chain" | "match"
  budget: NodeBudget
  matches: MatchInstance[]
  selectedMatchId: string | null
  selectedBandId: string | null
  selectedCut: "hp" | "lp" | null
}

const saved = load()
let instances = saved.instances
let rangeDb = saved.rangeDb
let mode = saved.mode
let budget = saved.budget
let matches = saved.matches
let selectedMatchId = saved.selectedMatchId
let selectedBandId = saved.selectedBandId
let selectedCut = saved.selectedCut
let colorIndex = instances.length + matches.length
let hoverIndex: number | null = null
let matchHandles: GraphHandle[] = []
let drag: { pointerId: number; handleId: string } | null = null
let finalView = false
let liveKnobs: { freq?: KnobController; gain?: KnobController; q?: KnobController; slope?: KnobController } = {}
let liveFilter: "hp" | "lp" | null = null
let slopeCarry = 0

const app = document.querySelector<HTMLElement>("#app")
if (!app) throw new Error("Missing #app")

app.innerHTML = `
  <div class="app">
    <header class="top">
      <div class="brand">
        <h1>One Curve</h1>
        <span class="badge">TDR Nova</span>
      </div>
      <nav class="tabs" role="tablist">
        <button id="tab-chain" type="button" role="tab">Chain</button>
        <button id="tab-match" type="button" role="tab">Match</button>
      </nav>
      <div class="scale" role="group" aria-label="Magnitude scale">
        <button id="scale-12" type="button">±12 dB</button>
        <button id="scale-24" type="button">±24 dB</button>
      </div>
    </header>
    <section class="panel graph-panel">
      <div id="graph-frame" class="graph-frame">
        <canvas id="graph" aria-label="Summed EQ magnitude"></canvas>
        <button id="final-view" class="final-view" type="button" hidden aria-label="Hold to show only the sum and the reference" title="Hold to show only the sum and the reference">${ICONS.solo}</button>
        <p id="empty" class="empty"></p>
      </div>
      <div class="legend">
        <p id="legend-label"></p>
        <p id="scale-hint" class="hint"></p>
        <p class="range" title="Presets add in dB. Inside one Nova, bells and shelves follow the stronger band and meet in a round join. A tight pair sinks a little below the nodes. Wideband gain is a flat offset.">10 Hz – 40 kHz</p>
      </div>
      <p id="readout" class="readout"></p>
    </section>
    <div id="chain-layout" class="layout">
      <section class="panel">
        <div class="panel-head">
          <h2>Paste</h2>
          <span class="meta">Copy State text</span>
        </div>
        <textarea id="paste" spellcheck="false" autocomplete="off" placeholder="<TDRNova ... />"></textarea>
        <p id="paste-error" class="error" role="status"></p>
        <div class="paste-foot">
          <span class="meta">Nova and Nova GE. ⌘ or Ctrl Enter adds.</span>
          <div class="actions">
            <button id="example" type="button">Example</button>
            <button id="add" class="primary" type="button">Add</button>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>Chain <span id="count"></span></h2>
          <span class="meta">Top to bottom</span>
          <button id="clear" class="text" type="button">Clear</button>
        </div>
        <p id="chain-empty" class="meta">Paste a state to add the first preset.</p>
        <ol id="cards" class="rows"></ol>
      </section>
    </div>
    <div id="match-layout" class="layout" hidden>
      <section class="panel">
        <div class="panel-head">
          <h2>Match</h2>
        </div>
        <ol id="match-rows" class="rows"></ol>
        <button id="add-nova" class="add-nova" type="button" aria-label="Add Nova">${ICONS.plus}</button>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2 id="editor-title">Nodes</h2>
          <button id="copy-state" class="text" type="button">Copy state</button>
        </div>
        <div id="editor"></div>
      </section>
    </div>
  </div>
`

const paste = required<HTMLTextAreaElement>("#paste")
const error = required<HTMLElement>("#paste-error")
const cards = required<HTMLElement>("#cards")
const canvas = required<HTMLCanvasElement>("#graph")
const empty = required<HTMLElement>("#empty")
const readout = required<HTMLElement>("#readout")
const legendLabel = required<HTMLElement>("#legend-label")
const scaleHint = required<HTMLElement>("#scale-hint")
const countLabel = required<HTMLElement>("#count")
const chainEmpty = required<HTMLElement>("#chain-empty")
const scale12 = required<HTMLButtonElement>("#scale-12")
const scale24 = required<HTMLButtonElement>("#scale-24")
const tabChain = required<HTMLButtonElement>("#tab-chain")
const tabMatch = required<HTMLButtonElement>("#tab-match")
const chainLayout = required<HTMLElement>("#chain-layout")
const matchLayout = required<HTMLElement>("#match-layout")
const finalViewButton = required<HTMLButtonElement>("#final-view")
const matchRows = required<HTMLElement>("#match-rows")
const editor = required<HTMLElement>("#editor")
const editorTitle = required<HTMLElement>("#editor-title")
const addNovaButton = required<HTMLButtonElement>("#add-nova")
const copyStateButton = required<HTMLButtonElement>("#copy-state")

required<HTMLButtonElement>("#add").addEventListener("click", () => addPaste(paste.value))
required<HTMLButtonElement>("#example").addEventListener("click", () => addPaste(EXAMPLE_PASTE))
required<HTMLButtonElement>("#clear").addEventListener("click", () => {
  instances = []
  hoverIndex = null
  persist()
  render()
})
scale12.addEventListener("click", () => setRange(12))
scale24.addEventListener("click", () => setRange(24))
tabChain.addEventListener("click", () => showMode("chain"))
tabMatch.addEventListener("click", () => showMode("match"))
addNovaButton.addEventListener("click", () => {
  if (!canAddNova()) return
  const created = createMatch()
  matches.push(created)
  selectedMatchId = created.id
  persist()
  render()
})
copyStateButton.addEventListener("click", () => {
  const selected = selectedMatch()
  if (!selected) return
  void navigator.clipboard.writeText(serializePreset(toPreset(selected))).then(() => {
    copyStateButton.textContent = "Copied"
    window.setTimeout(() => {
      copyStateButton.textContent = "Copy state"
    }, 1200)
  })
})
matchRows.addEventListener("click", onMatchRowClick)
matchRows.addEventListener("input", (event) => {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !input.dataset.id) return
  const instance = matches.find((item) => item.id === input.dataset.id)
  if (!instance) return
  instance.name = input.value
  if (selectedMatchId === instance.id) editorTitle.textContent = instance.name
  persist()
  draw()
})
editor.addEventListener("click", onEditorClick)
finalViewButton.addEventListener("pointerdown", (event) => {
  if (mode !== "match" || event.button !== 0) return
  setFinalView(true)
  event.preventDefault()
  try {
    finalViewButton.setPointerCapture(event.pointerId)
  } catch {
    // The view still ends on pointerup when capture is unavailable.
  }
})
window.addEventListener("pointerup", () => setFinalView(false))
window.addEventListener("pointercancel", () => setFinalView(false))
finalViewButton.addEventListener("keydown", (event) => {
  if (event.key !== " " && event.key !== "Enter") return
  event.preventDefault()
  setFinalView(true)
})
finalViewButton.addEventListener("keyup", (event) => {
  if (event.key !== " " && event.key !== "Enter") return
  setFinalView(false)
})
finalViewButton.addEventListener("blur", () => setFinalView(false))
canvas.addEventListener("pointerdown", onGraphPointerDown)
canvas.addEventListener("pointermove", onGraphPointerMove)
canvas.addEventListener("pointerup", () => {
  drag = null
  canvas.style.cursor = "crosshair"
})
canvas.addEventListener("dblclick", onGraphDoubleClick)
canvas.addEventListener("wheel", onGraphWheel, { passive: false })
paste.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    addPaste(paste.value)
  }
})
cards.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]")
  if (!button) return
  const id = button.dataset.id
  const action = button.dataset.action
  if (!id || !action) return
  const index = instances.findIndex((item) => item.id === id)
  if (index < 0) return
  const instance = instances[index]
  if (action === "delete") instances.splice(index, 1)
  if (action === "mute") instance.muted = !instance.muted
  if (action === "solo") instance.solo = !instance.solo
  if (action === "up" && index > 0) swap(index, index - 1)
  if (action === "down" && index < instances.length - 1) swap(index, index + 1)
  persist()
  render()
})
cards.addEventListener("input", (event) => {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !input.dataset.id) return
  const instance = instances.find((item) => item.id === input.dataset.id)
  if (!instance) return
  instance.name = input.value
  persist()
  draw()
})
canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect()
  const point = graphPoint(event)
  if (mode === "match" && point && handleAtPoint(matchHandles, point.x, point.y, rect.width, rect.height, rangeDb)) {
    canvas.style.cursor = drag ? "grabbing" : "grab"
  } else if (!drag) canvas.style.cursor = "crosshair"
  const next = indexFromX(event.clientX - rect.left, rect.width, FREQUENCIES.length)
  if (next === hoverIndex) return
  hoverIndex = next
  if (!drag) draw()
})
canvas.addEventListener("mouseleave", () => {
  hoverIndex = null
  draw()
})
new ResizeObserver(() => draw()).observe(canvas.parentElement ?? canvas)

render()

function addPaste(text: string): void {
  const result = parseStates(text)
  error.textContent = result.error ?? ""
  if (result.presets.length === 0) return
  for (const preset of result.presets) {
    instances.push({
      id: crypto.randomUUID(),
      name: nextName(),
      color: COLORS[colorIndex % COLORS.length],
      muted: false,
      solo: false,
      preset,
    })
    colorIndex += 1
  }
  paste.value = ""
  persist()
  render()
}

function render(): void {
  tabChain.setAttribute("aria-selected", String(mode === "chain"))
  tabMatch.setAttribute("aria-selected", String(mode === "match"))
  chainLayout.hidden = mode !== "chain"
  matchLayout.hidden = mode !== "match"
  finalViewButton.hidden = mode !== "match"
  if (mode !== "match") finalView = false
  finalViewButton.classList.toggle("is-held", finalView)
  finalViewButton.setAttribute("aria-pressed", String(finalView))
  renderCards()
  renderMatch()
  draw()
}

function renderCards(): void {
  countLabel.textContent = instances.length > 0 ? `(${instances.length})` : ""
  chainEmpty.hidden = instances.length > 0
  cards.replaceChildren()
  for (const [index, instance] of instances.entries()) {
    const item = document.createElement("li")
    item.className = `row${instance.solo ? " is-solo" : ""}${instance.muted ? " is-muted" : ""}`
    item.title = [variantLabel(instance.preset), describePreset(instance.preset), ...instance.preset.warnings]
      .filter(Boolean)
      .join(" · ")

    const indexLabel = document.createElement("span")
    indexLabel.className = "index"
    indexLabel.textContent = `${index + 1}`

    const swatch = document.createElement("span")
    swatch.className = "swatch"
    swatch.style.background = instance.color

    const name = document.createElement("input")
    name.className = "name"
    name.value = instance.name
    name.setAttribute("aria-label", "Preset name")
    name.dataset.id = instance.id

    const bands = document.createElement("span")
    bands.className = instance.preset.warnings.length > 0 ? "bands warn" : "bands"
    bands.textContent = bandLabel(instance.preset)

    const actions = document.createElement("div")
    actions.className = "row-actions"
    actions.append(
      iconButton("up", "Move earlier in the chain", instance, ICONS.up, index === 0),
      iconButton("down", "Move later in the chain", instance, ICONS.down, index === instances.length - 1),
      iconButton("solo", "Solo", instance, ICONS.solo),
      iconButton("mute", "Mute", instance, instance.muted ? ICONS.muted : ICONS.mute),
      iconButton("delete", "Delete", instance, ICONS.trash),
    )
    item.append(indexLabel, swatch, name, bands, actions)
    cards.append(item)
  }
}

function draw(): void {
  scale12.setAttribute("aria-pressed", String(rangeDb === 12))
  scale24.setAttribute("aria-pressed", String(rangeDb === 24))
  if (mode === "match") {
    drawMatch()
    return
  }
  const audible = visibleInstances()
  const curves = audible.map((instance) => responseDb(instance.preset, FREQUENCIES))
  const sum = sumCurves(curves)
  const drawn: DrawnCurve[] = []
  if (audible.length > 1) {
    audible.forEach((instance, index) => {
      drawn.push({ color: instance.color, width: 1.5, values: curves[index] ?? [], fill: false })
    })
  }
  if (sum.length > 0) drawn.push({ color: SUM_COLOR, width: 2.25, values: sum, fill: false })

  drawGraph(canvas, FREQUENCIES, drawn, rangeDb, hoverIndex)

  const message =
    instances.length === 0
      ? "Paste a Nova state to draw its curve."
      : audible.length === 0
        ? "Every preset is muted."
        : ""
  empty.hidden = message === ""
  empty.textContent = message

  setLegend(audible)
  const peak = sum.reduce((max, value) => Math.max(max, Math.abs(value)), 0)
  scaleHint.textContent = peak > rangeDb + 0.05 ? `Outside ±${rangeDb} dB` : ""

  if (hoverIndex === null || FREQUENCIES[hoverIndex] === undefined) {
    readout.textContent = audible.length > 0 ? "Hover the graph." : ""
    return
  }
  const frequency = formatFrequency(FREQUENCIES[hoverIndex])
  if (sum.length === 0) {
    readout.textContent = frequency
    return
  }
  const details = audible.map((instance, index) => {
    const value = curves[index]?.[hoverIndex ?? 0] ?? 0
    return `${instance.name} ${formatGain(value)}`
  })
  readout.textContent = `${frequency} · Sum ${formatGain(sum[hoverIndex] ?? 0)} · ${details.join(" · ")}`
}

function visibleInstances(): Instance[] {
  const solos = instances.filter((instance) => instance.solo)
  if (solos.length > 0) return solos
  return instances.filter((instance) => !instance.muted)
}

function chainReference(): number[] {
  const sum = sumCurves(visibleInstances().map((instance) => responseDb(instance.preset, FREQUENCIES)))
  return sum.length > 0 ? sum : FREQUENCIES.map(() => 0)
}

function drawMatch(): void {
  const audible = visibleMatches()
  const curves = audible.map((instance) => responseDb(toPreset(instance), FREQUENCIES))
  const sum = sumCurves(curves)
  const reference = chainReference()
  const drawn: DrawnCurve[] = []
  if (!finalView && audible.length > 1) {
    audible.forEach((instance, index) => {
      drawn.push({ color: instance.color, width: 1.5, values: curves[index] ?? [], fill: false })
    })
  }
  if (sum.length > 0) drawn.push({ color: SUM_COLOR, width: 2.25, values: sum, fill: false })
  drawn.push({ color: "#d5d5dc", width: 1.35, values: reference, fill: false, dash: [5, 4] })
  matchHandles = finalView ? [] : buildHandles()
  drawGraph(canvas, FREQUENCIES, drawn, rangeDb, drag ? null : hoverIndex, matchHandles)

  const message = matches.length === 0 ? "Add a Nova and shape it against the dashed reference." : audible.length === 0 ? "Every match preset is muted." : ""
  empty.hidden = message === ""
  empty.textContent = message

  legendLabel.replaceChildren()
  legendLabel.append(legendItem("#d5d5dc", "Reference"))
  if (sum.length > 0) {
    const soloed = matches.some((instance) => instance.solo)
    const label = finalView ? "Sum" : soloed ? `Match · ${audible.map((instance) => instance.name).join(", ")}` : "Match"
    legendLabel.append(legendItem(SUM_COLOR, label))
  }

  const peak = Math.max(
    sum.reduce((max, value) => Math.max(max, Math.abs(value)), 0),
    reference.reduce((max, value) => Math.max(max, Math.abs(value)), 0),
  )
  scaleHint.textContent = peak > rangeDb + 0.05 ? `Outside ±${rangeDb} dB` : ""

  const dragged = draggedBand()
  if (dragged) {
    readout.textContent = `${formatFrequency(dragged.frequencyHz)} · ${formatGain(dragged.gainDb)} · Q ${dragged.q.toFixed(2)}`
    return
  }
  const draggedCut = draggedFilter()
  if (draggedCut) {
    const name = draggedCut.kind === "hp" ? "HP" : "LP"
    readout.textContent = `${name} ${formatFrequency(draggedCut.filter.frequencyHz)} · ${draggedCut.filter.slopeDbPerOct} dB/oct`
    return
  }
  if (hoverIndex === null || FREQUENCIES[hoverIndex] === undefined) {
    readout.textContent = ""
    return
  }
  const frequency = formatFrequency(FREQUENCIES[hoverIndex])
  const parts = [`${frequency}`, `Reference ${formatGain(reference[hoverIndex] ?? 0)}`]
  if (sum.length > 0) parts.push(`Match ${formatGain(sum[hoverIndex] ?? 0)}`)
  readout.textContent = parts.join(" · ")
}

function renderMatch(): void {
  if (matches.length > 0 && !matches.some((item) => item.id === selectedMatchId)) {
    selectedMatchId = matches[0]?.id ?? null
  }
  addNovaButton.disabled = !canAddNova()
  matchRows.replaceChildren()
  for (const [index, instance] of matches.entries()) {
    const item = document.createElement("li")
    item.className = `row${instance.solo ? " is-solo" : ""}${instance.muted ? " is-muted" : ""}${instance.id === selectedMatchId ? " is-selected" : ""}`
    item.dataset.select = instance.id
    const indexLabel = document.createElement("span")
    indexLabel.className = "index"
    indexLabel.textContent = `${index + 1}`
    const swatch = document.createElement("span")
    swatch.className = "swatch"
    swatch.style.background = instance.color
    const name = document.createElement("input")
    name.className = "name"
    name.value = instance.name
    name.setAttribute("aria-label", "Preset name")
    name.dataset.id = instance.id
    const bands = document.createElement("span")
    bands.className = "bands"
    const enabledBands = instance.bands.filter((band) => band?.enabled).length
    bands.textContent = enabledBands === 1 ? "1 band" : `${enabledBands} bands`
    const actions = document.createElement("div")
    actions.className = "row-actions"
    actions.append(
      iconButton("up", "Move earlier in the chain", instance, ICONS.up, index === 0),
      iconButton("down", "Move later in the chain", instance, ICONS.down, index === matches.length - 1),
      iconButton("solo", "Solo", instance, ICONS.solo),
      iconButton("mute", "Mute", instance, instance.muted ? ICONS.muted : ICONS.mute),
      iconButton("delete", "Delete", instance, ICONS.trash),
    )
    item.append(indexLabel, swatch, name, bands, actions)
    matchRows.append(item)
  }
  renderEditor()
}

function renderEditor(): void {
  const selected = selectedMatch()
  copyStateButton.disabled = !selected
  editorTitle.textContent = selected?.name ?? "Nodes"
  liveKnobs = {}
  liveFilter = null
  editor.replaceChildren()
  if (!selected) {
    const note = document.createElement("p")
    note.className = "meta"
    note.textContent = "Add a Nova, then turn on a band."
    editor.append(note)
    return
  }
  if (selectedCut === "hp" && !selected.highPass) selectedCut = null
  if (selectedCut === "lp" && !selected.lowPass) selectedCut = null
  const band = selected.bands.find((item) => item?.id === selectedBandId) ?? null
  if (selectedBandId && !band) selectedBandId = null
  editor.append(renderSlots(selected))

  if (selectedCut) {
    appendFilterDeck(selected, selectedCut)
  } else if (!band) {
    const note = document.createElement("p")
    note.className = "meta"
    note.textContent = "Turn on HP, a band, or LP. Click the selected circle again to turn it off."
    editor.append(note)
  } else {
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
      draw()
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
}

function renderSlots(instance: MatchInstance): HTMLElement {
  const picks = document.createElement("div")
  picks.className = "band-picks"
  picks.append(cutSlot(instance, "hp"))
  for (let slot = 0; slot < 4; slot += 1) picks.append(bandSlot(instance, slot))
  picks.append(cutSlot(instance, "lp"))
  return picks
}

function bandSlot(instance: MatchInstance, slot: number): HTMLButtonElement {
  const band = instance.bands[slot]
  const on = Boolean(band?.enabled)
  const current = selectedCut === null && band?.id === selectedBandId
  const button = document.createElement("button")
  button.type = "button"
  button.className = `pick${on ? " is-on" : " is-off"}${current ? " is-current" : ""}`
  button.dataset.action = "select-band"
  button.dataset.slot = String(slot)
  button.textContent = `${slot + 1}`
  if (on) paintOn(button, instance.color)
  button.setAttribute("aria-pressed", String(on))
  button.setAttribute("aria-label", slotLabel(`Band ${slot + 1}`, on, current))
  return button
}

function cutSlot(instance: MatchInstance, kind: "hp" | "lp"): HTMLButtonElement {
  const filter = kind === "hp" ? instance.highPass : instance.lowPass
  const on = Boolean(filter?.enabled)
  const current = selectedCut === kind
  const button = document.createElement("button")
  button.type = "button"
  button.className = `pick pick-cut${on ? " is-on" : " is-off"}${current ? " is-current" : ""}`
  button.dataset.action = "select-cut"
  button.dataset.filter = kind
  button.textContent = kind === "hp" ? "HP" : "LP"
  if (on) paintOn(button, instance.color)
  button.setAttribute("aria-pressed", String(on))
  button.setAttribute("aria-label", slotLabel(kind === "hp" ? "High-pass" : "Low-pass", on, current))
  return button
}

function paintOn(button: HTMLButtonElement, fill: string): void {
  button.style.background = fill
  button.style.setProperty("--pick-ink", labelColor(fill))
}

function slotLabel(name: string, on: boolean, current: boolean): string {
  if (!on) return `${name} off`
  return current ? `${name} on. Click again to turn off` : `${name} on`
}

function appendFilterDeck(instance: MatchInstance, kind: "hp" | "lp"): void {
  const filter = kind === "hp" ? instance.highPass : instance.lowPass
  if (!filter) return
  const deck = document.createElement("div")
  deck.className = "eq-deck"
  const change = () => {
    persist()
    draw()
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

function onMatchRowClick(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) return
  const button = (target as HTMLElement).closest<HTMLButtonElement>("button[data-action]")
  if (button) {
    const id = button.dataset.id
    const action = button.dataset.action
    if (!id || !action) return
    const index = matches.findIndex((item) => item.id === id)
    if (index < 0) return
    const instance = matches[index]
    if (action === "delete") {
      matches.splice(index, 1)
      if (selectedMatchId === id) selectedMatchId = matches[0]?.id ?? null
    }
    if (action === "mute") instance.muted = !instance.muted
    if (action === "solo") instance.solo = !instance.solo
    if (action === "up" && index > 0) swapMatch(index, index - 1)
    if (action === "down" && index < matches.length - 1) swapMatch(index, index + 1)
    persist()
    render()
    return
  }
  const row = (target as HTMLElement).closest<HTMLElement>("[data-select]")
  if (!row?.dataset.select) return
  selectedMatchId = row.dataset.select
  persist()
  render()
}

function onEditorClick(event: Event): void {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]")
  if (!button) return
  const selected = selectedMatch()
  if (!selected) return
  const action = button.dataset.action
  if (action === "select-band") {
    const slot = Number(button.dataset.slot)
    if (slot >= 0 && slot < 4) selectBandSlot(selected, slot)
  }
  if (action === "shape" && button.dataset.shape) {
    const band = selected.bands.find((item) => item?.id === selectedBandId)
    if (band) band.type = button.dataset.shape as BandType
  }
  if (action === "select-cut" && (button.dataset.filter === "hp" || button.dataset.filter === "lp")) {
    selectCutSlot(selected, button.dataset.filter)
  }
  persist()
  render()
}

function setFinalView(next: boolean): void {
  if (finalView === next) return
  finalView = next
  finalViewButton.classList.toggle("is-held", next)
  finalViewButton.setAttribute("aria-pressed", String(next))
  if (mode === "match") draw()
}

function onGraphPointerDown(event: PointerEvent): void {
  if (mode !== "match" || finalView) return
  const point = graphPoint(event)
  if (!point) return
  const rect = canvas.getBoundingClientRect()
  const hit = handleAtPoint(matchHandles, point.x, point.y, rect.width, rect.height, rangeDb)
  if (!hit) return
  drag = { pointerId: event.pointerId, handleId: hit.id }
  canvas.setPointerCapture(event.pointerId)
  canvas.style.cursor = "grabbing"
  selectHandle(hit)
  event.preventDefault()
}

function onGraphPointerMove(event: PointerEvent): void {
  if (!drag || drag.pointerId !== event.pointerId) return
  const point = graphPoint(event)
  if (!point) return
  const rect = canvas.getBoundingClientRect()
  const frequency = clamp(xToFrequency(point.x, rect.width), 10, 40_000, 1000)
  if (drag.handleId.endsWith(":hp") || drag.handleId.endsWith(":lp")) {
    const kind = drag.handleId.endsWith(":hp") ? "hp" : "lp"
    const instance = matches.find((item) => item.id === drag?.handleId.slice(0, -3))
    const filter = kind === "hp" ? instance?.highPass : instance?.lowPass
    if (filter) {
      filter.frequencyHz = frequency
      if (liveFilter === kind) liveKnobs.freq?.setValue(filter.frequencyHz)
    }
  } else {
    const located = findBand(drag.handleId)
    if (!located) return
    located.band.frequencyHz = frequency
    located.band.gainDb = clamp(yToDb(point.y, rect.height, rangeDb), -BAND_GAIN_DB, BAND_GAIN_DB, located.band.gainDb)
    liveKnobs.freq?.setValue(located.band.frequencyHz)
    liveKnobs.gain?.setValue(located.band.gainDb)
  }
  persist()
  draw()
}

function onGraphDoubleClick(event: MouseEvent): void {
  if (mode !== "match" || finalView) return
  const point = graphPoint(event)
  if (!point) return
  const rect = canvas.getBoundingClientRect()
  if (handleAtPoint(matchHandles, point.x, point.y, rect.width, rect.height, rangeDb)) return
  let instance = selectedMatch()
  if (!instance) {
    if (!canAddNova()) return
    instance = createMatch()
    matches.push(instance)
    selectedMatchId = instance.id
  }
  const slot = instance.bands.findIndex((item) => !item)
  if (slot < 0) return
  const band = createBand()
  band.frequencyHz = clamp(xToFrequency(point.x, rect.width), 10, 40_000, 1000)
  band.gainDb = clamp(yToDb(point.y, rect.height, rangeDb), -BAND_GAIN_DB, BAND_GAIN_DB, 0)
  instance.bands[slot] = band
  selectedBandId = band.id
  selectedCut = null
  persist()
  render()
}

function onGraphWheel(event: WheelEvent): void {
  if (mode !== "match" || finalView) return
  const point = graphPoint(event)
  const rect = canvas.getBoundingClientRect()
  const hit = point ? handleAtPoint(matchHandles, point.x, point.y, rect.width, rect.height, rangeDb) : null
  const cut = cutFromHandle(hit) ?? (hit ? null : selectedCut)
  if (cut) {
    const instance = hit ? matches.find((item) => item.id === hit.instanceId) : selectedMatch()
    const filter = instance ? (cut === "hp" ? instance.highPass : instance.lowPass) : null
    if (instance && filter) {
      event.preventDefault()
      if (hit) selectHandle(hit)
      const direction = slopeDirection(event.deltaY, event.deltaMode)
      if (!direction) return
      const current = cut === "hp" ? instance.highPass : instance.lowPass
      if (!current) return
      current.slopeDbPerOct = stepSlope(current.slopeDbPerOct, direction)
      if (liveFilter === cut) liveKnobs.slope?.setValue(current.slopeDbPerOct)
      persist()
      draw()
      return
    }
  }
  slopeCarry = 0
  const band = hit?.marker === "band" ? findBand(hit.id)?.band : hit ? null : selectedBand()
  if (!band) return
  event.preventDefault()
  if (hit?.marker === "band") selectHandle(hit)
  band.q = clamp(band.q * Math.exp(-event.deltaY * 0.0012), 0.1, 10, band.q)
  liveKnobs.q?.setValue(band.q)
  persist()
  draw()
}

function slopeDirection(deltaY: number, deltaMode: number): 1 | -1 | 0 {
  if (deltaMode === 1) return deltaY === 0 ? 0 : deltaY < 0 ? 1 : -1
  slopeCarry += deltaY
  if (Math.abs(slopeCarry) < 40) return 0
  const direction: 1 | -1 = slopeCarry < 0 ? 1 : -1
  slopeCarry = 0
  return direction
}

function cutFromHandle(handle: GraphHandle | null): "hp" | "lp" | null {
  if (!handle || handle.marker !== "cut") return null
  return handle.id.endsWith(":hp") ? "hp" : "lp"
}

function selectHandle(handle: GraphHandle): void {
  selectedMatchId = handle.instanceId
  if (handle.marker === "band") {
    selectedBandId = handle.id
    selectedCut = null
  } else {
    selectedCut = handle.id.endsWith(":hp") ? "hp" : "lp"
  }
  const matchId = selectedMatch()?.id
  const showingBand = selectedCut === null && Boolean(liveKnobs.q) && selectedBand()?.id === selectedBandId && matchId === handle.instanceId
  const showingCut = selectedCut !== null && liveFilter === selectedCut && Boolean(liveKnobs.slope) && matchId === handle.instanceId
  if (!showingBand && !showingCut) render()
}

function buildHandles(): GraphHandle[] {
  const handles: GraphHandle[] = []
  for (const instance of visibleMatches()) {
    for (const band of instance.bands) {
      if (!band?.enabled) continue
      handles.push({
        id: band.id,
        instanceId: instance.id,
        frequencyHz: band.frequencyHz,
        gainDb: band.gainDb,
        color: instance.color,
        selected: selectedCut === null && band.id === selectedBandId && instance.id === selectedMatch()?.id,
        marker: "band",
      })
    }
    if (instance.highPass?.enabled) handles.push(cutHandle(instance, "hp", instance.highPass))
    if (instance.lowPass?.enabled) handles.push(cutHandle(instance, "lp", instance.lowPass))
  }
  return handles
}

function graphPoint(event: MouseEvent): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function findBand(id: string): { instance: MatchInstance; band: MatchBand } | null {
  for (const instance of matches) {
    const band = instance.bands.find((item) => item?.id === id)
    if (band) return { instance, band }
  }
  return null
}

function selectedBand(): MatchBand | null {
  return selectedMatch()?.bands.find((band) => band?.id === selectedBandId) ?? null
}

function draggedBand(): MatchBand | null {
  if (!drag || drag.handleId.includes(":")) return null
  return findBand(drag.handleId)?.band ?? null
}

function draggedFilter(): { kind: "hp" | "lp"; filter: MatchFilter } | null {
  if (!drag || (!drag.handleId.endsWith(":hp") && !drag.handleId.endsWith(":lp"))) return null
  const kind = drag.handleId.endsWith(":hp") ? "hp" : "lp"
  const instance = matches.find((item) => item.id === drag?.handleId.slice(0, -3))
  const filter = kind === "hp" ? instance?.highPass : instance?.lowPass
  return filter ? { kind, filter } : null
}

function cutHandle(instance: MatchInstance, kind: "hp" | "lp", filter: MatchFilter): GraphHandle {
  const active = selectedMatch()?.id === instance.id && selectedCut === kind
  return {
    id: `${instance.id}:${kind}`,
    instanceId: instance.id,
    frequencyHz: filter.frequencyHz,
    gainDb: nodeGain(instance, filter.frequencyHz),
    color: instance.color,
    selected: active,
    marker: "cut",
    label: kind === "hp" ? "HP" : "LP",
  }
}

function nodeGain(instance: MatchInstance, frequencyHz: number): number {
  const gain = responseDb(toPreset(instance), [frequencyHz])[0] ?? 0
  const limit = Math.max(1, rangeDb - 1)
  return Math.min(limit, Math.max(-limit, gain))
}

function showMode(next: "chain" | "match"): void {
  mode = next
  persist()
  render()
}

function visibleMatches(): MatchInstance[] {
  const solos = matches.filter((instance) => instance.solo)
  if (solos.length > 0) return solos
  return matches.filter((instance) => !instance.muted)
}

function selectedMatch(): MatchInstance | undefined {
  return matches.find((instance) => instance.id === selectedMatchId) ?? matches[0]
}

function canAddNova(): boolean {
  return matches.length < 3
}

function selectBandSlot(instance: MatchInstance, slot: number): void {
  const current = instance.bands[slot]
  const selectedAlready = Boolean(current && current.id === selectedBandId && selectedCut === null)
  if (selectedAlready && current) {
    current.enabled = !current.enabled
    return
  }
  const band = current ?? createBand()
  band.enabled = true
  instance.bands[slot] = band
  selectedBandId = band.id
  selectedCut = null
}

function selectCutSlot(instance: MatchInstance, kind: "hp" | "lp"): void {
  const key = kind === "hp" ? "highPass" : "lowPass"
  const current = instance[key]
  if (selectedCut === kind && current) {
    current.enabled = !current.enabled
    return
  }
  instance[key] = current ?? { frequencyHz: kind === "hp" ? 30 : 16_000, slopeDbPerOct: 12, enabled: true }
  instance[key].enabled = true
  selectedCut = kind
}

function createMatch(): MatchInstance {
  colorIndex += 1
  const used = matches.map((instance) => Number(/^Nova (\d+)$/.exec(instance.name)?.[1] ?? 0))
  return {
    id: crypto.randomUUID(),
    name: `Nova ${Math.max(0, ...used) + 1}`,
    color: COLORS[(colorIndex - 1) % COLORS.length] ?? COLORS[0],
    muted: false,
    solo: false,
    bands: emptyBands(),
    highPass: null,
    lowPass: null,
  }
}

function createBand(): MatchBand {
  return { id: crypto.randomUUID(), type: "bell", frequencyHz: 1000, gainDb: 0, q: 1, enabled: true }
}

function swapMatch(a: number, b: number): void {
  const current = matches[a]
  matches[a] = matches[b]
  matches[b] = current
}

function legendItem(color: string, label: string): HTMLSpanElement {
  const item = document.createElement("span")
  item.className = "legend-item"
  const dot = document.createElement("span")
  dot.className = "swatch"
  dot.style.background = color
  const text = document.createElement("span")
  text.textContent = label
  item.append(dot, text)
  return item
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function setRange(next: 12 | 24): void {
  rangeDb = next
  persist()
  draw()
}

function swap(a: number, b: number): void {
  const current = instances[a]
  instances[a] = instances[b]
  instances[b] = current
}

function nextName(): string {
  const used = instances.map((instance) => Number(/^Nova (\d+)$/.exec(instance.name)?.[1] ?? 0))
  return `Nova ${Math.max(0, ...used) + 1}`
}

function setLegend(audible: Instance[]): void {
  legendLabel.replaceChildren()
  if (audible.length === 0) return
  const dot = document.createElement("span")
  dot.className = "swatch"
  dot.style.background = SUM_COLOR
  const text = document.createElement("span")
  const soloed = instances.some((instance) => instance.solo)
  text.textContent = soloed ? `Solo · ${audible.map((instance) => instance.name).join(", ")}` : "Sum"
  legendLabel.append(dot, text)
}

function bandLabel(preset: NovaPreset): string {
  const count = preset.bands.length
  const parts: string[] = []
  if (count > 0) parts.push(count === 1 ? "1 band" : `${count} bands`)
  if (preset.highPass) parts.push("HP")
  if (preset.lowPass) parts.push("LP")
  if (parts.length === 0 && Math.abs(preset.wideGainDb) > 0.05) return "Wide"
  if (parts.length === 0) return "Flat"
  return parts.join(" · ")
}

function iconButton(
  action: string,
  label: string,
  instance: { id: string; muted: boolean; solo: boolean },
  icon: string,
  disabled = false,
): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "icon"
  button.dataset.action = action
  button.dataset.id = instance.id
  button.disabled = disabled
  button.setAttribute("aria-label", label)
  button.innerHTML = icon
  if (action === "mute") button.setAttribute("aria-pressed", String(instance.muted))
  if (action === "solo") button.setAttribute("aria-pressed", String(instance.solo))
  return button
}

function persist(): void {
  const data: Persisted = { version: 2, rangeDb, instances, mode, budget, matches, selectedMatchId, selectedBandId, selectedCut }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

function load(): Persisted {
  const empty: Persisted = {
    version: 2,
    rangeDb: 12,
    instances: [],
    mode: "chain",
    budget: 4,
    matches: [],
    selectedMatchId: null,
    selectedBandId: null,
    selectedCut: null,
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const data = JSON.parse(raw) as Partial<Persisted> & { reference?: unknown }
    const restored = Array.isArray(data.instances) ? data.instances.filter(isInstance) : []
    const restoredMatches = Array.isArray(data.matches) ? data.matches.filter(isMatch).map(normalizeMatch) : []
    return {
      version: 2,
      rangeDb: data.rangeDb === 24 ? 24 : 12,
      instances: restored,
      mode: data.mode === "match" ? "match" : "chain",
      budget: data.budget === 8 || data.budget === 12 ? data.budget : 4,
      matches: restoredMatches,
      selectedMatchId: typeof data.selectedMatchId === "string" ? data.selectedMatchId : null,
      selectedBandId: typeof data.selectedBandId === "string" ? data.selectedBandId : null,
      selectedCut: data.selectedCut === "hp" || data.selectedCut === "lp" ? data.selectedCut : null,
    }
  } catch {
    return empty
  }
}

function isMatch(value: unknown): value is MatchInstance {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<MatchInstance>
  return typeof item.id === "string" && typeof item.name === "string" && Array.isArray(item.bands)
}

function isInstance(value: unknown): value is Instance {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<Instance>
  return typeof item.id === "string" && typeof item.name === "string" && Array.isArray(item.preset?.bands)
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector}`)
  return element
}
