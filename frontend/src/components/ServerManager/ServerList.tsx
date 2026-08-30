import { loaderLabel } from '../../lib/loaders'
import type { ServerConfig } from '../../types'

/** The sentinel selection for the add-server form. */
export const NEW_SERVER = 'new'

interface Props {
  configs: ServerConfig[]
  /** A config id, or NEW_SERVER. */
  selected: string
  activeId: string
  onSelect: (id: string) => void
}

export function ServerList({ configs, selected, activeId, onSelect }: Props) {
  return (
    <div className="bg-surface border-border-subtle border-r-hairline flex w-48 shrink-0 flex-col p-3">
      <span className="font-title text-text-muted border-border-subtle border-b-hairline px-2 pt-1 pb-3 text-xs font-medium tracking-wider uppercase">
        Servers
      </span>

      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto pt-2">
        {configs.map((cfg) => {
          const isSelected = cfg.id === selected
          return (
            <button
              key={cfg.id}
              onClick={() => onSelect(cfg.id)}
              className={`flex flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition-colors ${
                isSelected
                  ? 'bg-hover text-text-primary'
                  : 'text-text-secondary hover:bg-hover hover:text-text-primary'
              }`}
            >
              <span className="flex w-full items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    cfg.id === activeId ? 'bg-accent' : 'bg-text-faint'
                  }`}
                  title={cfg.id === activeId ? 'Active server' : undefined}
                />
                <span className="truncate text-xs">{cfg.name}</span>
              </span>
              <span className="text-text-faint text-2xs truncate pl-3 font-mono">
                {[loaderLabel(cfg.loader), cfg.mcVersion].filter(Boolean).join(' ') || 'Unknown'}
              </span>
            </button>
          )
        })}
      </div>

      <button
        onClick={() => onSelect(NEW_SERVER)}
        className={`border-border-subtle border-t-hairline mt-2 flex items-center gap-1.5 rounded px-2 py-1.5 text-xs transition-colors ${
          selected === NEW_SERVER
            ? 'text-accent'
            : 'text-text-faint hover:bg-hover hover:text-text-secondary'
        }`}
      >
        <span>+</span>
        <span>Add server</span>
      </button>
    </div>
  )
}
