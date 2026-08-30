import { models } from '../../../wailsjs/go/models'
import type { InstalledMod } from './useMods'

/**
 * Build a minimal ModProject shell from an InstalledMod so useMods.selectProject
 * can show the mod in the detail panel / content browser.
 *
 * Its own module because both faces of the tile need it and they now live in
 * separate files.
 */
export function modToProject(mod: InstalledMod) {
  return models.ModProject.createFrom({
    id: mod.projectId,
    slug: mod.projectId,
    title: mod.displayName,
    description: '',
    body: '',
    iconUrl: mod.iconUrl || '',
    author: '',
    projectType: mod.targetFolder === 'plugins' ? 'plugin' : 'mod',
    downloads: 0,
    follows: 0,
    dateModified: '',
    categories: [],
    gallery: [],
  })
}
