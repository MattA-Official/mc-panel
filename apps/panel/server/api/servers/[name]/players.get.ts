import { z } from 'zod'
import { parseList, type OnlinePlayers } from '../../../players'

const Params = z.object({ name: z.string().max(40) })

export default defineEventHandler(async (event) => {
  const { name } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  const statuses = await useStatus().current()
  let online: OnlinePlayers | null = null
  if (statuses[name] === 'active') {
    online = await useConsole()
      .command(name, 'list', { echo: false })
      .then(parseList)
      .catch(() => null)
  }
  const [whitelist, ops, banned] = await Promise.all([
    readList(name, 'whitelist.json'),
    readList(name, 'ops.json'),
    readList(name, 'banned-players.json'),
  ])
  const props = await readProperties(name)
  return {
    running: statuses[name] === 'active',
    online,
    whitelistEnabled: props['white-list'] === 'true',
    onlineMode: props['online-mode'] !== 'false',
    whitelist: whitelist.map(({ uuid, name }) => ({ uuid, name })),
    ops: ops.map(({ uuid, name, level }) => ({ uuid, name, level })),
    banned: banned.map(({ uuid, name, reason, created }) => ({ uuid, name, reason, created })),
  }
})
