export interface KnobController {
  element: HTMLElement
  setValue: (value: number) => void
}

export function createKnob(options: {
  label: string
  value: number
  min: number
  max: number
  size: number
  curve: "linear" | "log"
  format: (value: number) => string
  onChange: (value: number) => void
  /** When set, the knob lands only on these values. */
  steps?: readonly number[]
}): KnobController {
  const steps = options.steps
  let value = steps ? nearestStep(options.value, steps) : clamp(options.value, options.min, options.max)
  let wheelCarry = 0
  const wrap = document.createElement("div")
  wrap.className = "knob-wrap"
  const label = document.createElement("p")
  label.className = "knob-label"
  label.textContent = options.label
  const face = document.createElement("div")
  face.className = "knob"
  face.style.width = `${options.size}px`
  face.style.height = `${options.size}px`
  face.tabIndex = 0
  face.setAttribute("role", "slider")
  face.setAttribute("aria-label", options.label)
  face.setAttribute("aria-valuemin", String(options.min))
  face.setAttribute("aria-valuemax", String(options.max))
  const readout = document.createElement("p")
  readout.className = "knob-value"
  wrap.append(label, face, readout)

  const paint = () => {
    const angle = -140 + knobAmount(value) * 280
    face.setAttribute("aria-valuenow", String(value))
    face.setAttribute("aria-valuetext", options.format(value))
    readout.textContent = options.format(value)
    face.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="none" stroke="#3a3a42" stroke-width="3" stroke-linecap="round" stroke-dasharray="200 90" transform="rotate(126 50 50)"/>
      <circle cx="50" cy="50" r="33" fill="#2a2a2e" stroke="#16161a" stroke-width="2"/>
      <line x1="50" y1="50" x2="50" y2="20" stroke="#f4f1ea" stroke-width="2.4" stroke-linecap="round" transform="rotate(${angle} 50 50)"/>
      <circle cx="50" cy="50" r="3.2" fill="#9a9aa3"/>
    </svg>`
  }

  let startY = 0
  let startValue = value
  face.addEventListener("pointerdown", (event) => {
    startY = event.clientY
    startValue = value
    face.setPointerCapture(event.pointerId)
    event.preventDefault()
  })
  face.addEventListener("pointermove", (event) => {
    if (!face.hasPointerCapture(event.pointerId)) return
    const next = steps
      ? dragStep(startValue, startY - event.clientY, steps)
      : dragValue(startValue, startY - event.clientY, options.min, options.max, options.curve)
    if (next === value) return
    value = next
    paint()
    options.onChange(value)
  })
  face.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault()
      const next = steps ? steppedWheel(event.deltaY, event.deltaMode) : continuousWheel(event.deltaY)
      if (next === null || next === value) return
      value = next
      paint()
      options.onChange(value)
    },
    { passive: false },
  )
  face.addEventListener("keydown", (event) => {
    const direction = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -1 : 0
    if (direction === 0) return
    event.preventDefault()
    const next = steps
      ? stepAt(steps, nearestIndex(value, steps) + direction)
      : options.curve === "log"
        ? clamp(value * (direction > 0 ? 1.05 : 1 / 1.05), options.min, options.max)
        : clamp(value + direction * 0.1, options.min, options.max)
    if (next === value) return
    value = next
    paint()
    options.onChange(value)
  })

  paint()
  return {
    element: wrap,
    setValue(next) {
      value = steps ? nearestStep(next, steps) : clamp(next, options.min, options.max)
      paint()
    },
  }

  function knobAmount(current: number): number {
    if (!steps || steps.length <= 1) return amount(current, options.min, options.max, options.curve)
    return nearestIndex(current, steps) / (steps.length - 1)
  }

  function continuousWheel(deltaY: number): number {
    const direction = deltaY < 0 ? 1 : -1
    return options.curve === "log"
      ? clamp(value * (direction > 0 ? 1.05 : 1 / 1.05), options.min, options.max)
      : clamp(value + direction * (options.label === "GAIN" ? 0.1 : (options.max - options.min) / 80), options.min, options.max)
  }

  function steppedWheel(deltaY: number, deltaMode: number): number | null {
    if (!steps) return null
    if (deltaMode === 1) return deltaY === 0 ? null : stepAt(steps, nearestIndex(value, steps) + (deltaY < 0 ? 1 : -1))
    wheelCarry += deltaY
    if (Math.abs(wheelCarry) < 40) return null
    const direction = wheelCarry < 0 ? 1 : -1
    wheelCarry = 0
    return stepAt(steps, nearestIndex(value, steps) + direction)
  }
}

function dragValue(start: number, deltaPx: number, min: number, max: number, curve: "linear" | "log"): number {
  const travel = 150
  const t0 = amount(start, min, max, curve)
  return fromAmount(Math.min(1, Math.max(0, t0 + deltaPx / travel)), min, max, curve)
}

function amount(value: number, min: number, max: number, curve: "linear" | "log"): number {
  if (curve === "log") {
    if (value <= min) return 0
    return Math.log(value / min) / Math.log(max / min)
  }
  return (value - min) / (max - min)
}

function fromAmount(amountValue: number, min: number, max: number, curve: "linear" | "log"): number {
  if (curve === "log") return min * (max / min) ** amountValue
  return min + amountValue * (max - min)
}

function nearestIndex(value: number, steps: readonly number[]): number {
  let index = 0
  let best = Infinity
  steps.forEach((step, candidate) => {
    const distance = Math.abs(step - value)
    if (distance < best) {
      best = distance
      index = candidate
    }
  })
  return index
}

function nearestStep(value: number, steps: readonly number[]): number {
  return steps[nearestIndex(value, steps)] ?? value
}

function stepAt(steps: readonly number[], index: number): number {
  const next = Math.min(steps.length - 1, Math.max(0, index))
  return steps[next] ?? steps[0] ?? 0
}

function dragStep(start: number, deltaPx: number, steps: readonly number[]): number {
  if (steps.length <= 1) return steps[0] ?? start
  const index = nearestIndex(start, steps) + (deltaPx / 150) * (steps.length - 1)
  return stepAt(steps, Math.round(index))
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}
