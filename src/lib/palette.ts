/**
 * Muted mid-tone pastels. Deliberately a fixed set rather than `<input type="color">`:
 * the grid only looks calm if every colour in it is calm, and a free spectrum picker
 * invites the saturated reds that make a wall of squares exhausting to look at.
 *
 * Each reads as "filled" against both the light and the dark empty-square grey.
 */
export const PALETTE = [
  '#6ee7b7', // mint
  '#7dd3fc', // sky
  '#c4b5fd', // lavender
  '#f0abfc', // orchid
  '#fda4af', // rose
  '#fdba74', // peach
  '#fcd34d', // sand
  '#bef264', // sage
] as const

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
] as const

/** Spreads the palette across habits so the first few never collide. */
export function nextColor(usedCount: number): string {
  return PALETTE[usedCount % PALETTE.length]
}
