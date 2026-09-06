import { NodeProtocolError } from "./errors";
import { uuid } from "./validation";

/** Express-style header value: a verified session subject is asserted, never selected. */
export type NodeHttpHeaderValue = string | ReadonlyArray<string> | undefined;

/** An asserted subject can only narrow a verified session, never select one. */
export function assertHttpBinding(
  authenticatedSubject: string,
  expectedSubject: NodeHttpHeaderValue,
  version: NodeHttpHeaderValue,
  method: string,
): void {
  uuid(authenticatedSubject);
  if (version !== "1")
    throw new NodeProtocolError(
      "protocol_version",
      "The Node endpoint requires version 1.",
    );
  if (method === "core.describe" && expectedSubject === undefined) return;
  if (expectedSubject !== authenticatedSubject) {
    throw new NodeProtocolError(
      "principal_mismatch",
      "Node request does not match the authenticated account.",
    );
  }
}
