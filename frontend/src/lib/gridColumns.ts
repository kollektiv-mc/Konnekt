/**
 * How many columns a grid of equal cells should have, for a given count of
 * cells and the box they share.
 *
 * The compact Commands tile fills itself with its buttons, so the question is
 * not "how many fit" but "what shape should each be". One command should be
 * one cell the size of the tile; two should stack; three should go two by two;
 * a wide tile should spread into more columns than a narrow one. All of that is
 * one rule: pick the column count whose cells come closest to a target aspect
 * ratio, and prefer fewer columns on a tie. Width and height are measured, so
 * the same rule answers a resized tile and a longer list alike.
 */

export interface GridBox {
  width: number
  height: number
}

export interface GridColumnsOptions {
  /** Cells narrower than this are not offered, unless one column is the only choice. */
  minCellWidth: number
  /** Rows shorter than this scroll instead; what a cell's height is clamped to. */
  minCellHeight: number
  /** The gap between cells, on both axes. */
  gap: number
  /** The width-to-height ratio a cell should approach. */
  targetAspect: number
  /** The most columns worth offering. */
  maxColumns: number
}

export const COMMAND_GRID: GridColumnsOptions = {
  minCellWidth: 96,
  minCellHeight: 36,
  gap: 6,
  // A little wider than tall: a label with room beside it, not a square tile.
  targetAspect: 2,
  maxColumns: 6,
}

export function columnsFor(count: number, box: GridBox, options: GridColumnsOptions): number {
  if (count <= 1) return 1
  const { minCellWidth, minCellHeight, gap, targetAspect, maxColumns } = options
  let best = 1
  let bestScore = Infinity
  const most = Math.min(count, maxColumns)
  for (let cols = 1; cols <= most; cols++) {
    const cellWidth = (box.width - gap * (cols - 1)) / cols
    if (cols > 1 && cellWidth < minCellWidth) break
    const rows = Math.ceil(count / cols)
    const cellHeight = Math.max(minCellHeight, (box.height - gap * (rows - 1)) / rows)
    const score = Math.abs(cellWidth / cellHeight - targetAspect)
    // Strictly better only, so a tie keeps the fewer columns.
    if (score < bestScore) {
      best = cols
      bestScore = score
    }
  }
  return best
}
