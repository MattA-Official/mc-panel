import { defaultMessages } from '../../routing/table'

/** One address for every server: the switch, its port and messages, and live counts. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.network')
  const routing = useRouting()
  return {
    settings: routing.settings(),
    defaults: defaultMessages(useBranding().settings().name),
    status: await routing.status(),
  }
})
