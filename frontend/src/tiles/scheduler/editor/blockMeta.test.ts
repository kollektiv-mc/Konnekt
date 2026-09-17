import { describe, it, expect } from 'vitest'
import type { models } from '../../../../wailsjs/go/models'
import { configHint } from './blockMeta'

// ─── What a node says it will do (#161) ─────────────────────────────────────
//
// The hint is the only place a graph tells you what a node runs without opening
// it, so it has to name the value that runs. The command field's presets are
// sentinels, and the attribute field's are a decorated spelling of their own
// values, and those two want opposite treatment.

const def = (fields: unknown[]) => ({ configSchema: fields }) as unknown as models.BlockDef

const commandField = {
  key: 'command',
  label: 'Command',
  type: 'command',
  required: true,
  options: [
    { label: 'Start Server', value: '__start__' },
    { label: 'Save All', value: 'save-all' },
  ],
}

const attributeField = {
  key: 'attribute',
  label: 'Attribute',
  type: 'attribute',
  required: true,
  options: [{ label: '@server.motd', value: 'server.motd' }],
}

describe('configHint', () => {
  it('names a lifecycle sentinel rather than showing it', () => {
    expect(configHint(def([commandField]), { command: '__start__' })).toBe('Start Server')
  })

  it('shows a typed command as typed', () => {
    expect(configHint(def([commandField]), { command: 'say hello' })).toBe('say hello')
  })

  it('names a preset that is a real command, since that is what the panel shows', () => {
    expect(configHint(def([commandField]), { command: 'save-all' })).toBe('Save All')
  })

  it('leaves an attribute bare, rather than putting the @ form on the node', () => {
    // The field holds `server.motd`; labelling it `@server.motd` here would be
    // the node and the field disagreeing, which is #162.
    expect(configHint(def([attributeField]), { attribute: 'server.motd' })).toBe('server.motd')
  })

  it('skips fields that are not required', () => {
    const optional = { key: 'note', label: 'Note', type: 'string' }
    expect(configHint(def([optional]), { note: 'ignored' })).toBeUndefined()
  })

  it('skips an empty value and takes the next required field', () => {
    const second = { key: 'url', label: 'URL', type: 'string', required: true }
    expect(configHint(def([commandField, second]), { command: '', url: 'https://x' })).toBe(
      'https://x',
    )
  })

  it('is undefined when there is nothing to show', () => {
    expect(configHint(def([commandField]), {})).toBeUndefined()
    expect(configHint(undefined, { command: 'say hello' })).toBeUndefined()
  })

  it('never shows the collapsed flag', () => {
    const collapsed = { key: '_collapsed', label: '', type: 'bool', required: true }
    expect(configHint(def([collapsed]), { _collapsed: true })).toBeUndefined()
  })
})
