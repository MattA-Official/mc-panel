import { describe, expect, it } from 'bun:test'
import { checkRecords, expectedRecords, machineAddresses, type Lookup } from '../server/dns'

const iface = (address: string, family: 'IPv4' | 'IPv6', internal = false) =>
  ({ address, family, internal, netmask: '', mac: '', cidr: null }) as never

describe('dns records', () => {
  it('picks public addresses from the interfaces', () => {
    const m = machineAddresses(
      {},
      {
        lo: [iface('127.0.0.1', 'IPv4', true)],
        eth0: [iface('10.0.0.2', 'IPv4'), iface('203.0.113.7', 'IPv4'), iface('fe80::1', 'IPv6')],
        eth1: [iface('2a01:4f8::1', 'IPv6')],
      },
    )
    expect(m).toEqual({ ipv4: '203.0.113.7', ipv6: '2a01:4f8::1' })
    expect(machineAddresses({ ipv4: '198.51.100.1' }, {}).ipv4).toBe('198.51.100.1')
  })

  it('needs SRV only off the default port', () => {
    const machine = { ipv4: '203.0.113.7', ipv6: null }
    expect(expectedRecords('mc.example.com', 25565, machine)).toEqual([
      { type: 'A', name: 'mc.example.com', value: '203.0.113.7' },
    ])
    expect(expectedRecords('c.example.com', 25566, machine)[1]).toEqual({
      type: 'SRV',
      name: '_minecraft._tcp.c.example.com',
      value: '0 5 25566 c.example.com',
    })
  })

  it('reports right, missing, wrong and proxied records', async () => {
    const lookup: Lookup = {
      a: async (n) =>
        n === 'ok.example.com' ? ['203.0.113.7'] : n === 'cf.example.com' ? ['104.21.3.4'] : [],
      aaaa: async () => [],
      srv: async (n) =>
        n === '_minecraft._tcp.ok.example.com'
          ? [{ priority: 0, weight: 5, port: 25570, name: 'other.example.com.' }]
          : [],
    }
    const machine = { ipv4: '203.0.113.7', ipv6: null }
    const ok = await checkRecords(expectedRecords('ok.example.com', 25566, machine), lookup)
    expect(ok.map((r) => r.status)).toEqual(['ok', 'wrong'])
    expect(ok[1]!.found).toEqual(['0 5 25570 other.example.com'])
    const cf = await checkRecords(expectedRecords('cf.example.com', 25565, machine), lookup)
    expect(cf[0]).toMatchObject({ status: 'wrong', hint: expect.stringContaining('grey cloud') })
    const none = await checkRecords(expectedRecords('no.example.com', 25565, machine), lookup)
    expect(none[0]!.status).toBe('missing')
  })
})
