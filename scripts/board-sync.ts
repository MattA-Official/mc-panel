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
  milestone: { title: string } | null
  repository: { nameWithOwner: string }
}

const CONTENT = `
  __typename
  ... on Issue { id number state milestone { title } repository { nameWithOwner } }
  ... on PullRequest { id number state milestone { title } repository { nameWithOwner } }
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
        items: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          nodes: {
            id: string
            status: { name: string } | null
            content: ContentNode | null
          }[]
        }
      }
    }
  }
  let projectId: string | undefined
  let field: { id: string; options: { id: string; name: string }[] } | null | undefined
  const onBoard = new Map<string, { itemId: string; item: Item }>()
  for (let after: string | null = null; ;) {
    const page: BoardPage = await graphql<BoardPage>(
      token,
      `query($owner: String!, $number: Int!, $after: String) {
        user(login: $owner) {
          projectV2(number: $number) {
            id
            field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
            items(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
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
    for (const node of project.items.nodes) {
      const c = node.content
      if (!c || !('number' in c) || c.repository.nameWithOwner !== `${OWNER}/${REPO}`) continue
      onBoard.set(c.id, {
        itemId: node.id,
        item: {
          kind: c.__typename,
          number: c.number,
          state: c.state,
          milestone: c.milestone?.title ?? null,
          status: node.status?.name ?? null,
        },
      })
    }
    if (!project.items.pageInfo.hasNextPage) break
    after = project.items.pageInfo.endCursor
  }
  if (!projectId || !field) throw new Error('The board has no Status field')
  const optionId = new Map(field.options.map((o) => [o.name, o.id]))

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
        issues(states: OPEN, first: 100) { nodes { ${CONTENT} } }
        pullRequests(states: OPEN, first: 100) { nodes { ${CONTENT} } }
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
            nodes { title issues(first: 100) { nodes { ${CONTENT} } } pullRequests(first: 100) { nodes { ${CONTENT} } } }
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
      item: {
        kind: c.__typename,
        number: c.number,
        state: c.state,
        milestone: c.milestone?.title ?? null,
        status: null,
      },
    })
  }

  const counts = new Map<string, number>()
  let changed = 0
  for (const { itemId, item } of onBoard.values()) {
    const want = desiredStatus(item, current)
    const final = want ?? item.status ?? '(none)'
    counts.set(final, (counts.get(final) ?? 0) + 1)
    if (!want) continue
    const option = optionId.get(want)
    if (!option) throw new Error(`The Status field has no "${want}" option`)
    console.log(`#${item.number}: ${item.status ?? '(none)'} -> ${want}`)
    changed++
    if (dryRun) continue
    await graphql(
      token,
      `
        mutation ($project: ID!, $item: ID!, $field: ID!, $option: String!) {
          updateProjectV2ItemFieldValue(
            input: {
              projectId: $project
              itemId: $item
              fieldId: $field
              value: { singleSelectOptionId: $option }
            }
          ) {
            projectV2Item {
              id
            }
          }
        }
      `,
      { project: projectId, item: itemId, field: field.id, option },
    )
  }

  console.log(`\n${dryRun ? 'Would change' : 'Changed'} ${changed} of ${onBoard.size} items.`)
  for (const [status, n] of [...counts].sort()) console.log(`  ${status}: ${n}`)
}

if (import.meta.main) await main()
