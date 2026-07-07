// Stadium table layout (design uplift, locked decisions 5-7): the rail is
// a racetrack — straight sides + true semicircular ends, like real felt —
// and seat CENTERS sit exactly ON it at equal arc-length steps, so every
// adjacent pair of cards is the same distance apart. Index 0 is the hero,
// pinned to bottom-center; the ring walks CLOCKWISE as seen on screen —
// the next seat renders to the hero's LEFT (real deal order). The full
// geometry contract lives in DESIGN.md (Live Table section).

export interface SeatPoint {
  x: number
  y: number
}

export interface RailBox {
  left: number
  top: number
  width: number
  height: number
  /** Semicircle radius == width / 2 (true stadium). */
  radius: number
}

export interface StadiumLayoutResult {
  seats: SeatPoint[]
  rail: RailBox
  center: SeatPoint
}

// Insets tuned in the approved artifact at a 390px-wide canvas: sides keep
// half a card plus breathing room; the bottom reserves space for the
// scaled hero card and its hovering status badge.
const REF_WIDTH = 390
const SIDE_INSET = 54
const TOP_INSET = 48
const BOTTOM_INSET = 85

// Straight sides longer than ~0.8x the radius make top-arc chords
// visibly shorter than side chords (10.6% spread measured on a 660px
// canvas). Cap the ratio and center the ring in the leftover space.
const MAX_STRAIGHT_RATIO = 0.8

export function stadiumLayout(
  count: number,
  width: number,
  height: number,
): StadiumLayoutResult {
  // A collapsed canvas (display:none parent, first happy-dom render)
  // would make radius/perimeter 0 and every modulo NaN — return a safe
  // degenerate layout instead of NaN coordinates.
  if (width <= 0 || height <= 0) {
    const seats = Array.from({ length: Math.max(count, 1) }, () => ({ x: 0, y: 0 }))
    return { seats, rail: { left: 0, top: 0, width: 0, height: 0, radius: 0 }, center: { x: 0, y: 0 } }
  }
  const scale = width / REF_WIDTH
  const side = SIDE_INSET * scale
  const topInset = TOP_INSET * scale
  const bottomInset = BOTTOM_INSET * scale

  const left = side
  const right = width - side
  const radius = (right - left) / 2
  const cx = width / 2
  const maxStraight = Math.max(height - bottomInset - topInset - 2 * radius, 0)
  const straight = Math.min(maxStraight, radius * MAX_STRAIGHT_RATIO)
  // Center the (possibly shorter) ring inside the available vertical band.
  const slack = maxStraight - straight
  const top = topInset + slack / 2
  // Straight-side segment endpoints (circle centers of the two arcs).
  const cyTop = top + radius
  const cyBottom = cyTop + straight
  const perimeter = 2 * Math.PI * radius + 2 * straight
  const halfArc = (Math.PI * radius) / 2

  // Walk the rail in poker deal order — CLOCKWISE as seen on screen
  // (viewer looks DOWN at the table, hero at bottom-center, so the next
  // seat is to the hero's LEFT): bottom-left quarter arc, left side up,
  // top half arc, right side down, bottom-right quarter arc back. The
  // first implementation walked bottom→right (counter-clockwise deal
  // order) — caught in David's review of the live table.
  const point = (tRaw: number): SeatPoint => {
    let t = ((tRaw % perimeter) + perimeter) % perimeter
    if (t < halfArc) {
      const a = t / radius
      return { x: cx - radius * Math.sin(a), y: cyBottom + radius * Math.cos(a) }
    }
    t -= halfArc
    if (t < straight) {
      return { x: left, y: cyBottom - t }
    }
    t -= straight
    if (t < 2 * halfArc) {
      const a = t / radius
      return { x: cx - radius * Math.cos(a), y: cyTop - radius * Math.sin(a) }
    }
    t -= 2 * halfArc
    if (t < straight) {
      return { x: right, y: cyTop + t }
    }
    t -= straight
    const a = t / radius
    return { x: cx + radius * Math.cos(a), y: cyBottom + radius * Math.sin(a) }
  }

  const seats = Array.from({ length: Math.max(count, 1) }, (_, i) =>
    point((i * perimeter) / Math.max(count, 1)),
  )

  return {
    seats,
    rail: {
      left,
      top,
      width: right - left,
      height: cyBottom + radius - top,
      radius,
    },
    center: { x: cx, y: (top + (cyBottom + radius)) / 2 },
  }
}
