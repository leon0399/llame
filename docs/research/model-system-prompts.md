# Model system prompt research provenance

The public [`system_prompts_leaks`](https://github.com/asgeirtj/system_prompts_leaks)
corpus was used only as comparative research provenance while defining llame's
model-specific prompt architecture.

No prompt body from that corpus is copied into llame's runtime assets. The
shipped default is a deliberately moderate, project-owned baseline; concrete
production-grade per-model prompt authoring and evaluation remain follow-up
work.
