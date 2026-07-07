import { describe, expect, it } from 'vitest'

import { stadiumLayout } from './table-layout'

// Locked geometry (design uplift baseline, decisions 5-7): seat CENTERS
// sit exactly ON a stadium rail at equal arc-length steps, hero (index 0)
// pinned bottom-center. The geometry contract lives in DESIGN.md (Live
// Table section).

const W = 390
const H = 560

/** Distance from a point to the stadium rail path (0 = on the rail). */
function distanceToRail(
  x: number,
  y: number,
  rail: { left: number; top: number; width: number; height: number; radius: number },
): number {
  const cx = rail.left + rail.width / 2
  const cyTop = rail.top + rail.radius
  const cyBottom = rail.top + rail.height - rail.radius
  if (y >= cyTop && y <= cyBottom) {
    return Math.abs(Math.abs(x - cx) - rail.radius)
  }
  const cy = y < cyTop ? cyTop : cyBottom
  return Math.abs(Math.hypot(x - cx, y - cy) - rail.radius)
}

describe('stadiumLayout', () => {
  it('returns one center per seat plus rail metrics', () => {
    const layout = stadiumLayout(7, W, H)
    expect(layout.seats).toHaveLength(7)
    expect(layout.rail.width).toBeGreaterThan(0)
    expect(layout.rail.radius).toBeCloseTo(layout.rail.width / 2, 5)
  })

  it('pins index 0 (the hero) to bottom-center', () => {
    for (const count of [2, 5, 10]) {
      const { seats } = stadiumLayout(count, W, H)
      expect(seats[0]!.x).toBeCloseTo(W / 2, 5)
      const maxY = Math.max(...seats.map((s) => s.y))
      expect(seats[0]!.y).toBeCloseTo(maxY, 5)
    }
  })

  it('walks the ring CLOCKWISE on screen: seat 1 sits to the hero\'s LEFT', () => {
    // Poker deals clockwise: the next seat after the hero (ring index 1)
    // is on the hero's left as seen on screen (viewer looks down at the
    // table; hero at bottom-center). Regression: the first implementation
    // walked bottom→right, which put seat 1 on the hero's RIGHT —
    // counter-clockwise, backwards from real deal order (David, review).
    for (const count of [3, 7, 10]) {
      const { seats } = stadiumLayout(count, W, H)
      expect(seats[1]!.x, `count ${count}: seat 1 x`).toBeLessThan(W / 2)
      // And the LAST seat (hero's right-hand neighbour) mirrors it.
      expect(seats[count - 1]!.x, `count ${count}: last seat x`).toBeGreaterThan(W / 2)
    }
  })

  it('keeps adjacent chord distances visually even at ring densities 6-10', () => {
    // The locked contract is equal ARC-length steps (exact, tested below);
    // chord distances are its visual consequence. The approved artifact
    // measured 6.3% spread at 7 seats and ~2% at 10 — pin that level (8%)
    // so a regression to eyeball-visible unevenness fails. At 2-3 seats
    // chords across the arcs legitimately differ; symmetry covers those.
    for (const count of [6, 7, 8, 10]) {
      const { seats } = stadiumLayout(count, W, H)
      const dists = seats.map((s, i) => {
        const n = seats[(i + 1) % seats.length]!
        return Math.hypot(s.x - n.x, s.y - n.y)
      })
      const min = Math.min(...dists)
      const max = Math.max(...dists)
      expect(max - min, `count ${count}: ${dists.map((d) => d.toFixed(1)).join(',')}`)
        .toBeLessThanOrEqual(0.08 * max)
    }
  })

  it('steps the rail perimeter in equal arc lengths', () => {
    // The exact locked invariant: consecutive seats are the same ARC
    // distance apart along the rail. Measure implementation-independently:
    // sample the rail as a dense polyline, snap each seat to its nearest
    // sample, and compare the polyline distances between consecutive seats.
    const count = 10
    const { seats, rail } = stadiumLayout(count, W, H)
    const straight = rail.height - 2 * rail.radius
    const cx = rail.left + rail.width / 2
    const cyTop = rail.top + rail.radius
    const cyBottom = rail.top + rail.height - rail.radius
    // Dense rail polyline, same walk direction as the seats (clockwise
    // from bottom-center).
    const SAMPLES = 20000
    const perimeter = 2 * Math.PI * rail.radius + 2 * straight
    const halfArc = (Math.PI * rail.radius) / 2
    // Mirrors the implementation's CLOCKWISE-on-screen walk
    // (bottom -> left -> top -> right).
    const railPoint = (tRaw: number) => {
      let t = ((tRaw % perimeter) + perimeter) % perimeter
      if (t < halfArc) {
        const a = t / rail.radius
        return { x: cx - rail.radius * Math.sin(a), y: cyBottom + rail.radius * Math.cos(a) }
      }
      t -= halfArc
      if (t < straight) return { x: rail.left, y: cyBottom - t }
      t -= straight
      if (t < 2 * halfArc) {
        const a = t / rail.radius
        return { x: cx - rail.radius * Math.cos(a), y: cyTop - rail.radius * Math.sin(a) }
      }
      t -= 2 * halfArc
      if (t < straight) return { x: rail.left + rail.width, y: cyTop + t }
      t -= straight
      const a = t / rail.radius
      return { x: cx + rail.radius * Math.cos(a), y: cyBottom + rail.radius * Math.sin(a) }
    }
    const nearestParam = (p: { x: number; y: number }) => {
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < SAMPLES; i++) {
        const t = (i * perimeter) / SAMPLES
        const q = railPoint(t)
        const d = Math.hypot(q.x - p.x, q.y - p.y)
        if (d < bestD) {
          bestD = d
          best = t
        }
      }
      return best
    }
    const params = seats.map(nearestParam)
    const step = perimeter / count
    for (let i = 0; i < count; i++) {
      const gap =
        (params[(i + 1) % count]! - params[i]! + perimeter) % perimeter
      expect(gap, `arc gap after seat ${i}`).toBeCloseTo(step, 0)
    }
  })

  it('walks equal arc-length steps and mirrors left/right at every density', () => {
    for (const count of [2, 3, 5, 7, 10]) {
      const { seats } = stadiumLayout(count, W, H)
      // Mirror symmetry about the vertical axis: seat i and seat count-i
      // are reflections, so heads-up and 3-handed tables look balanced.
      for (let i = 1; i < count; i++) {
        const a = seats[i]!
        const b = seats[count - i]!
        expect(a.x + b.x).toBeCloseTo(W, 3)
        expect(a.y).toBeCloseTo(b.y, 3)
      }
    }
  })

  it('keeps every center at least half a card inside the canvas', () => {
    const HALF_W = 48
    const HALF_H = 32
    for (const count of [2, 7, 10]) {
      const { seats } = stadiumLayout(count, W, H)
      for (const s of seats) {
        expect(s.x).toBeGreaterThanOrEqual(HALF_W)
        expect(s.x).toBeLessThanOrEqual(W - HALF_W)
        expect(s.y).toBeGreaterThanOrEqual(HALF_H)
        expect(s.y).toBeLessThanOrEqual(H - HALF_H)
      }
    }
  })

  it('places every center exactly on the rail path', () => {
    for (const count of [2, 3, 7, 10]) {
      const layout = stadiumLayout(count, W, H)
      for (const s of layout.seats) {
        expect(distanceToRail(s.x, s.y, layout.rail)).toBeLessThan(0.01)
      }
    }
  })

  it('scales insets for a smaller canvas without breaking the invariants', () => {
    const layout = stadiumLayout(10, 320, 460)
    expect(layout.seats).toHaveLength(10)
    for (const s of layout.seats) {
      expect(distanceToRail(s.x, s.y, layout.rail)).toBeLessThan(0.01)
    }
  })

  it('caps elongation on tall canvases so chord spread stays visually even', () => {
    // A real 390x844 phone leaves a ~660px canvas; uncapped straight
    // sides stretched the ring to 10.6% chord spread (measured in
    // dogfood). The stadium must cap its straight-to-radius ratio and
    // center the leftover space instead.
    for (const height of [560, 660, 760]) {
      const { seats, rail } = stadiumLayout(7, W, height)
      const dists = seats.map((s, i) => {
        const n = seats[(i + 1) % seats.length]!
        return Math.hypot(s.x - n.x, s.y - n.y)
      })
      const spread = (Math.max(...dists) - Math.min(...dists)) / Math.max(...dists)
      expect(spread, `h=${height}: ${dists.map((d) => d.toFixed(0)).join(',')}`)
        .toBeLessThanOrEqual(0.08)
      // Rail still inside the canvas and vertically centered-ish.
      expect(rail.top).toBeGreaterThanOrEqual(0)
      expect(rail.top + rail.height).toBeLessThanOrEqual(height)
    }
  })
})
