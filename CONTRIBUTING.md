# Contributing to SembleOps

Thanks for helping improve SembleOps. Contributions are welcome for bug fixes, security hardening, documentation, tests, accessibility, adapters, and focused product improvements.

## Ways to contribute

Code is only one contribution path. Helpful contributions include:

- reproducing and narrowing a reported bug;
- improving setup, deployment, backup, or troubleshooting documentation;
- adding tests for security boundaries and failure recovery;
- reviewing accessibility, keyboard navigation, and reduced-motion behavior;
- testing on another operating system or deployment platform;
- proposing a focused runtime or notification adapter;
- reviewing pull requests and helping another contributor verify a fix.

New contributors should read the [community guide](docs/community.md). Look for issues labeled `good first issue` or `help wanted` when those labels are available, or ask which small problem is ready to be claimed.

## Where work happens

- **Community Discord:** informal conversation, demos, and early idea-shaping. Chat is not the permanent project record.
- **GitHub issues:** reproducible bugs, accepted feature scopes, and actionable documentation work.
- **GitHub pull requests:** reviewable changes connected to a defined problem.
- **Private security reports:** suspected vulnerabilities or disclosures containing sensitive details.

When a useful decision happens in Discord, summarize it in the relevant GitHub issue before implementation. Contributors should be able to understand a change without joining a private or external conversation.

## Before starting

- Search existing issues and pull requests first.
- Open an issue before a large architectural change so maintainers and contributors can align on scope.
- Keep the single-operator, self-hosted trust model explicit. A change that turns SembleOps into a multi-user service needs a separate design and threat-model review.
- Never include real API keys, user data, private prompts, database files, personal profile assets, machine-specific paths, or employer/customer information in an issue, fixture, screenshot, commit, or pull request.
- Do not assume that commenting on or claiming an issue reserves it indefinitely. Maintainers may reassign inactive work so another contributor can proceed.

Security vulnerabilities must follow [SECURITY.md](SECURITY.md), not the public issue tracker.

## Development setup

SembleOps requires Node.js 22 or newer.

```sh
npm ci
cp .env.example .env
cp config/sembleops.example.yaml config/sembleops.yaml
npm run migrate
npm run dev
```

Use fake values and temporary data for development. The web interface can run without Discord credentials. AI-backed behavior requires your own API key or an authenticated supported CLI.

Before submitting a change, run:

```sh
npm run typecheck
npm run test --if-present
npm run build
npm audit --omit=dev --audit-level=high
```

Add or update tests for behavior changes. Update the example configuration and public documentation when introducing a setting, credential, provider, network route, stored field, or trust-boundary change.

## Pull requests

Keep each pull request focused. In its description, include:

- the problem and intended outcome;
- the security, privacy, migration, and cost impact;
- how the change was tested;
- screenshots for visible interface changes, using synthetic data only;
- any follow-up work or known limitations.

Maintainers may ask for changes to preserve backward compatibility, keep provider costs operator-controlled, or reduce access to secrets and local files.

Submission does not guarantee acceptance or a particular review timeline. Maintainers may defer or decline work that is out of scope, duplicates another approach, changes the trust model, creates unsustainable maintenance cost, or cannot be reviewed safely. See [GOVERNANCE.md](GOVERNANCE.md) for decision-making and project roles.

## AI-assisted contributions

AI-assisted contributions are welcome when the human contributor remains accountable for the result.

- Review and understand every submitted change.
- Run the required checks and add meaningful tests.
- Do not send project secrets, private user data, proprietary code, or embargoed vulnerability details to an AI service.
- Verify licenses and provenance for generated code, text, fixtures, and assets.
- Briefly disclose material AI assistance in the pull request, including which parts were assisted and how they were verified.

Maintainers may request a smaller change or additional explanation when a submission is too large or opaque to review confidently.

## Developer Certificate of Origin

This project uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/) instead of a contributor license agreement. Every commit must include a `Signed-off-by` line certifying that you have the right to submit the contribution under this project's license.

```sh
git commit -s -m "Describe the change"
```

The sign-off uses the name and email configured for Git commits:

```text
Signed-off-by: Contributor Name <contributor@example.com>
```

By signing off, you certify the DCO. This is not a cryptographic signature. If you did not create all of the submitted material, confirm that each dependency, snippet, fixture, and asset can legally be contributed under its applicable license and record required attribution.

## Contribution license

Unless you explicitly mark a communication as "Not a Contribution," intentionally submitted contributions are licensed under Apache-2.0 as described in section 5 of [LICENSE](LICENSE).

## Conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
