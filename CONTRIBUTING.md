# Contributing to UltraCC

Thanks for your interest in contributing.

## Reporting bugs

Open an issue and include what you did, what you expected, what happened, and
which page it occurred on. Do not include student data, credentials, or tokens.

## Pull requests

- Keep changes focused, and preserve existing behaviour unless changing it is
  the point of the change.
- Respect the authentication boundary: VTOP and Moodle traffic stays inside the
  edge functions. The browser never talks to university or upstream hosts
  directly (enforced by `src/lib/__tests__/upstreamIsolation.test.ts`).
- Do not fabricate university data. Where a source has no data, show that
  honestly instead.
- Add or update tests for meaningful logic.

## Validation

Run these before opening a pull request:

```bash
npm run typecheck
npm test
npm run build
```

## License

By contributing you agree that your work is licensed under the project's MIT
license.
