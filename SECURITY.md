# Security Policy

## Reporting a vulnerability

Please do not report security issues in the public issue tracker.

Use GitHub's private **Report a vulnerability** flow (Security → Advisories)
so the report stays private, or contact the maintainer directly.

Include a short description and a minimal reproduction. Do not include real
student data, credentials, tokens, or session cookies.

## Supported scope

- The browser app and its Supabase edge functions.
- Authentication and session handling for VTOP and LMS.
- Any path that could expose a student's data or credentials.

Out of scope: VTOP and other third-party services themselves, which are
operated by their owners (see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)).
