/**
 * Keeps the Status column of the Flytower Projects board in step with the repository.
 *
 *   PROJECTS_TOKEN=... bun scripts/board-sync.ts [--number 1] [--dry-run]
 *
 * The board belongs to the teamflytower organisation; BOARD_OWNER and BOARD_OWNER_TYPE
 * (organization or user) point the script at another one. The repository is the one the
 * workflow runs in (GITHUB_REPOSITORY), so a fork or a renamed repository keeps working.
 *
 * Every open issue and pull request, and everything in the current milestone, is put on the
 * board. Each item then gets a Status:
 *
 *   closed issue, merged or closed pull request   -> Done
 *   draft pull request                            -> In progress
 *   open pull request, ready for review           -> In review
 *   open issue in the current milestone           -> Todo
 *   any other open issue                          -> Backlog
 *
 * Open issues already marked In progress or In review are left alone, so moving a card by
 * hand sticks. The Area field follows each item's first area: label. The current milestone is the open one with the lowest version number.
 *
 * Dates, for the Roadmap layout (in the UK calendar):
 *
 *   Start date    the day the issue or pull request was opened, unless set by hand
 *   Target date   the day it was closed or merged; while open, its milestone's due date,
 *                 unless set by hand
 *
 * The Start date and Target date fields are created if the board doesn't have them.
 *
 * PROJECTS_TOKEN: the workflow token can't reach a Projects board at all, so this is either
 * a fine-grained token for the organisation (Projects: read and write; Issues, Pull requests
 * and Metadata: read) or a classic token with the `repo` and `project` scopes.
 */
import { parseArgs } from 'node:util'

export type Status = 'Backlog' | 'Todo' | 'In progress' | 'In review' | 'Done'

export interface Item {
  kind: 'Issue' | 'PullRequest'
  number: number
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  milestone: string | null
  status: string | null
  /** A pull request that is still a draft. */
  draft?: boolean
  /** The item's labels, for its Area. */
  labels?: string[]
  /** The Area field as it is on the board. */
  area?: string | null
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
  // An open pull request follows its draft state: a draft is still being worked on.
  if (item.kind === 'PullRequest') {
    const want: Status = item.draft ? 'In progress' : 'In review'
    return item.status === want ? null : want
  }
  if (item.status === 'In progress' || item.status === 'In review') return null
  let want: Status
  if (currentMilestone !== null && item.milestone === currentMilestone) want = 'Todo'
  else want = 'Backlog'
  return item.status === want ? null : want
}

/**
 * The Area an item should have, from its first `area:` label (area:panel -> panel), or null
 * to leave it as it is. Items without an area label keep whatever was set by hand.
 */
export function desiredArea(item: Item): string | null {
  const label = item.labels?.find((l) => l.startsWith('area:'))
  if (!label) return null
  const area = label.slice('area:'.length)
  return item.area === area ? null : area
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

export const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY ?? 'teamflytower/flytower').split(
  '/',
) as [string, string]
export const BOARD_OWNER = process.env.BOARD_OWNER ?? 'teamflytower'
export const BOARD_OWNER_TYPE = process.env.BOARD_OWNER_TYPE === 'user' ? 'user' : 'organization'

export async function graphql<T>(
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
  isDraft?: boolean
  labels?: { nodes: { name: string }[] }
}

function toItem(c: ContentNode, status: string | null = null): Item {
  return {
    kind: c.__typename,
    number: c.number,
    state: c.state,
    milestone: c.milestone?.title ?? null,
    status,
    draft: c.isDraft ?? false,
    labels: c.labels?.nodes.map((l) => l.name) ?? [],
    createdAt: c.createdAt,
    closedAt: c.closedAt,
    milestoneDue: c.milestone?.dueOn ?? null,
  }
}

// Fields of an issue or pull request, for a connection that only holds one of the two.
const FIELDS =
  '__typename id number state createdAt closedAt milestone { title dueOn } repository { nameWithOwner } labels(first: 20) { nodes { name } }'
const PR_FIELDS = `${FIELDS} isDraft`

// The same fields for a board item, whose content could be either (or a draft).
const CONTENT = `
  __typename
  ... on Issue { ${FIELDS.replace('__typename ', '')} }
  ... on PullRequest { ${PR_FIELDS.replace('__typename ', '')} }
`

