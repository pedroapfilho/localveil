---
title: 'Friction-only commits fail the formatter pre-commit hook'
severity: 'minor'
---

## Expected Behavior

A commit containing the required Frog friction records passes the standard pre-commit hook.

## Current Behavior

The lint-staged Markdown glob sends .agents/friction-log entries to oxfmt, while .oxfmtrc.json explicitly ignores that directory. A friction-only commit fails with: Expected at least one target file. All matched files may have been excluded by ignore rules.

## Possible Solution

Make lint-staged exclude the same friction directory as oxfmt, so required metadata-only commits do not invoke a formatter with no eligible targets.

## Minimal Reproducible Example

Run npx frog log with a complete issue-form body, stage only the new friction.md file, and run git commit.

## Context

Encountered when committing the build and intent-to-add papercuts after the source fixes. The hook passes when the commit also contains an eligible Markdown file.
