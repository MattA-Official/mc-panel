import { ChannelInput } from '../../../notify'

/** Adds a channel. It sends data off the machine, so it needs a fresh passkey check. */
export default defineEventHandler(async (event) => {
  const { user } = await requireElevated(event)
  const body = await readValidatedBody(event, ChannelInput.parse)
  const added = await notifyHttp(() => useNotify().add(body))
  audit(user.id, 'notify.channel.add', null, {
    name: added.name,
    kind: added.kind,
    target: added.target,
    events: added.events,
  })
  syncPlayerWatcher()
  return added
})
