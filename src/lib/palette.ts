/**
 * Muted mid-tone pastels. Deliberately a fixed set rather than `<input type="color">`: the
 * home screen is a wall of heat squares, it only looks calm if every colour in it is calm,
 * and a free spectrum picker invites the saturated reds that make such a wall exhausting to
 * look at.
 *
 * Each reads as "filled" against `--color-raised`, the empty square's grey.
 *
 * Every swatch carries a name because that name is its accessible label. A picker that
 * announces "#6ee7b7" to a screen reader has not been labelled at all.
 *
 * Two laps of the hue wheel, and the order is load-bearing: the first eight are spread as far
 * apart as eight calm colours can be, the second lap fills the gaps between them. `nextColor`
 * walks the list, so the first eight activities get the widest spacing available.
 *
 * The gaps the second lap leaves alone are the ones with no room left: a red beside Rose and a
 * yellow beside Sand are the same swatch twice at this lightness, and a swatch nobody can tell
 * apart from its neighbour is not another option.
 */
export const PALETTE = [
  { hex: '#6ee7b7', name: 'Mint' },
  { hex: '#7dd3fc', name: 'Sky' },
  { hex: '#c4b5fd', name: 'Lavender' },
  { hex: '#f0abfc', name: 'Orchid' },
  { hex: '#fda4af', name: 'Rose' },
  { hex: '#fdba74', name: 'Peach' },
  { hex: '#fcd34d', name: 'Sand' },
  { hex: '#bef264', name: 'Sage' },
  { hex: '#86efac', name: 'Fern' },
  { hex: '#5eead4', name: 'Teal' },
  { hex: '#93c5fd', name: 'Cornflower' },
  { hex: '#a5b4fc', name: 'Periwinkle' },
  { hex: '#d8b4fe', name: 'Violet' },
  { hex: '#f9a8d4', name: 'Pink' },
] as const

/**
 * Preset emoji, covering both measures — the first two rows suit things you check off, the
 * last few the kinds of thing you put a timer on. Any emoji at all can still be typed.
 */
export const ICONS = [
  '💪',
  '🏃',
  '🧘',
  '📚',
  '✍️',
  '💧',
  '🥗',
  '😴',
  '🎸',
  '🧹',
  '💰',
  '🚭',
  '💻',
  '🎧',
  '🍳',
  '🚗',
] as const

/** Spreads the palette across activities so the first few never collide. */
export function nextColor(usedCount: number): string {
  return PALETTE[usedCount % PALETTE.length].hex
}
