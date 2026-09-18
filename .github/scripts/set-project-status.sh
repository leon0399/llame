#!/usr/bin/env bash
# Sets the delivery Project's Status field for one issue or pull request.
#
# The caller supplies the content's node id and the target status name; this
# script resolves the project, adds the item when it is missing, and writes the
# single-select option whose name matches. It never touches Next action,
# Workstream, Priority, or Order — those carry judgement the event payload does
# not, and CONTRIBUTING keeps them with the agent doing the work.
#
# Environment:
#   GH_TOKEN         token with read and write on the owner's Projects
#   PROJECT_OWNER    user login that owns the project (default leon0399)
#   PROJECT_NUMBER   project number (default 2)
#   CONTENT_ID       node id of the issue or pull request
#   TARGET_STATUS    Status option name, e.g. "In review"
set -euo pipefail

owner="${PROJECT_OWNER:-leon0399}"
number="${PROJECT_NUMBER:-2}"
content_id="${CONTENT_ID:?CONTENT_ID is required}"
target_status="${TARGET_STATUS:?TARGET_STATUS is required}"

project=$(gh api graphql \
  -f query='query($owner:String!,$number:Int!){user(login:$owner){projectV2(number:$number){id field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name}}}}}}' \
  -f owner="$owner" -F number="$number")

project_id=$(printf '%s' "$project" | jq -r '.data.user.projectV2.id')
field_id=$(printf '%s' "$project" | jq -r '.data.user.projectV2.field.id')
option_id=$(printf '%s' "$project" | jq -r --arg name "$target_status" \
  '.data.user.projectV2.field.options[] | select(.name == $name) | .id')

if [ -z "$project_id" ] || [ "$project_id" = "null" ]; then
  echo "::error::project $owner/$number is not readable with this token" >&2
  exit 1
fi
if [ -z "$option_id" ]; then
  echo "::error::Status has no option named '$target_status'" >&2
  exit 1
fi

# Idempotent: addProjectV2ItemById returns the existing item when the content is
# already on the board, so no separate lookup is needed.
item_id=$(gh api graphql \
  -f query='mutation($project:ID!,$content:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}}' \
  -f project="$project_id" -f content="$content_id" \
  --jq '.data.addProjectV2ItemById.item.id')

gh api graphql \
  -f query='mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}}' \
  -f project="$project_id" -f item="$item_id" -f field="$field_id" -f option="$option_id" \
  --jq '.data.updateProjectV2ItemFieldValue.projectV2Item.id' >/dev/null

echo "set Status='$target_status' on project item $item_id"
