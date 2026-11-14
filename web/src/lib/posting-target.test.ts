import { describe, expect, it } from 'vitest'
import { isLocalTarget } from './posting-target'

describe('isLocalTarget', () => {
  it.each([
    'http://localhost:3000/',
    'http://localhost./admin',
    'http://dev.localhost/',
    'http://127.0.0.1/',
    'http://0.0.0.0/',
    'http://10.1.2.3/',
    'http://172.16.0.1/',
    'http://192.168.1.1/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/',
    'http://[::1]/',
    'http://[::ffff:7f00:1]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://nas.local/',
    'http://router.lan/',
    'http://intranet/',
    'file:///etc/passwd',
    'not a url',
  ])('refuses %s', (url) => {
    expect(isLocalTarget(url)).toBe(true)
  })

  it.each([
    'https://cra.org/ads/4411',
    'https://www.higheredjobs.com/faculty/details.cfm?JobCode=1',
    'https://100.128.0.1/',
    'https://172.32.0.1/',
    'https://8.8.8.8/',
  ])('allows %s', (url) => {
    expect(isLocalTarget(url)).toBe(false)
  })
})
