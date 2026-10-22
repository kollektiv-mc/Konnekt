import { describe, expect, it } from 'vitest'
import { bugReportUrl } from './bugReport'

describe('bugReportUrl', () => {
  it('fills in the version', () => {
    expect(bugReportUrl('v0.3.0')).toMatch(/template=bug_report\.yml&app-version=v0\.3\.0$/)
  })

  it('leaves the version out when it is unknown', () => {
    expect(bugReportUrl(null)).not.toContain('app-version')
  })
})
