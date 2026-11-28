---
status: accepted
---

# Stored Credentials are encrypted by llame with an ordered key list

llame encrypts each stored Credential's secret payload with AES-256-GCM before
writing it to Postgres. The operator supplies an ordered list of Credential keys
through configuration interpolation. The first key encrypts, every listed key
decrypts, and each ciphertext records which key encrypted it.

We encrypt because llame's database is shared by its processes and is dumped
and backed up, so a leaked dump would otherwise be a set of live refresh tokens.
The coding harnesses we compared store tokens unencrypted, because their store
is one file on one person's machine. Coder's database encryption is the model:
ordered keys, a key id on each ciphertext, a rotate command, and a refusal to
start on an unknown key.

## Considered options

- No encryption, as oh-my-pi, OpenClaw, and OpenCode do. Nothing to configure,
  and every backup exposes the tokens.
- Encryption inside Postgres with pgcrypto or pgsodium. The key would reach the
  database in every query and could appear in statement statistics and logs.
- Envelope encryption with per-row data keys, as Grafana does. Rotation then
  re-wraps only the data keys, which pays off at a scale llame's few Credentials
  never reach.
- A key generated on first boot, as n8n does. A container recreated without its
  volume would lose the key, and every Credential with it, without an error.

## Consequences

- The row's id, owner, service, and kind are authenticated with the ciphertext,
  so a ciphertext copied into another row fails to decrypt. Database write
  access without the key cannot move the operator's token to an owner.
- Rotation is three steps: put the new key first, run the rotate command, then
  remove the old key. Removing it early stops startup with the missing key id.
- A database dump without the keys exposes Credential metadata (service, label,
  owner, expiry) and no secret. Losing every key logs out every Credential.

This was decided in
[Encryption of stored credentials](https://github.com/leon0399/llame/issues/1847#issuecomment-7233485322),
for
[llame-managed credentials: login, storage, and refresh](https://github.com/leon0399/llame/issues/1825)
and
[provider accounts and encrypted credential vault](https://github.com/leon0399/llame/issues/18).
