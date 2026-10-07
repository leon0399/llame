---
summary: "Configuring openai-completions entries for vLLM-served models behind a LiteLLM gateway: usage and reasoning effort"
read_when:
  - you are pointing an openai-completions provider entry at a LiteLLM proxy in front of vLLM
  - a model's effort levels change nothing in its answers
---

# Self-hosted models behind a LiteLLM gateway

A LiteLLM proxy in front of vLLM serves Chat Completions, so its provider entry
uses the `openai-completions` type with the proxy's `/v1` URL as `baseUrl`.
Token usage needs no configuration. Reasoning effort needs two things the
gateway does not tell you: the values the model accepts, and whether LiteLLM
forwards them.

## Session affinity

LiteLLM reads `X-Session-Id` for session affinity and spend grouping. llame
sends it by default for an `openai-completions` provider, rendered as the
Chat id for main turns and compaction and as `title:<chatId>` for title
generation. If a strict proxy rejects the header, remove it on that provider
with `"headers": { "X-Session-Id": null }`.

## Token usage

llame asks for usage on every streaming Chat Completions request
(`stream_options.include_usage`), and LiteLLM relays the server's usage chunk.
If a message's usage card still shows no counts, first check whether the
model's `additional_drop_params` list strips `stream_options` before the
request reaches the server. Otherwise either the server sent no usage chunk or
the proxy did not relay it; compare the server's own response to tell which.

## Reasoning effort

The run's effort is sent as the top-level `reasoning_effort` field. vLLM passes
it to the model's chat template, so the accepted values are whatever that
template accepts rather than a fixed list, and two models behind the same
gateway can accept different values. Declare them in the model entry's
`reasoning.effortLevels`, in the order the effort picker should show them:

```jsonc
{
  "id": "system:gateway:deepseek-v4-flash",
  "provider": "gateway",
  "providerModelId": "deepseek-v4-flash",
  "contextWindowTokens": 1000000,
  "reasoning": {
    "effortLevels": ["low", "high", "xhigh", "max"],
    "defaultEffort": "xhigh",
  },
  "providerOptions": { "allowed_openai_params": ["reasoning_effort"] },
}
```

By default, LiteLLM forwards `reasoning_effort` only when the provider prefix
in the model's `litellm_params.model` lists it among its supported parameters.
The `hosted_vllm/` prefix does; a vLLM server routed through another prefix,
such as the generic `openai/` one, may not. With the proxy's `drop_params`
enabled, an unsupported field is discarded without an error, so every level
behaves the same. The fix belongs in the proxy: route the model through
`hosted_vllm/`.
Where you cannot change the proxy, `allowed_openai_params` tells LiteLLM to
forward the field for that request; the Chat Completions client copies an
unrecognized `providerOptions` key into the request body as written.

To find a model's values and confirm they arrive, send one request with a value
its template does not accept. A template that validates effort answers with an
error naming the values it accepts; a request that succeeds instead means the
field never reached the template. A template that ignores unknown values cannot
be checked this way.

A template's effort values rarely include one that turns thinking off. That
switch is usually a separate chat-template argument, such as
`chat_template_kwargs.enable_thinking: false`, set in `providerOptions` on a
separate model entry.
