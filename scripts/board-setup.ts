/**
 * Sets up the Flytower Projects board the way the team uses it: the fields and the saved
 * views. It only adds what's missing, so it's safe to run again (the Board workflow runs it
 * when started by hand with "Set up the board" ticked).
 *
 *   PROJECTS_TOKEN=... bun scripts/board-setup.ts [--number 1] [--dry-run]
 *
 * Fields: Status (Backlog, Todo, In progress, In review, Done), Priority (P0 to P3), Size
 * (XS to XL), Area (one per area: label), Start date and Target date.
 *
 * Views: Board, Active, Milestones, Roadmap, Backlog, Triage, Pull requests, Bugs, My work
 * and Done. A view that already exists by name is left as it is, so changes made by hand
 * stick. Delete a view to have it made again.
 *
 * What the API can't do is done once by hand in the board's settings: the Roadmap's date
 * fields and the built-in workflows (see .github/project-board.md).
 */
import { parseArgs } from 'node:util'
import { BOARD_OWNER, BOARD_OWNER_TYPE, OWNER, REPO, graphql } from './board-sync'

type Color = 'GRAY' | 'BLUE' | 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'PINK' | 'PURPLE'
interface Option {
  name: string
  color: Color
  description: string
}

export const STATUS: Option[] = [
  { name: 'Backlog', color: 'GRAY', description: 'Not planned for the current milestone yet' },
  { name: 'Todo', color: 'BLUE', description: 'Planned for the current milestone' },
  { name: 'In progress', color: 'YELLOW', description: 'Being worked on, or a draft pull request' },
  { name: 'In review', color: 'PURPLE', description: 'A pull request waiting for review' },
  { name: 'Done', color: 'GREEN', description: 'Closed, merged or released' },
]
export const PRIORITY: Option[] = [
  { name: 'P0', color: 'RED', description: 'Urgent: drop everything' },
  { name: 'P1', color: 'ORANGE', description: 'High: this milestone' },
  { name: 'P2', color: 'YELLOW', description: 'Medium: soon' },
  { name: 'P3', color: 'GRAY', description: 'Low: some day' },
]
export const SIZE: Option[] = [
  { name: 'XS', color: 'GRAY', description: 'Under an hour' },
  { name: 'S', color: 'BLUE', description: 'A few hours' },
  { name: 'M', color: 'GREEN', description: 'About a day' },
  { name: 'L', color: 'YELLOW', description: 'A few days' },
  { name: 'XL', color: 'RED', description: 'A week or more: split it' },
]
const AREA_COLOURS: Color[] = ['BLUE', 'GREEN', 'PURPLE', 'ORANGE', 'PINK', 'YELLOW', 'RED']

export interface ViewSpec {
  name: string
  layout: 'table' | 'board' | 'roadmap'
  filter?: string
  /** Field names, turned into field IDs once the fields exist. */
  fields?: string[]
  groupBy?: string
  columnsBy?: string
  sortBy?: [string, 'asc' | 'desc'][]
}

const TABLE = ['Title', 'Assignees', 'Status', 'Priority', 'Size', 'Area', 'Milestone']

