import { describe, expect, it } from 'bun:test'
import { rewriteChat, splitTarget } from '../server/console/chat'
import { nextPost, playerPost, senderName } from '../server/discord/relay'

const json = (command: string) => JSON.parse(command.slice(command.indexOf(' ', 8) + 1))

describe('console chat', () => {
  it('sends /say as a tellraw under [Server] and the sender, not Rcon', () => {
    const r = rewriteChat('say hello all', 'Matt', '#FF8800')!
    expect(r.command.startsWith('tellraw @a ')).toBe(true)
    expect(json(r.command)).toEqual([
      '',
      { text: '[Server] ', color: '#FF8800' },
      { text: 'Matt: ', color: 'gray' },
      { text: 'hello all' },
    ])
    expect(r.shown('')).toEqual(['[Server] Matt: hello all'])
    expect(r.relay).toEqual({ kind: 'chat', player: 'Matt', text: 'hello all', console: true })
  })

  it('shows just the tag for the panel itself', () => {
    const r = rewriteChat('say Restart soon', null)!
    expect(json(r.command)).toEqual([
      '',
      { text: '[Server] ', color: 'gold' },
      { text: 'Restart soon' },
    ])
    expect(r.shown('')).toEqual(['[Server] Restart soon'])
    expect(r.relay?.player).toBe('Server')
  })

  it('keeps the message as plain text: no JSON, formatting codes or commands get through', () => {
    const r = rewriteChat('say "}],{"text":"x","clickEvent":{} §cred', 'Matt')!
    const parts = json(r.command)
    expect(parts[3]).toEqual({ text: '"}],{"text":"x","clickEvent":{} cred' })
    expect(r.command.split('\n')).toHaveLength(1)
  })

  it('sends /me as an emote', () => {
    const r = rewriteChat('me waves', 'Matt')!
    expect(json(r.command)[2]).toEqual({ text: '* Matt waves' })
    expect(r.relay).toMatchObject({ emote: true, player: 'Matt', text: 'waves' })
  })

  it('whispers /msg, /tell and /w to the target only, and keeps it out of Discord', () => {
    for (const verb of ['msg', 'tell', 'w', 'MSG']) {
      const r = rewriteChat(`${verb} Steve see you at spawn`, 'Matt')!
      expect(r.command.startsWith('tellraw Steve ')).toBe(true)
      expect(json(r.command)).toEqual({
        text: '[Server] Matt whispers to you: see you at spawn',
        color: 'gray',
        italic: true,
      })
      expect(r.shown('')).toEqual(['You whisper to Steve: see you at spawn'])
      expect(r.relay).toBeUndefined()
    }
  })

  it('shows the game’s reply when it refused', () => {
    const r = rewriteChat('msg Nobody hi', 'Matt')!
    expect(r.shown('No player was found')).toEqual(['No player was found'])
    expect(rewriteChat('say hi', 'Matt')!.shown('Some error')).toEqual(['Some error'])
  })

  it('reads selectors with spaces as one target', () => {
    expect(splitTarget('@a[distance=..10, name="a b"] hi there')).toEqual({
      target: '@a[distance=..10, name="a b"]',
      message: 'hi there',
    })
    expect(splitTarget('@p hi')).toEqual({ target: '@p', message: 'hi' })
    expect(splitTarget('Steve')).toBeNull()
    expect(splitTarget('@a[limit=1 hi')).toBeNull()
  })

  it('leaves other commands, and chat with nothing to say, as typed', () => {
    for (const c of ['list', 'tellraw @a "x"', 'sayhi', 'say   ', 'msg Steve', 'weather clear'])
      expect(rewriteChat(c, 'Matt')).toBeNull()
  })
})

describe('console chat in the Discord relay', () => {
  const line = { kind: 'chat' as const, player: 'Matt', text: 'hi', console: true }

  it('posts under [Server] and the person’s name, with no head', () => {
    expect(senderName(line)).toBe('[Server] Matt')
    const post = playerPost([{ line, avatar: null }])
    expect(post.username).toBe('[Server] Matt')
    expect(post.avatar_url).toBeUndefined()
  })

  it('doesn’t join console chat with a player who has the same name', () => {
    const player = { kind: 'chat' as const, player: 'Matt', text: 'hello' }
    const { take } = nextPost([
      { line, avatar: null },
      { line: player, avatar: null },
    ])
    expect(take).toBe(1)
  })
})
