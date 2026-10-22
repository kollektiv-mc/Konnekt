import { NO_GRAPH_KEYS } from './blockMeta'
import type { WarningRow } from './graphWarnings'

interface Props {
  rows: readonly WarningRow[]
  /** A row that names a block was picked: select it and bring it into view. */
  onPick: (nodeId: string) => void
}

const ROW = 'flex w-full flex-col gap-0.5 px-3 py-1.5 text-left font-mono'

/**
 * The warnings list the toolbar's count opens, one row per warning. A warning
 * about a block leads with its label and is a button that goes to the block; one
 * about the graph as a whole has no label and nothing to go to, so it is plain
 * text. The text wraps, unlike a menu row's label: a warning is a sentence, and a
 * cut sentence cannot be read.
 */
export function WarningsMenu({ rows, onPick }: Props) {
  return (
    <div className="w-80">
      {rows.map((row, i) =>
        row.nodeId ? (
          <button
            key={i}
            type="button"
            onClick={() => onPick(row.nodeId)}
            className={`${ROW} hover:bg-hover bg-transparent transition-colors ${NO_GRAPH_KEYS}`}
          >
            <span className="text-text-primary text-xs font-semibold">{row.label}</span>
            <span className="text-text-muted text-2xs">{row.text}</span>
          </button>
        ) : (
          <div key={i} className={ROW}>
            {row.label && (
              <span className="text-text-primary text-xs font-semibold">{row.label}</span>
            )}
            <span className="text-text-muted text-2xs">{row.text}</span>
          </div>
        ),
      )}
    </div>
  )
}
