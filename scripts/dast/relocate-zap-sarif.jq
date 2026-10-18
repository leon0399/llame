# Makes ZAP's native SARIF acceptable to GitHub code scanning, which rejects
# any location that is not a file in the repository. Every result is anchored
# to the OpenAPI document the scan was driven by; the scanned method and path
# move into the message, and into the fingerprint so results for different
# endpoints stay separate alerts instead of merging on one line.
#
#   jq -f scripts/dast/relocate-zap-sarif.jq zap-report.sarif.json
.runs |= map(.results |= map(
  (.locations[0].physicalLocation.artifactLocation.uri
    | sub("^[a-z]+://[^/]+"; "")) as $path
  | (.webRequest.method // "") as $method
  | .message.text = "\($method) \($path): \(.message.text)"
  # Query strings carry ZAP's generated values, so they stay out of the identity.
  | .partialFingerprints = {
      primaryLocationLineHash: "\(.ruleId) \($method) \($path | sub("\\?.*$"; ""))"
    }
  | .locations = [{physicalLocation: {
      artifactLocation: {uri: "apps/api/openapi.json"},
      region: {startLine: 1}
    }}]
))
