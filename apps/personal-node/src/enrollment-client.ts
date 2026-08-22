import { createEnrollmentProof } from "@workspace/federation-experiment/node-enrollment";
import { z } from "zod";

const MAX_ENROLLMENT_RESPONSE_BYTES = 64 * 1024;
const enrollmentGrantSchema = z.strictObject({
  nodeId: z.string().min(1),
  keyId: z.string().min(1),
  enrolledAt: z.string().datetime({ offset: true }),
  revokedAt: z.null(),
  credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export type PeerEnrollmentGrant = z.infer<typeof enrollmentGrantSchema>;

export interface EnrollWithPeerOptions {
  readonly peerUrl: string;
  readonly ownerBearerToken: string;
  readonly nodeId: string;
  readonly realmId: string;
  readonly privateKeyPem: string;
}

function peerOrigin(input: string): URL {
  const url = new URL(input);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "peer URL must be an HTTP origin without credentials or path",
    );
  }
  if (
    url.protocol === "http:" &&
    url.hostname !== "127.0.0.1" &&
    url.hostname !== "localhost" &&
    url.hostname !== "[::1]"
  ) {
    throw new Error("plaintext peer URL must use a loopback host");
  }
  return url;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength > MAX_ENROLLMENT_RESPONSE_BYTES
  ) {
    throw new Error("peer enrollment response is too large");
  }
  if (response.body === null) {
    throw new Error("peer enrollment response has no body");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    receivedBytes += result.value.byteLength;
    if (receivedBytes > MAX_ENROLLMENT_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("peer enrollment response is too large");
    }
    chunks.push(result.value);
  }
  try {
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return input;
  } catch {
    throw new Error("peer enrollment response is not valid JSON");
  }
}

async function postJson(
  url: URL,
  bearerToken: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`peer enrollment failed with HTTP ${response.status}`);
  }
  return readBoundedJson(response);
}

export async function enrollWithPeer(
  options: EnrollWithPeerOptions,
): Promise<PeerEnrollmentGrant> {
  if (options.ownerBearerToken.length < 16) {
    throw new Error(
      "peer owner bearer token must contain at least 16 characters",
    );
  }
  const origin = peerOrigin(options.peerUrl);
  const challenge = await postJson(
    new URL("/v1/enrollment/challenges", origin),
    options.ownerBearerToken,
    { nodeId: options.nodeId },
  );
  const proof = createEnrollmentProof(challenge, options.privateKeyPem);
  if (proof.challenge.realmId !== options.realmId) {
    throw new Error("peer enrollment challenge targets a different Realm");
  }
  if (proof.challenge.nodeId !== options.nodeId) {
    throw new Error("peer enrollment challenge targets a different node");
  }
  const parsed = enrollmentGrantSchema.safeParse(
    await postJson(
      new URL("/v1/enrollment/complete", origin),
      options.ownerBearerToken,
      { proof },
    ),
  );
  if (
    !parsed.success ||
    parsed.data.nodeId !== options.nodeId ||
    parsed.data.keyId !== proof.signature.keyId
  ) {
    throw new Error("peer enrollment grant has invalid identity");
  }
  return parsed.data;
}
