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
- When using tools, proceed directly with tool calls. Save explanations for the attempt_completion summary. Both attempt_completion and plan_mode_respond display to the user as assistant messages, so include your message content within the tool call itself rather than duplicating it outside."
