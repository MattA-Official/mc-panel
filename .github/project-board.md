# The project board

The [Flytower board](https://github.com/orgs/teamflytower/projects) belongs to the
teamflytower organisation. The **Board** workflow keeps it up to date on every change to an
issue or pull request (scripts/board-sync.ts), and builds its fields and views when started
by hand with **Set up the board** ticked (scripts/board-setup.ts).

## How cards move

| Status      | What puts a card there                                                        |
| ----------- | ----------------------------------------------------------------------------- |
| Backlog     | An open issue outside the current milestone                                   |
| Todo        | An open issue in the current milestone (the open one with the lowest version) |
| In progress | Moved by hand when work starts, or a draft pull request                       |
| In review   | A pull request that's ready for review                                        |
| Done        | Closed, merged or released                                                    |

Issues moved by hand to In progress or In review stay there until they close. **Area**
follows the item's `area:` label. **Priority** (P0 to P3) and **Size** (XS to XL) are set by
hand or by the Assistant when triaging. **Start date** and **Target date** fill in from when
an item opens and closes, or its milestone's due date.

## Views

| View          | Shows                                                |
| ------------- | ---------------------------------------------------- |
| Board         | Every card in Status columns                         |
| Active        | Todo, In progress and In review, grouped by status   |
| Milestones    | Everything open, grouped by milestone                |
| Roadmap       | Issues on a timeline by Start and Target date        |
| Backlog       | The backlog, grouped by area, highest priority first |
| Triage        | Open issues with no priority yet                     |
| Pull requests | Open pull requests and their reviewers               |
| Bugs          | Open bugs, highest priority first                    |
| My work       | Your open cards                                      |
| Done          | Finished work, newest first                          |

## Set once by hand

The API can't change these, so they're set in the board's settings:

1. **Roadmap dates:** open the Roadmap view, then **Date fields**, and pick Start date and
   Target date.
2. **Workflows** (the board's menu, then Workflows): turn on **Auto-add to project** for
   `teamflytower/flytower` with the filter `is:issue,pr is:open`, so new cards appear at
   once, and **Auto-archive items** with `is:closed updated:<@today-14d`, so Done stays
   short. Leave the other built-in status workflows off: the Board workflow sets Status.
3. Delete the default **View 1** once the views above exist.
