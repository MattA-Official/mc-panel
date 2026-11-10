import { checkRecords, expectedRecords, machineAddresses, publicLookup } from '../../../dns'

/** The DNS records this server's hostname needs, and whether public DNS has them. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.view')
  const server = findServer(getRouterParam(event, 'name') ?? '')
  if (!server.hostname) return { hostname: null, records: [] }
  const config = useRuntimeConfig()
  const machine = machineAddresses({ ipv4: config.machineIpv4, ipv6: config.machineIpv6 })
  const expected = expectedRecords(server.hostname, server.port, machine)
  try {
    return { hostname: server.hostname, records: await checkRecords(expected, publicLookup()) }
  } catch {
    // DNS itself unreachable: still show what to create.
    return {
      hostname: server.hostname,
      records: expected.map((e) => ({ ...e, status: 'unknown' as const, found: [] })),
    }
  }
})
