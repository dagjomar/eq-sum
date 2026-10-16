import { emptyBands, normalizeMatch, type MatchInstance } from "../match"
import type { AnchorX, AnchorY } from "./align"

const STATE_KEY = "eq-sum/trace/v1"
const DB_NAME = "eq-sum-trace"
const DB_STORE = "files"

export interface TraceState {
  freqA: AnchorX | null
  freqB: AnchorX | null
  gainA: AnchorY | null
  gainB: AnchorY | null
  knownDb: number
  match: MatchInstance
  selectedBandId: string | null
  selectedCut: "hp" | "lp" | null
  showGuides: boolean
}

export function blankState(): TraceState {
  return {
    freqA: null,
    freqB: null,
    gainA: null,
    gainB: null,
    knownDb: 6,
    match: {
      id: crypto.randomUUID(),
      name: "Nova",
      color: "#f0c36a",
      muted: false,
      solo: false,
      bands: emptyBands(),
      highPass: null,
      lowPass: null,
    },
    selectedBandId: null,
    selectedCut: null,
    showGuides: true,
  }
}

export function loadState(): TraceState {
  const blank = blankState()
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return blank
    const data = JSON.parse(raw) as Partial<TraceState>
    const match = isMatch(data.match) ? normalizeMatch(data.match) : blank.match
    if (!match.color) match.color = "#f0c36a"
    const gainA = anchorY(data.gainA)
    return {
      freqA: anchorX(data.freqA),
      freqB: anchorX(data.freqB),
      gainA: gainA ? { ...gainA, db: 0 } : null,
      gainB: anchorY(data.gainB),
      knownDb: typeof data.knownDb === "number" && Number.isFinite(data.knownDb) ? data.knownDb : 6,
      match,
      selectedBandId: typeof data.selectedBandId === "string" ? data.selectedBandId : null,
      selectedCut: data.selectedCut === "hp" || data.selectedCut === "lp" ? data.selectedCut : null,
      showGuides: data.showGuides !== false,
    }
  } catch {
    return blank
  }
}

export function saveState(state: TraceState): void {
  localStorage.setItem(STATE_KEY, JSON.stringify({ version: 1, ...state }))
}

export async function saveShot(blob: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite")
    tx.objectStore(DB_STORE).put(blob, "shot")
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function loadShot(): Promise<Blob | null> {
  try {
    const db = await openDb()
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get("shot")
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return blob
  } catch {
    return null
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function anchorX(value: unknown): AnchorX | null {
  if (!value || typeof value !== "object") return null
  const item = value as Partial<AnchorX>
  if (typeof item.hz !== "number" || !(item.hz > 0) || typeof item.x !== "number" || !Number.isFinite(item.x)) return null
  return { hz: item.hz, x: item.x }
}

function anchorY(value: unknown): AnchorY | null {
  if (!value || typeof value !== "object") return null
  const item = value as Partial<AnchorY>
  if (typeof item.db !== "number" || !Number.isFinite(item.db) || typeof item.y !== "number" || !Number.isFinite(item.y)) return null
  return { db: item.db, y: item.y }
}

function isMatch(value: unknown): value is MatchInstance {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<MatchInstance>
  return typeof item.id === "string" && typeof item.name === "string" && Array.isArray(item.bands)
}
