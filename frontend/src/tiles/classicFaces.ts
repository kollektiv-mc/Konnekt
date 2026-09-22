/**
 * The classic compact faces, behind one lazy chunk.
 *
 * Settings › Appearance › "Classic tile faces" swaps each figure-first face for
 * the face its tile had before. Most installs never turn it on, so the six
 * faces load only when one is first asked for, which is what keeps them off
 * the entry chunk (`pnpm check-bundle`). One barrel rather than a `lazy()` per
 * tile because each tile root would otherwise be a chunk of its own, and the
 * warm list in `lib/prefetch.ts` names chunks, not tiles: this file is the one
 * specifier it warms, spelled the same in every root that imports it.
 *
 * A barrel over six tile folders is the shape `registry.ts` already has, and
 * for the same reason: it names what each tile exports, and no tile reaches
 * through it into another.
 */
export { ClassicVitals } from './overview/ClassicVitals'
export { ClassicPlayerGrid } from './players/ClassicPlayerGrid'
export { ClassicPerformanceSummary } from './performance/ClassicPerformanceSummary'
export { ClassicSchedulerSummary } from './scheduler/ClassicSchedulerSummary'
export { ClassicWorldsSummary } from './worlds/ClassicWorldsSummary'
export { ClassicBackupsSummary } from './backups/ClassicBackupsSummary'
