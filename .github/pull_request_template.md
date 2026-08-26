**What this changes, and why**

**How you know it works**

- [ ] `./gate.sh` is green
- [ ] Tests cover the behaviour that changed — and fail without the change

**If it touches `service/`**

That layer compiles unchanged into a browser and into React Native. The lint
step enforces the rest, but worth a thought: no `node:` imports, no DOM, no
clock, no network.

**If it touches the agent or a prompt**

Which model did you try it against? Small local models are the primary target
and they fail differently from large ones.
