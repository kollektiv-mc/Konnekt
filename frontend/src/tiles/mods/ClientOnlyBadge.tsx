// Marks content that does not load on a dedicated server. Modrinth says so per
// version, and Fabric and Quilt jars say so themselves; a server that loads one
// anyway at best ignores it and at worst refuses to start.
export function ClientOnlyBadge() {
  return (
    <span
      title="Client only: this does not load on a dedicated server"
      className="text-warning text-2xs shrink-0 rounded bg-white/[0.06] px-1 text-xs"
    >
      client only
    </span>
  )
}