export const VIEWS: ViewSpec[] = [
  {
    name: 'Board',
    layout: 'board',
    columnsBy: 'Status',
    fields: ['Title', 'Assignees', 'Priority', 'Size', 'Area', 'Milestone', 'Linked pull requests'],
    sortBy: [['Priority', 'asc']],
  },
  {
    name: 'Active',
    layout: 'table',
    filter: 'status:Todo,"In progress","In review"',
    fields: [...TABLE, 'Target date'],
    groupBy: 'Status',
    sortBy: [['Priority', 'asc']],
  },
  {
    name: 'Milestones',
    layout: 'table',
    filter: 'is:open',
    fields: [...TABLE, 'Target date'],
    groupBy: 'Milestone',
    sortBy: [['Priority', 'asc']],
  },
  { name: 'Roadmap', layout: 'roadmap', filter: 'is:issue', groupBy: 'Milestone' },
  {
    name: 'Backlog',
    layout: 'table',
    filter: 'status:Backlog',
    fields: TABLE,
    groupBy: 'Area',
    sortBy: [['Priority', 'asc']],
  },
  {
    name: 'Triage',
    layout: 'table',
    filter: 'is:issue is:open no:priority',
    fields: ['Title', 'Labels', 'Milestone', 'Priority', 'Size', 'Area'],
  },
  {
    name: 'Pull requests',
    layout: 'table',
    filter: 'is:pr is:open',
    fields: ['Title', 'Assignees', 'Reviewers', 'Status', 'Area', 'Milestone'],
    groupBy: 'Status',
  },
  {
    name: 'Bugs',
    layout: 'table',
    filter: 'is:open label:"type:bug"',
    fields: TABLE,
    sortBy: [['Priority', 'asc']],
  },
  {
    name: 'My work',
    layout: 'board',
    filter: 'assignee:@me is:open',
    columnsBy: 'Status',
    fields: ['Title', 'Priority', 'Size', 'Milestone'],
  },
  {
    name: 'Done',
    layout: 'table',
    filter: 'status:Done',
    fields: ['Title', 'Area', 'Milestone', 'Target date'],
    sortBy: [['Target date', 'desc']],
  },
]

/**
 * The options a single-select field is missing or has with the wrong name (GitHub's own
 * Status has "In Progress", which becomes "In progress"), in the order wanted.
 */
export function missingOptions(have: string[], want: Option[]): Option[] {
  return want.filter((o) => !have.includes(o.name))
}

/** An existing option that matches a wanted one, ignoring case. */
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The Area options for a set of labels: one per area: label, in label order. */
export function areaOptions(labels: string[]): Option[] {
  return labels
    .filter((l) => l.startsWith('area:'))
    .map((l, i) => ({
      name: l.slice('area:'.length),
      color: AREA_COLOURS[i % AREA_COLOURS.length]!,
      description: `Items labelled ${l}`,
    }))
}

interface Field {
  id: string
  databaseId: number
  name: string
  dataType: string
  options?: { id: string; name: string; color: Color; description: string }[]
}

