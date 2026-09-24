# Task Handoffs

Use this directory for task-level implementation evidence. It is required for parallel task branches that must avoid editing the root `HANDOFF.md` concurrently, and it may also be used by a main-worktree task before review or integration.

Name each file after its task ID, for example `NB-003.md`, and include:

```md
# NB-003 Handoff

- Owner:
- Branch:
- Base commit:
- Status:
- File scope:

## Changed

## Verification

## Remaining risks

## Reviewer notes
```

After integration, the integration owner moves lasting architectural decisions into `docs/decisions/`, updates the root `HANDOFF.md`, and removes obsolete task-specific detail when it no longer helps future work.

## Why NB-006 and NB-007 have no files here

`TASKS.md` lists both as `review`, and the runbook asks for the release record to
live in the NB-007 handoff. Neither has a file in this directory, and that is
deliberate rather than an oversight:

- Both are **integration tasks owned by Yanfei**, worked in the main worktree
  rather than on task branches. This directory exists for branches that must not
  edit the root `HANDOFF.md` concurrently; integration work edits that file
  directly.
- Their evidence lives in **`NB-010.md`**, which reconstructs the release record
  from committed configuration and current observations.

If a future integration task does need a file here, name it after the task ID like
any other.