async function main() {
  const { values } = parseArgs({
    options: {
      number: { type: 'string', default: process.env.BOARD_NUMBER ?? '1' },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const token = process.env.PROJECTS_TOKEN
  if (!token) throw new Error('PROJECTS_TOKEN is not set')
  const dryRun = values['dry-run']

  // The board, its Status field and the items already on it.
  type BoardPage = Record<
    'user' | 'organization',
    {
      projectV2: {
        id: string
        // Asking for a field by a name the board doesn't have is an error, so list them all.
        fields: {
          nodes: { id?: string; name?: string; options?: { id: string; name: string }[] }[]
        }
        items: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          nodes: {
            id: string
            fieldValues: {
              nodes: { field?: { name: string }; name?: string; date?: string }[]
            }
            content: ContentNode | null
          }[]
        }
      }
    }
  >
  let projectId: string | undefined
  let field: { id: string; options: { id: string; name: string }[] } | null | undefined
  let startFieldId: string | undefined
  let targetFieldId: string | undefined
  let areaField: { id: string; options: { id: string; name: string }[] } | null | undefined
  const onBoard = new Map<string, { itemId: string; item: Item }>()
  for (let after: string | null = null; ;) {
    const page: BoardPage = await graphql<BoardPage>(
      token,
      `query($owner: String!, $number: Int!, $after: String) {
        ${BOARD_OWNER_TYPE}(login: $owner) {
          projectV2(number: $number) {
            id
            fields(first: 50) {
              nodes {
                ... on ProjectV2FieldCommon { id name }
                ... on ProjectV2SingleSelectField { options { id name } }
              }
            }
            items(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                fieldValues(first: 30) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
                    ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
                  }
                }
                content { ${CONTENT} }
              }
            }
          }
        }
      }`,
      { owner: BOARD_OWNER, number: Number(values.number), after },
    )
    const project = page[BOARD_OWNER_TYPE].projectV2
    projectId = project.id
    const byName = (name: string) => project.fields.nodes.find((f) => f.name === name)
    const status = byName('Status')
    field = status?.id && status.options ? { id: status.id, options: status.options } : null
    startFieldId = byName('Start date')?.id
    targetFieldId = byName('Target date')?.id
    const area = byName('Area')
    areaField = area?.id && area.options ? { id: area.id, options: area.options } : null
    for (const node of project.items.nodes) {
      const c = node.content
      if (!c || !('number' in c) || c.repository.nameWithOwner !== `${OWNER}/${REPO}`) continue
      const value = (name: string) => node.fieldValues.nodes.find((v) => v.field?.name === name)
      onBoard.set(c.id, {
        itemId: node.id,
        item: {
          ...toItem(c, value('Status')?.name ?? null),
          start: value('Start date')?.date ?? null,
          target: value('Target date')?.date ?? null,
          area: value('Area')?.name ?? null,
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
        pullRequests(states: OPEN, first: 100) { nodes { ${PR_FIELDS} } }
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
            nodes { title issues(first: 100) { nodes { ${FIELDS} } } pullRequests(first: 100) { nodes { ${PR_FIELDS} } } }
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

  // The Area field, made by scripts/board-setup.ts, follows each item's area: label.
  let areasChanged = 0
  if (areaField) {
    const areaOption = new Map(areaField.options.map((o) => [o.name, o.id]))
    for (const { itemId, item } of onBoard.values()) {
      const want = desiredArea(item)
      if (!want) continue
      const option = areaOption.get(want)
      if (!option) {
        console.log(`#${item.number}: no "${want}" Area option; run the board setup again`)
        continue
      }
      console.log(`#${item.number}: Area ${item.area ?? '(none)'} -> ${want}`)
      areasChanged++
      if (!dryRun) await setField(itemId, areaField.id, { singleSelectOptionId: option })
    }
  }

  console.log(`\n${dryRun ? 'Would change' : 'Changed'} ${changed} of ${onBoard.size} items.`)
  for (const [status, n] of [...counts].sort()) console.log(`  ${status}: ${n}`)
  console.log(`${dryRun ? 'Would set' : 'Set'} ${datesChanged} dates and ${areasChanged} areas.`)
}

if (import.meta.main) await main()