/** The REST body for a view, with field names turned into IDs. Unknown names are dropped. */
export function viewBody(view: ViewSpec, ids: Map<string, number>) {
  const id = (name: string) => ids.get(name)
  const one = (name?: string) => (name && id(name) !== undefined ? [id(name)!] : undefined)
  const body: Record<string, unknown> = { name: view.name, layout: view.layout }
  if (view.filter) body.filter = view.filter
  if (view.fields && view.layout !== 'roadmap') {
    body.visible_fields = view.fields.map(id).filter((v) => v !== undefined)
  }
  if (one(view.groupBy)) body.group_by = one(view.groupBy)
  if (one(view.columnsBy)) body.vertical_group_by = one(view.columnsBy)
  const sort = view.sortBy?.filter(([name]) => id(name) !== undefined)
  if (sort?.length) body.sort_by = sort.map(([name, dir]) => [id(name), dir])
  return body
}

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
  const number = Number(values.number)

  const load = async () => {
    type Page = Record<
      'user' | 'organization',
      {
        projectV2: {
          id: string
          title: string
          url: string
          fields: { nodes: Field[] }
          views: { nodes: { name: string }[] }
        }
      }
    >
    const page = await graphql<Page>(
      token,
      `query($owner: String!, $number: Int!) {
        ${BOARD_OWNER_TYPE}(login: $owner) {
          projectV2(number: $number) {
            id title url
            fields(first: 50) {
              nodes {
                ... on ProjectV2FieldCommon { id databaseId name dataType }
                ... on ProjectV2SingleSelectField { options { id name color description } }
              }
            }
            views(first: 50) { nodes { name } }
          }
        }
      }`,
      { owner: BOARD_OWNER, number },
    )
    return page[BOARD_OWNER_TYPE].projectV2
  }

  let project = await load()
  console.log(`Board: ${project.title} (${project.url})`)
  const field = (name: string) => project.fields.nodes.find((f) => f.name === name)

  // Single-select fields: create them, or add the options they're missing. Existing options
  // keep their IDs, so cards already set keep their values.
  const ensureSelect = async (name: string, want: Option[]) => {
    const existing = field(name)
    if (!existing) {
      console.log(`Create the ${name} field: ${want.map((o) => o.name).join(', ')}`)
      if (dryRun) return
      await graphql(
        token,
        `
          mutation (
            $project: ID!
            $name: String!
            $options: [ProjectV2SingleSelectFieldOptionInput!]!
          ) {
            createProjectV2Field(
              input: {
                projectId: $project
                dataType: SINGLE_SELECT
                name: $name
                singleSelectOptions: $options
              }
            ) {
              projectV2Field {
                ... on ProjectV2SingleSelectField {
                  id
                }
              }
            }
          }
        `,
        { project: project.id, name, options: want },
      )
      return
    }
    const have = existing.options ?? []
    const missing = missingOptions(
      have.map((o) => o.name),
      want,
    )
    if (!missing.length) return
    console.log(`Add to ${name}: ${missing.map((o) => o.name).join(', ')}`)
    if (dryRun) return
    // The wanted options first, in order, keeping the IDs of those that exist; then any
    // extra options someone added by hand.
    const options = [
      ...want.map((o) => {
        const old = have.find((h) => same(h.name, o.name))
        return old ? { id: old.id, ...o } : o
      }),
      ...have
        .filter((o) => !want.some((w) => same(w.name, o.name)))
        .map((o) => ({ id: o.id, name: o.name, color: o.color, description: o.description })),
    ]
    const update = (opts: unknown[]) =>
      graphql(
        token,
        `
          mutation ($field: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
            updateProjectV2Field(input: { fieldId: $field, singleSelectOptions: $options }) {
              projectV2Field {
                ... on ProjectV2SingleSelectField {
                  id
                }
              }
            }
          }
        `,
        { field: existing.id, options: opts },
      )
    try {
      await update(options)
    } catch (err) {
      // Older API versions don't take option IDs. Without them the options are replaced, and
      // cards lose this field's value until the next sync sets it again.
      if (!String(err).includes('id')) throw err
      console.log(`  (option IDs not accepted; replacing ${name}'s options)`)
      await update(options.map(({ name, color, description }) => ({ name, color, description })))
    }
  }

  const labels = await graphql<{ repository: { labels: { nodes: { name: string }[] } } }>(
    token,
    `
      query ($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          labels(first: 100, query: "area:") {
            nodes {
              name
            }
          }
        }
      }
    `,
    { owner: OWNER, repo: REPO },
  )

  await ensureSelect('Status', STATUS)
  await ensureSelect('Priority', PRIORITY)
  await ensureSelect('Size', SIZE)
  await ensureSelect('Area', areaOptions(labels.repository.labels.nodes.map((l) => l.name).sort()))
  for (const name of ['Start date', 'Target date']) {
    if (field(name)) continue
    console.log(`Create the ${name} field`)
    if (dryRun) continue
    await graphql(
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
      { project: project.id, name },
    )
  }

  // Views, through the REST API: GraphQL can read views but not make them.
  project = await load()
  const ids = new Map(project.fields.nodes.map((f) => [f.name, f.databaseId]))
  const have = new Set(project.views.nodes.map((v) => v.name))
  const base =
    BOARD_OWNER_TYPE === 'user'
      ? `https://api.github.com/users/${BOARD_OWNER}/projectsV2/${number}/views`
      : `https://api.github.com/orgs/${BOARD_OWNER}/projectsV2/${number}/views`
  for (const view of VIEWS) {
    if (have.has(view.name)) continue
    const body = viewBody(view, ids)
    console.log(`Create the ${view.name} view: ${JSON.stringify(body)}`)
    if (dryRun) continue
    const res = await fetch(base, {
      method: 'POST',
      headers: {
        authorization: `bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`Creating the ${view.name} view: GitHub ${res.status} ${await res.text()}`)
    }
  }
  console.log(dryRun ? 'Dry run: nothing changed.' : 'The board is set up.')
}

if (import.meta.main) await main()
