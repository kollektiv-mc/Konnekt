import type { models } from '../../../../wailsjs/go/models'
import type { BlockFlowNode } from './graphMapping'

/**
 * One line of the warnings list: the block it is about and what it says. The
 * label is empty for advice about the graph as a whole, and for a node that is
 * no longer on the canvas (the ask is answered a moment after an edit).
 */
export interface WarningRow {
  nodeId: string
  label: string
  text: string
}

/**
 * The backend's warnings, each given the label of the node it names. The label
 * is read off the canvas rather than sent, so a block that was just renamed or
 * removed reads as it is now.
 */
export function warningRows(
  warnings: readonly models.GraphWarning[],
  nodes: readonly BlockFlowNode[],
): WarningRow[] {
  const labels = new Map(nodes.map((n) => [n.id, n.data.label]))
  return warnings.map((w) => ({
    nodeId: labels.has(w.nodeId) ? w.nodeId : '',
    label: labels.get(w.nodeId) ?? '',
    text: w.text,
  }))
}

/** A row as one line of text: the label, then the warning. */
export function warningLine(row: Pick<WarningRow, 'label' | 'text'>): string {
  return row.label ? `${row.label}: ${row.text}` : row.text
}

/** The warnings of each node, by node id, for the blocks to mark themselves from. */
export function warningsByNode(warnings: readonly models.GraphWarning[]): Map<string, string[]> {
  const byNode = new Map<string, string[]>()
  for (const w of warnings) {
    if (!w.nodeId) continue
    byNode.set(w.nodeId, [...(byNode.get(w.nodeId) ?? []), w.text])
  }
  return byNode
}
