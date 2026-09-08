# Tests

Per `docs/testing.md`. Check that the test fails without the change it covers, sits at the
right level, and asserts behavior at a real seam rather than on mocks threaded through the
interior. Flag any silently skipped DB-backed suite — those must fail loudly when Postgres
is absent — and any assertion weakened to make a flake pass. A change touching data, auth,
or tenancy needs a negative test proving cross-tenant access is denied.

Tautological tests are a blocking finding (`docs/testing.md` rule 11). Report a test that
asserts a mock returns what the same test configured it to return; recomputes the expected
value using the implementation's own expression rather than an independently known one;
asserts only `toHaveBeenCalled()` where the behavior under test is what the call produces;
or snapshots current output with no independent notion of correct. State which change to
the implementation would leave the test green — that is the evidence.

Importing a constant into a test is not by itself a finding. An assertion that states an
invariant over it (`expect(len).toBeLessThanOrEqual(MAX)`) is real and holds at any value.
Report it only when the expectation recomputes the implementation's own derivation
(`toBe(Math.floor(window * RATIO))`) or iterates the implementation's own array, AND no
test in that file pins the constant against a literal. Where such a literal anchor exists,
other tests in the file may compose with the constant freely.
