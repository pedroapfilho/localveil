---
title: 'Standy intent-to-add guidance blocks the pre-commit hook'
severity: 'minor'
issue: 'pedroapfilho/localveil#93'
---

## Expected Behavior

An agent following the repository instructions can run Standy on new files and then commit one coherent subset of the changes.

## Current Behavior

AGENTS.md tells agents to use git add -N so Standy sees new files. The pinned lint-staged pre-commit hook refuses to run while any intent-to-add entries remain, including files outside the subset being committed.

## Possible Solution

Document that intent-to-add entries must be fully staged or removed from the index before committing a subset of changes, or use a changed-file check workflow that does not require intent-to-add entries.

## Minimal Reproducible Example

Create two new source files, run git add -N on both as instructed, fully stage only one, and run git commit. lint-staged exits with: refused to run with files staged with --intent-to-add.

## Context

Encountered while splitting the audit remediation into focused commits after the required Standy changed-path check. Removing only the outstanding intent-to-add entries let the normal pre-commit hook run.
