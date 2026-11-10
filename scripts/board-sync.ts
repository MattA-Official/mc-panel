/**
 * Keeps the Status column of the Flytower Projects board in step with the repository.
 *
 *   PROJECTS_TOKEN=... bun scripts/board-sync.ts [--number 4] [--dry-run]
 *
 * Every open issue and pull request, and everything in the current milestone, is put on the
 * board. Each item then gets a Status:
 *
 *   closed issue, merged or closed pull request   -> Done
 *   open pull request                             -> In review
 *   open issue in the current milestone           -> Todo
 *   any other open issue                          -> Backlog
 *
 * Open items already marked In progress or In review are left alone, so moving a card by
 * hand sticks. The current milestone is the open one with the lowest version number.
 *
 * Dates, for the Roadmap layout (in the UK calendar):
 *
 *   Start date    the day the issue or pull request was opened, unless set by hand
 *   Target date   the day it was closed or merged; while open, its milestone's due date,
 *                 unless set by hand
 *
 * The Start date and Target date fields are created if the board doesn't have them.
 *
 * PROJECTS_TOKEN must be a classic token with the `repo` and `project` scopes: the workflow
 * token can't reach a Projects board owned by a user account.
 */
import { parseArgs } from 'node:util'

export type Status = 'Backlog' | 'Todo' | 'In progress' | 'In review' | 'Done'

export interface Item {
  kind: 'Issue' | 'PullRequest'
  number: number
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  milestone: string | null
  status: string | null
  createdAt?: string
  closedAt?: string | null
  milestoneDue?: string | null
  start?: string | null
  target?: string | null
}

/** A timestamp as a calendar date in the UK, e.g. "2026-11-10". */
export function ukDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
}

/** The Start date and Target date an item should have; a field left out stays as it is. */
export function desiredDates(item: Item): { start?: string; target?: string } {
  const out: { start?: string; target?: string } = {}
  if (item.createdAt && !item.start) out.start = ukDate(item.createdAt)
  if (item.state !== 'OPEN' && item.closedAt) {
    const closed = ukDate(item.closedAt)
    if (item.target !== closed) out.target = closed
  } else if (item.state === 'OPEN' && !item.target && item.milestoneDue) {
    out.target = ukDate(item.milestoneDue)
  }
  return out
}

/** The Status an item should have, or null to leave it as it is. */
export function desiredStatus(item: Item, currentMilestone: string | null): Status | null {
  if (item.state !== 'OPEN') return item.status === 'Done' ? null : 'Done'
  if (item.status === 'In progress' || item.status === 'In review') return null
  let want: Status
  if (item.kind === 'PullRequest') want = 'In review'
  else if (currentMilestone !== null && item.milestone === currentMilestone) want = 'Todo'
  else want = 'Backlog'
  return item.status === want ? null : want
}

/** The open milestone with the lowest version, e.g. "1.1.0 Alerts" before "1.2.0 People". */
export function pickCurrentMilestone(titles: string[]): string | null {
  const versioned = titles
    .map((title) => ({ title, version: /^(\d+)\.(\d+)\.(\d+)/.exec(title) }))
    .filter((m): m is { title: string; version: RegExpExecArray } => m.version !== null)
    .sort((a, b) => {
      for (let i = 1; i <= 3; i++) {
        const d = Number(a.version[i]) - Number(b.version[i])
        if (d !== 0) return d
      }
      return 0
    })
  return versioned[0]?.title ?? null
}

const OWNER = 'MattA-Official'
const REPO = 'mc-panel'

