# Agent Notes

## Validation

- Prefer `pnpm run lint` as the primary validation step (typecheck/compile coverage via tooling).
- Avoid running `pnpm dev` unless explicitly requested.

## Codebase Conventions

- Prefer importing shared values from `src/constants.ts`; avoid passing constant values around.
- Prefer raw functions over classes.
- Manage state via Jotai atoms.
- Prefer locality of behaviour.
- Avoid “clean-code” style getters/setters.
- Always use typed messages when communicating between web workers.
- Never use the `any` type.
- To fix linting errors use `pnpm format`
