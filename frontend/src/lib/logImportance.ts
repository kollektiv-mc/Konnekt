import type { LogLine } from '../stores/useConsoleStore'

/**
 * Which console lines are worth a glance, for the console tile's expanded
 * layout, which shows those and folds the rest.
 *
 * Every line the store already tints is notable: warnings, errors, the
 * successes it recognises (a player joining, the server done booting) and
 * Konnekt's own narration (a backup finishing, a restart). Of the plain
 * `dim` lines, a few more are: a player leaving, a stop or start beginning,
 * an advancement, and chat, which a server admin reads for. Everything else,
 * the loading, preparing and saving chatter that is most of a log, is quiet.
 */
const NOTABLE_DIM =
  /left the game|Stopping (the )?server|Starting minecraft server|made the advancement|\]: <[^>]+> /i

export function isNotable(line: LogLine): boolean {
  if (line.level !== 'dim') return true
  return NOTABLE_DIM.test(line.text)
}

/** A run of quiet lines, shown as one row that opens in place. */
export interface QuietFold {
  fold: true
  /** The first folded line's id, stable for the fold's whole life. */
  id: number
  lines: LogLine[]
}

export type FoldedLine = LogLine | QuietFold

export function isFold(entry: FoldedLine): entry is QuietFold {
  return 'fold' in entry
}

/**
 * The lines with every run of quiet ones collapsed into a `QuietFold`. A
 * single quiet line between two notable ones still folds: the point is that
 * the eye lands only on what matters, and one line of chatter is still
 * chatter.
 */
export function foldQuiet(lines: readonly LogLine[]): FoldedLine[] {
  const out: FoldedLine[] = []
  let run: LogLine[] = []
  const flush = () => {
    if (run.length > 0) {
      out.push({ fold: true, id: run[0].id, lines: run })
      run = []
    }
  }
  for (const line of lines) {
    if (isNotable(line)) {
      flush()
      out.push(line)
    } else {
      run.push(line)
    }
  }
  flush()
  return out
}
