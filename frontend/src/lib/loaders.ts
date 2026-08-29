/**
 * Display names for the loader strings `backend/models/server.go` stores.
 *
 * One map rather than one per component: `ServerTooltip` and
 * `ServerInstallModal` each carried their own, and the install modal's was a
 * two-entry subset that fell back to "Forge/NeoForge" — so the same server
 * could be labelled differently in two places on screen.
 *
 * Keys match `ServerConfig.loader` exactly. Callers handle the miss, since an
 * undetected loader is an empty string rather than a value needing a label.
 */
export const LOADER_LABELS: Record<string, string> = {
  neoforge: 'NeoForge',
  forge: 'Forge',
  fabric: 'Fabric',
  quilt: 'Quilt',
  paper: 'Paper',
  spigot: 'Spigot',
  bukkit: 'Bukkit',
  purpur: 'Purpur',
  velocity: 'Velocity',
  vanilla: 'Vanilla',
}

/** Label for a loader, falling back to the raw value and then to "Unknown". */
export function loaderLabel(loader: string): string {
  return LOADER_LABELS[loader] ?? (loader || 'Unknown')
}