async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { authorization: `bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })
    // GitHub answers big or busy requests with a 502 now and then; try again a few times.
    if (res.status >= 500 && attempt < 4) {
      await Bun.sleep(2000 * attempt)
      continue
    }
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] }
    if (!res.ok || body.errors?.length) {
      throw new Error(
        `GitHub GraphQL ${res.status}: ${body.errors?.map((e) => e.message).join('; ') ?? ''}`,
      )
    }
    return body.data as T
  }
}

interface ContentNode {
  __typename: 'Issue' | 'PullRequest'
  id: string
  number: number
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  milestone: { title: string; dueOn: string | null } | null
  repository: { nameWithOwner: string }
  createdAt: string
  closedAt: string | null
}

function toItem(c: ContentNode, status: string | null = null): Item {
  return {
    kind: c.__typename,
    number: c.number,
    state: c.state,
    milestone: c.milestone?.title ?? null,
    status,
    createdAt: c.createdAt,
    closedAt: c.closedAt,
    milestoneDue: c.milestone?.dueOn ?? null,
  }
}

// Fields of an issue or pull request, for a connection that only holds one of the two.
const FIELDS =
  '__typename id number state createdAt closedAt milestone { title dueOn } repository { nameWithOwner }'

// The same fields for a board item, whose content could be either (or a draft).
const CONTENT = `
  __typename
  ... on Issue { ${FIELDS.replace('__typename ', '')} }
  ... on PullRequest { ${FIELDS.replace('__typename ', '')} }
`

async function main() {
  const { values } = parseArgs({
    options: {
      number: { type: 'string', default: '4' },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const token = process.env.PROJECTS_TOKEN
  if (!token) throw new Error('PROJECTS_TOKEN is not set')
  const dryRun = values['dry-run']

  // The board, its Status field and the items already on it.
  type BoardPage = {
    user: {
      projectV2: {
        id: string
        field: { id: string; options: { id: string; name: string }[] } | null
        startField: { id: string } | null
        targetField: { id: string } | null
        items: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          nodes: {
            id: string
            status: { name: string } | null
            start: { date: string } | null
            target: { date: string } | null
            content: ContentNode | null
          }[]
        }
      }
    }
  }
  let projectId: string | undefined
  let field: { id: string; options: { id: string; name: string }[] } | null | undefined
  let startFieldId: string | undefined
  let targetFieldId: string | undefined
  const onBoard = new Map<string, { itemId: string; item: Item }>()
  for (let after: string | null = null; ;) {
    const page: BoardPage = await graphql<BoardPage>(
      token,
      `query($owner: String!, $number: Int!, $after: String) {
        user(login: $owner) {
          projectV2(number: $number) {
            id
            field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
            startField: field(name: "Start date") { ... on ProjectV2Field { id } }
            targetField: field(name: "Target date") { ... on ProjectV2Field { id } }
            items(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
                start: fieldValueByName(name: "Start date") { ... on ProjectV2ItemFieldDateValue { date } }
                target: fieldValueByName(name: "Target date") { ... on ProjectV2ItemFieldDateValue { date } }
                content { ${CONTENT} }
              }
            }
          }
        }
      }`,
      { owner: OWNER, number: Number(values.number), after },
    )
    const project = page.user.projectV2
    projectId = project.id
    field = project.field
    startFieldId = project.startField?.id
    targetFieldId = project.targetField?.id
    for (const node of project.items.nodes) {
      const c = node.content
      if (!c || !('number' in c) || c.repository.nameWithOwner !== `${OWNER}/${REPO}`) continue
      onBoard.set(c.id, {
        itemId: node.id,
        item: {
          ...toItem(c, node.status?.name ?? null),
          start: node.start?.date ?? null,
          target: node.target?.date ?? null,
        },
      })
    }
    if (!project.items.pageInfo.hasNextPage) break
    after = project.items.pageInfo.endCursor
  }
  if (!projectId || !field) throw new Error('The board has no Status field')
  const optionId = new Map(field.options.map((o) => [o.name, o.id]))

  // The Roadmap layout needs a start and a target date on each card.
  const ensureDateField = async (name: string, id: string | undefined) => {
    if (id) return id
    console.log(`Create the "${name}" field`)
    if (dryRun) return '(dry run)'
    const made = await graphql<{ createProjectV2Field: { projectV2Field: { id: string } } }>(
      token,
      `
        mutation ($project: ID!, $name: String!) {
          createProjectV2Field(input: { projectId: $project, dataType: DATE, name: $name }) {
            projectV2Field {
              ... on ProjectV2Field {
                id
              }
            }
          }
        }
      `,
      { project: projectId, name },
    )
    return made.createProjectV2Field.projectV2Field.id
  }
  startFieldId = await ensureDateField('Start date', startFieldId)
  targetFieldId = await ensureDateField('Target date', targetFieldId)

  // What should be on the board: everything open, plus everything in the current milestone.
  type RepoPage = {
    repository: {
      milestones: { nodes: { title: string }[] }
      issues: { nodes: ContentNode[] }
      pullRequests: { nodes: ContentNode[] }
    }
  }
  const repo = await graphql<RepoPage>(
    token,
    `query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        milestones(states: OPEN, first: 50) { nodes { title } }
        issues(states: OPEN, first: 100) { nodes { ${FIELDS} } }
        pullRequests(states: OPEN, first: 100) { nodes { ${FIELDS} } }
      }
    }`,
    { owner: OWNER, repo: REPO },
  )
  const current = pickCurrentMilestone(repo.repository.milestones.nodes.map((m) => m.title))
  const wanted: ContentNode[] = [
    ...repo.repository.issues.nodes,
    ...repo.repository.pullRequests.nodes,
  ]
  if (current) {
    type MilestonePage = {
      repository: {
        milestones: {
          nodes: {
            title: string
            issues: { nodes: ContentNode[] }
            pullRequests: { nodes: ContentNode[] }
          }[]
        }
      }
    }
    const m = await graphql<MilestonePage>(
      token,
      `query($owner: String!, $repo: String!, $title: String!) {
        repository(owner: $owner, name: $repo) {
          milestones(query: $title, first: 5) {
            nodes { title issues(first: 100) { nodes { ${FIELDS} } } pullRequests(first: 100) { nodes { ${FIELDS} } } }
          }
        }
      }`,
      { owner: OWNER, repo: REPO, title: current },
    )
    for (const node of m.repository.milestones.nodes.filter((n) => n.title === current)) {
      wanted.push(...node.issues.nodes, ...node.pullRequests.nodes)
    }
  }
  console.log(`Current milestone: ${current ?? '(none)'}`)

  for (const c of wanted) {
    if (onBoard.has(c.id)) continue
    console.log(`Add ${c.__typename === 'Issue' ? 'issue' : 'PR'} #${c.number}`)
    let itemId = '(dry run)'
    if (!dryRun) {
      const added = await graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
        token,
        `
          mutation ($project: ID!, $content: ID!) {
            addProjectV2ItemById(input: { projectId: $project, contentId: $content }) {
              item {
                id
              }
            }
          }
        `,
        { project: projectId, content: c.id },
      )
      itemId = added.addProjectV2ItemById.item.id
    }
    onBoard.set(c.id, {
      itemId,
      item: toItem(c),
    })
  }

  const counts = new Map<string, number>()
  let changed = 0
  const setField = (itemId: string, fieldId: string, value: Record<string, string>) =>
    graphql(
      token,
      `
        mutation ($project: ID!, $item: ID!, $field: ID!, $value: ProjectV2FieldValue!) {
          updateProjectV2ItemFieldValue(
            input: { projectId: $project, itemId: $item, fieldId: $field, value: $value }
          ) {
            projectV2Item {
              id
            }
          }
        }
      `,
      { project: projectId, item: itemId, field: fieldId, value },
    )
  let datesChanged = 0
  for (const { itemId, item } of onBoard.values()) {
    const dates = desiredDates(item)
    for (const [key, date] of Object.entries(dates)) {
      console.log(`#${item.number}: ${key === 'start' ? 'Start' : 'Target'} date ${date}`)
      datesChanged++
      if (!dryRun) await setField(itemId, key === 'start' ? startFieldId : targetFieldId, { date })
    }
  }

  for (const { itemId, item } of onBoard.values()) {
    const want = desiredStatus(item, current)
    const final = want ?? item.status ?? '(none)'
    counts.set(final, (counts.get(final) ?? 0) + 1)
    if (!want) continue
    const option = optionId.get(want)
    if (!option) throw new Error(`The Status field has no "${want}" option`)
    console.log(`#${item.number}: ${item.status ?? '(none)'} -> ${want}`)
    changed++
    if (!dryRun) await setField(itemId, field.id, { singleSelectOptionId: option })
  }

  console.log(`\n${dryRun ? 'Would change' : 'Changed'} ${changed} of ${onBoard.size} items.`)
  for (const [status, n] of [...counts].sort()) console.log(`  ${status}: ${n}`)
  console.log(`${dryRun ? 'Would set' : 'Set'} ${datesChanged} dates.`)
}

if (import.meta.main) await main()
