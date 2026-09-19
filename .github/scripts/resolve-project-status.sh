#!/usr/bin/env bash
# Maps one GitHub event to the delivery Project's Status, per CONTRIBUTING's
# Project-tracking table, and prints `status=` and `content=` lines for
# $GITHUB_OUTPUT. An empty status means the event carries no transition this
# workflow is willing to make on its own.
#
# Not mapped, deliberately: Design versus Awaiting approval for a proposal PR
# (the distinction is whether the published revision is approved), a
# closed-unmerged PR (cancelled or superseded is Next action prose), and an
# issue whose acceptance is only partly shipped (the table keeps it In progress
# until its own closure).
#
# Environment: EVENT, ACTION, IS_DRAFT, MERGED, REVIEW_STATE, PR_NODE_ID,
# ISSUE_NODE_ID — each straight from the event payload.
set -euo pipefail

event="${EVENT:?EVENT is required}"
action="${ACTION:-}"
status=''
content="${PR_NODE_ID:-}"

case "$event" in
  pull_request)
    case "$action" in
      ready_for_review) status='In review' ;;
      converted_to_draft) status='In progress' ;;
      opened | reopened)
        if [ "${IS_DRAFT:-false}" = 'true' ]; then
          status='In progress'
        else
          status='In review'
        fi
        ;;
      closed)
        if [ "${MERGED:-false}" = 'true' ]; then
          status='Done'
        fi
        ;;
    esac
    ;;
  pull_request_review)
    if [ "${REVIEW_STATE:-}" = 'changes_requested' ]; then
      status='In progress'
    fi
    ;;
  issues)
    status='Done'
    content="${ISSUE_NODE_ID:-}"
    ;;
esac

if [ -n "$status" ] && [ -z "$content" ]; then
  echo "::error::event $event/$action maps to '$status' but carries no node id" >&2
  exit 1
fi

echo "status=$status"
echo "content=$content"
