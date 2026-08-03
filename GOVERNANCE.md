# Governance

SembleOps is a maintainer-led, community-informed open source project. Community feedback shapes priorities and implementation, while maintainers remain responsible for the project's security posture, scope, releases, and long-term maintainability.

## Project principles

Decisions should preserve these foundations unless a separately reviewed architecture explicitly replaces them:

- self-hosted and bring-your-own credentials;
- single-operator trust model;
- no maintainer-operated hosted service or shared API budget;
- deterministic task state around fallible model behavior;
- explicit security, privacy, data, and provider-cost boundaries;
- reviewable changes that can be maintained by a small community.

The [roadmap](docs/roadmap.md) communicates direction, not a promise of delivery, staffing, support, or backward compatibility during early releases.

## Roles

### Community members

Anyone may use the project, participate in public conversations, report problems, or suggest improvements while following the Code of Conduct.

### Contributors

Contributors submit issues, documentation, tests, reviews, designs, or code. A merged contribution does not grant repository permissions or create an employment, partnership, support, or ownership relationship.

### Reviewers and triagers

Trusted contributors may be invited to help reproduce issues, organize reports, review focused changes, and support community conversations. Access is granted gradually and may be limited to the minimum permissions needed.

### Maintainers

Maintainers set release scope, merge or reject changes, manage security reports, moderate project spaces, and appoint or remove project roles. Maintainer status is based on sustained high-quality participation, sound security and privacy judgment, respectful collaboration, and available capacity—not contribution count alone.

## Decision-making

Routine fixes are decided through issue and pull-request review. Significant changes should begin with a public proposal covering the user problem, alternatives, compatibility, migrations, security and privacy impact, provider cost, and maintenance burden.

Maintainers seek rough consensus, but consensus is not unanimity. When tradeoffs remain, maintainers make the final decision and should record the reasoning in GitHub. They may defer or reject changes that conflict with project scope, introduce unacceptable risk, lack a sustainable owner, or are too broad to review safely.

Discord and other chat spaces are useful for exploration, but decisions become durable only when summarized on GitHub. No contributor should need access to a private conversation to understand why a project decision was made.

## Releases and compatibility

Maintainers decide when a release is ready. Early releases may include breaking configuration, API, or database changes. Release notes should identify migrations, security changes, new credentials, changed network routes, stored-data changes, and provider-cost implications.

## Conduct and removal

All roles remain subject to [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md), and repository security controls. Permissions may be reduced or removed for inactivity, compromised accounts, unsafe changes, confidentiality violations, or conduct problems. Whenever practical, maintainers should communicate the reason privately and preserve the safety of reporters and users.

## Changes to governance

Governance changes should be proposed through a pull request with a clear rationale. Maintainers may update this document as the community grows, while preserving prior license grants and contributor attribution.
