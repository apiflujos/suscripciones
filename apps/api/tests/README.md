# Testing scaffold

Minimal test strategy:

- Unit tests in `src/lib/__tests__` using `node --test --loader tsx`
- API smoke tests in `src/__tests__` with `supertest`

Run:

```bash
npm -w apps/api test
```

Next steps:
- Add DB-backed integration tests with a test database.
- Add admin UI tests with Playwright (if needed).
