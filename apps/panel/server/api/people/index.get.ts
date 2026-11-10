import { listPeople } from '../../auth/people'

/** Everyone who can sign in, what they can do, open invites and the roles to choose from. */
export default defineEventHandler(async (event) => {
  const { session } = await requirePermission(event, 'people.manage')
  const list = listPeople(useDb())
  return { ...list, you: session.user.id }
})
