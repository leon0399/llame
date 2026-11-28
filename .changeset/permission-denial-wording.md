---
"api": patch
---

- The fixed `permission_denied` messages for a matched reject, a missing allow, a refused redirect hop, a refused host address, and the read-only ceiling now permit the model to pursue the same goal through other permitted tools in reasonable ways that respect the intent of the denial. They forbid only retry, delegation, and misuse of a permitted tool to carry out the rejected action, and they direct the model to finish the remaining work and then stop and explain an essential blocked step to the user, who can adjust the permission rules. The `invalid_field` and `input_limit` messages are unchanged.
