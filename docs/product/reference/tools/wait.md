---
summary: "wait suspends a Run until a listed background job settles, timeout, or interruption"
read_when:
  - you need to wait for background jobs without stopping them
  - you need the accepted job locator and timeout bounds
spec: tool-calling
configured_by: ../../operator/background-jobs.md
---

# wait

This tool is not yet available. This page describes the planned behavior.

## Purpose

`wait` suspends the current Run while one or more jobs continue in the background.
It returns at the first listed job settlement, the timeout, or an interruption.
A wait never stops a job.

An already-settled listed job returns immediately. A settlement of another job
also ends the wait as `interrupted`; its notice is delivered at that boundary.
Only one wait is accepted in a model step, and sibling tools finish before a
running wait releases the worker slot.

## Arguments

- `jobs`: 1 to 16 `job://<executor>-<n>` record locators from the current Chat.
  Output locators such as `job://bash-4/stdout` are not accepted.
- `timeout`: optional integer seconds from 1 to 3,600; the default is 3,600.

## Result

The result names each locator and its state. A settled entry also includes exit
detail when present, elapsed milliseconds, bounded output previews, and its
`artifact://` locator when an artifact exists. An early timeout or interruption
reports running entries without stopping those jobs. It promises a later notice
only for entries that remain running.

The wait result is a read-only observation. It creates no native attempt and
exposes no job receipt or host path.

## Errors

A malformed argument is `invalid_input`. A locator that does not name a job of
this Chat is `not_found`; the Run does not wait.

## Configured by

The wait tool cannot be enabled yet.
