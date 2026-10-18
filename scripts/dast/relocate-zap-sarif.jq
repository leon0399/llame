# Makes ZAP's native SARIF acceptable to GitHub code scanning, which rejects
# any location that is not a file in the repository. Each result is anchored
# to its operation's line in the OpenAPI document the scan was driven by; the
# scanned method and path move into the message.
#
#   jq --rawfile spec apps/api/openapi.json \
#     -f scripts/dast/relocate-zap-sarif.jq zap-report.sarif.json
#
# The document is Prettier-formatted, so path keys sit at four spaces and their
# operations at six; that fixed layout is what lets raw text give line numbers.

# Every operation as {template, method, line}, with the path key's own line
# kept as method "" for a request whose method the document does not declare.
def operations:
  ($spec | split("\n")) as $lines
  | reduce range(0; $lines | length) as $i ({template: null, ops: []};
      $lines[$i] as $line
      | if ($line | test("^    \"/")) then
          .template = ($line | capture("^    \"(?<t>[^\"]+)\"").t)
          | .ops += [{template, method: "", line: ($i + 1)}]
        elif ($line | test("^  \"")) then
          .template = null
        elif .template != null
          and ($line | test("^      \"(get|put|post|patch|delete|head|options|trace)\": \\{")) then
          .ops += [{
            template,
            method: ($line | capture("^      \"(?<m>[a-z]+)\"").m | ascii_upcase),
            line: ($i + 1)
          }]
        else . end)
  | .ops;

# ZAP fills path parameters with placeholder values, so a template matches any
# segment where it has a {parameter}. Literal segments win over parameters.
def template_matches($path):
  ("^" + (gsub("\\."; "\\.") | gsub("\\{[^}]+\\}"; "[^/]+")) + "$") as $pattern
  | $path | test($pattern);

def locate($ops; $method; $path):
  [$ops[] | select(.template | template_matches($path))]
  | sort_by(.template | [scan("\\{")] | length)
  | (.[0].template // null) as $template
  | if $template == null then {template: $path, line: 1}
    else (map(select(.template == $template)) | (map(select(.method == $method))[0] // .[0]))
    end;

operations as $ops
| .runs |= map(.results |= map(
    (.locations[0].physicalLocation.artifactLocation.uri
      | sub("^[a-z]+://[^/]+"; "")) as $target
    | ($target | sub("\\?.*$"; "")) as $path
    | (.webRequest.method // "") as $method
    | locate($ops; $method; $path) as $operation
    | .message.text = "\($method) \($target): \(.message.text)"
    # The template, not ZAP's placeholder values, identifies the endpoint, so
    # results stay one alert per rule and operation across runs.
    | .partialFingerprints = {
        primaryLocationLineHash: "\(.ruleId) \($method) \($operation.template)"
      }
    | .locations = [{physicalLocation: {
        artifactLocation: {uri: "apps/api/openapi.json"},
        region: {startLine: $operation.line}
      }}]
  ))
