import { describe, expect, it } from 'vitest'
import { isLocalTarget } from './posting-target'
// The extension's copy of the same rule, run against the same table: the two
// disagreed once, and a table each kept for itself is how that went unseen.
// @ts-expect-error — a plain ES module the worker loads from disk, with no types.
import { isLocalTarget as workerIsLocalTarget } from '../../extension/worker/targets.js'

const copies = [
  ['app', isLocalTarget],
  ['worker', workerIsLocalTarget as (raw: string) => boolean],
] as const

const LOCAL = [
  'http://localhost:3000/',
  'http://localhost./admin',
  'http://dev.localhost/',
  'http://127.0.0.1/',
  'http://127.8.9.10/',
  'http://0.0.0.0/',
  'http://10.1.2.3/',
  'http://172.16.0.1/',
  // The top of 172.16/12, so a widened or narrowed bound shows.
  'http://172.31.255.255/',
  'http://192.168.1.1/admin',
  'http://169.254.169.254/latest/meta-data',
  'http://100.64.0.1/',
  'http://100.127.255.254/',
  'http://[::1]/',
  'http://[::]/',
  'http://[::ffff:7f00:1]/',
  'http://[::ffff:10.0.0.1]/',
  'http://[fd00::1]/',
  'http://[fc12:3456::1]/',
  'http://[fe80::1]/',
  'http://[febf::1]/',
  'http://nas.local/',
  'http://nas.local./',
  'http://router.lan/',
  'http://nas.home.arpa/',
  'http://metadata.google.internal/',
  'http://intranet/',
  'http://0x7f.1/',
  'http://017700000001/',
  // Public names that resolve to this machine or the LAN (round 3).
  'http://localtest.me:47811/secret',
  'http://app.localtest.me/',
  'http://lvh.me/',
  'http://127.0.0.1.nip.io/',
  'http://192.168.1.1.nip.io/status',
  'http://0a000001.nip.io/',
  'http://10-0-0-1.sslip.io/',
  'http://magic-127-0-0-1.sslip.io/',
  'http://app.10.0.0.1.example.dev/',
  'http://ip-192-168-1-1.example.dev/',
  'file:///etc/passwd',
  'ftp://example.com/',
  'not a url',
]

const PUBLIC = [
  'https://cra.org/ads/4411',
  'https://www.higheredjobs.com/faculty/details.cfm?JobCode=1',
  'https://www.linkedin.com/jobs/view/4012/',
  'https://100.128.0.1/',
  'https://100.63.255.255/',
  'https://172.15.0.1/',
  // Just past the top of 172.16/12.
  'https://172.32.0.1/',
  'https://192.169.0.1/',
  'https://8.8.8.8/',
  'https://8.8.8.8.example.dev/',
  'https://ec2-54-1-2-3.compute-1.amazonaws.com/',
  'https://jobs.2024-10-1.example.edu/',
  'https://[2001:db8::1]/',
  // `fc::1` is 00fc::1, not unique-local.
  'http://[fc::1]/',
  'https://internal.example.com/jobs/1',
]

describe('isLocalTarget, both copies', () => {
  for (const [name, local] of copies) {
    it.each(LOCAL)(`${name} refuses %s`, (url) => {
      expect(local(url)).toBe(true)
    })
    it.each(PUBLIC)(`${name} allows %s`, (url) => {
      expect(local(url)).toBe(false)
    })
  }
})
