# Architecture Decision Records

One file per decision, numbered in the order the decision was taken. A record is
immutable once `Accepted`: to change a decision, add a new ADR and set the old one to
`Superseded by ADR-NNNN`.

| ADR                                        | Decision                                  | Status   |
| ------------------------------------------ | ----------------------------------------- | -------- |
| [0001](0001-modular-monolith.md)           | Modular monolith over microservices       | Accepted |
| [0002](0002-session-transport.md)          | Signed JWT in an HTTP-only session cookie | Accepted |
| [0003](0003-identifier-strategy.md)        | UUID surrogate keys + allocated refs      | Accepted |
| [0004](0004-deployment-model.md)           | Single-host Docker Compose deployment     | Accepted |
| [0005](0005-custody-acceptance-on-the-route-row.md) | Custody acceptance on the route, not the status | Accepted |
| [0006](0006-director-role-signing-authority.md) | Signing authority is its own role         | Accepted |

**Template**

```markdown
# ADR-NNNN: <title>

- Status: Proposed | Accepted | Superseded by ADR-NNNN
- Date: YYYY-MM-DD
- Deciders: <roles>

## Context

## Decision

## Consequences

## Alternatives considered
```
