import { describe, expect, it } from 'bun:test'
import { lookupPlayer, offlineUuid, type Fetch } from '../src/index.ts'

describe('players', () => {
  it('derives offline UUIDs like Minecraft does', () => {
    expect(offlineUuid('Notch')).toBe('b50ad385-829d-3141-a216-7e7d7539ba7f')
  })

  it('looks players up with Mojang', async () => {
    const fetch: Fetch = async (url) =>
      String(url).endsWith('/Notch')
        ? Response.json({ id: '069a79f444e94726a5befca90e38aaf5', name: 'Notch' })
        : new Response(null, { status: 404 })
    expect(await lookupPlayer(fetch, 'Notch')).toEqual({
      uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5',
      name: 'Notch',
    })
    expect(await lookupPlayer(fetch, 'nobody_here')).toBeNull()
    expect(await lookupPlayer(fetch, 'bad name!')).toBeNull()
  })
})
