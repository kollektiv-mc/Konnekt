import { useEffect, useMemo } from 'react'
import { Combobox } from '../../../components/ui/Combobox'
import { useDestinationsStore } from '../../../stores/useDestinationsStore'

interface Props {
  /** The destination's name, which is what the graph stores. */
  value: string
  ariaLabel: string
  onChange: (name: string) => void
}

/**
 * The control for a `destination` config field: a select over the saved buckets.
 *
 * The list is read from the backend when the field mounts, not carried in the
 * block definition, because destinations are added and deleted in Settings while
 * the block definition does not change. The graph stores the name and never a
 * credential, so a name that is no longer in the list (deleted, renamed, or from
 * a graph imported from another install) is kept and shown as missing rather than
 * quietly replaced: the run would refuse it, and the author should see why.
 */
export function DestinationField({ value, ariaLabel, onChange }: Props) {
  const destinations = useDestinationsStore((s) => s.destinations)
  const loaded = useDestinationsStore((s) => s.loaded)
  const refresh = useDestinationsStore((s) => s.refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The backend matches a name ignoring case, so the control does too.
  const known = destinations.some((d) => d.name.toLowerCase() === value.trim().toLowerCase())
  const missing = loaded && value.trim() !== '' && !known

  const options = useMemo(() => {
    const opts = destinations.map((d) => ({ value: d.name, label: d.name }))
    return missing ? [{ value, label: `${value} (not found)` }, ...opts] : opts
  }, [destinations, missing, value])

  return (
    <>
      <Combobox
        value={value}
        onChange={onChange}
        options={options}
        ariaLabel={ariaLabel}
        placeholder="Choose a destination"
      />
      {missing && (
        <span role="alert" className="text-danger text-3xs">
          This destination does not exist any more. Pick another, or add it again in Settings.
        </span>
      )}
      {loaded && destinations.length === 0 && (
        <span className="text-text-faint text-3xs">
          No destinations yet. Add a bucket under Settings, then choose it here.
        </span>
      )}
    </>
  )
}
