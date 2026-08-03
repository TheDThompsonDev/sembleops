# Roadmap

SembleOps is an experimental, community-driven self-hosted project. This roadmap communicates broad priorities, not dates, staffing commitments, or a promise that any item will ship.

## Current foundation

- Single-operator web interface and optional Discord capture.
- Deterministic task state, scheduling, reminders, and delivery history.
- SQLite persistence and ordered migrations.
- Configurable personas and multiple runtime adapters.
- Agent delegation, review packets, and optional verification chains.
- Local coding execution or an outbound remote-worker topology.
- Bring-your-own model, CLI, Discord, and infrastructure credentials.

## Near-term priorities

- Expand authentication, cookie, request-forgery, and authorization regression tests.
- Strengthen canonical path and symlink/junction containment tests across platforms.
- Improve interrupted-job leases, timeout recovery, idempotency, and retry visibility.
- Add documented backup, restore, export, and deletion tooling.
- Improve accessibility, keyboard navigation, responsive layout, and reduced-motion support.
- Add provider-neutral runtime configuration without silently changing cost or data boundaries.
- Make budgets, provider errors, and offline runtime behavior easier to understand.
- Establish reproducible releases, changelogs, and migration notes.

## Later possibilities

- Optional encrypted-at-rest storage patterns and secret-manager integrations.
- Additional notification adapters with narrowly scoped credentials.
- Better local-only transcription and model paths.
- Extension interfaces for community-maintained agents and connectors.
- Import/export formats that do not require direct SQLite access.

## Non-goals for the current architecture

- A maintainer-operated hosted service or shared pool of API credits.
- Public signup, multi-tenant hosting, or organization-wide authorization.
- Fully autonomous publishing, purchasing, deployment, or destructive actions.
- Treating model output as verified truth.

Proposals that change these non-goals need a separate architecture and threat model rather than an incremental configuration flag.

## Suggesting work

Open a focused issue describing the user problem, trust-boundary impact, provider/cost implications, and a small acceptance test. See the [community guide](community.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) before proposing a large change.
