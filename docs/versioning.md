# Versioning

Stateless endpoint *must* emit the version, it allows for knowledge which code version did produce specific output.

We must remember about local dev workflow here. While doing changes in code, developer will play around with an agent too. The local versions must be different from production ones.

We want sth simple to start with. That's why we picked a manifest schema with `version` and `environment` to start with. You can add `metadata` too if you want. `version` is official "number", whereas `environment` is like `dev` or `dev.{author}` depending on workflow. It's up to the developers what naming convention they want to take. `version` + `environment` is THE ACTUAL version, the pairs are unique.

