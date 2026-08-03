# SembleOps

SembleOps is a self-hosted, single-operator workspace for capturing commitments, scheduling reminders, routing work to specialized AI agents, and reviewing their output in one place.

You run the software and bring your own credentials. API and hosting charges go directly to the providers you choose; this project does not operate a hosted service, proxy requests through a shared account, or include paid usage.

> [!IMPORTANT]
> SembleOps is designed for one trusted operator. It is not a public, multi-user SaaS and does not provide tenant isolation, user accounts, role-based access control, quotas, or abuse prevention. Do not expose it directly to the internet without the controls in [the deployment guide](docs/deployment.md).

## What it does

- Captures and tracks commitments with due dates, reminders, snoozes, and explicit resolution.
- Provides a local web interface and an optional Discord bot.
- Routes requests to configurable specialist personas.
- Uses a deterministic scheduler for reminders and lifecycle state; model failures do not define task state.
- Runs read-only AI work through an OpenAI API key or supported local CLI runtimes.
- Can delegate coding work to a worker that runs against repositories you explicitly place under its configured projects root.
- Stores operational state in a local SQLite database.

The default persona names and prompts are examples. Edit [`config/personas.yaml`](config/personas.yaml) to suit your workflow.

## Requirements

- Node.js 22 or newer
- npm
- At least one supported AI runtime for agent work:
  - an `OPENAI_API_KEY` billed to your OpenAI account, or
  - an authenticated Codex or Claude Code CLI installation
- Optional: a Discord application and bot token
- Optional: Docker for container deployment

The task tracker and web interface can start without an AI runtime. Model-backed delegation is disabled when no configured runtime is available.

## Quick start

```sh
npm ci
cp .env.example .env
cp config/sembleops.example.yaml config/sembleops.yaml
```

On PowerShell, use `Copy-Item` instead of `cp` if aliases are disabled.

Open `config/sembleops.yaml` and set:

- your IANA timezone, such as `Europe/Berlin`;
- quiet hours and briefing times;
- `coding.projects_root` to an absolute directory containing only repositories you trust SembleOps to access;
- the runtimes you have installed or configured.

Then add only the credentials you intend to use to `.env`. The most common setup is:

```dotenv
OPENAI_API_KEY=your-own-openai-api-key
```

Initialize the database and start the application:

```sh
npm run migrate
npm run dev
```

Open `http://127.0.0.1:4747`. The default example config binds only to loopback. Keep it that way for a first run.

### Optional Discord setup

Create a private Discord application and add these values to `.env`:

```dotenv
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_OWNER_USER_ID=your-discord-user-id
```

Without both values, the Discord integration stays disabled and the web interface remains usable.

### Optional local CLI runtimes

Install and authenticate the CLI outside SembleOps, then list its runtime in `config/sembleops.yaml`. SembleOps invokes the CLI as the current operating-system user. A coding delegation may modify files inside the selected project, so use a dedicated low-privilege account, a disposable VM, or another isolation boundary for repositories you do not fully trust.

## Bring-your-own cost model

SembleOps never supplies or resells model access. Each self-hoster controls:

- provider accounts and API keys;
- enabled models and CLI subscriptions;
- cloud, VPS, domain, and backup costs;
- Discord configuration;
- data retention and deletion.

Provider usage is governed by that provider's terms and billing. Set provider-side budgets and alerts before enabling unattended work; the application does not enforce a provider billing cap.

## Deployment choices

- **Local-only:** simplest and safest; the hub, browser, database, and optional coding runtime run on one trusted machine.
- **Private remote hub:** run one hub behind HTTPS and an access token, then optionally connect an outbound-only worker from the machine that holds code repositories.

See [Deployment](docs/deployment.md) before binding to a non-loopback interface. SQLite deployments must run a single hub instance.

## Community and contributing

SembleOps welcomes contributions from users of every experience level. You do not need to write application code to help: reproducible bug reports, documentation fixes, accessibility reviews, tests, deployment notes, and careful issue triage are all valuable.

- Use the community Discord for informal conversation, demos, and early idea-shaping. Never post credentials, private prompts, task data, logs containing secrets, or proprietary repository content.
- Use GitHub issues for reproducible bugs and scoped work. Decisions made in chat should be summarized on GitHub so contributors who are not in Discord can participate.
- Open an issue before investing in a large feature or architecture change.
- Report vulnerabilities privately through the repository Security page, never in Discord or a public issue.

Start with the [community guide](docs/community.md), then read [CONTRIBUTING.md](CONTRIBUTING.md) and [GOVERNANCE.md](GOVERNANCE.md). Participation in every project space, including an official community Discord, is governed by [the Code of Conduct](CODE_OF_CONDUCT.md).

## Security and privacy

The database may contain task text, prompts, model output, Discord identifiers, and operational metadata. Agent prompts or results may also contain content from code repositories. Review:

- [Threat model](docs/threat-model.md)
- [Data and privacy](docs/data-and-privacy.md)
- [Security policy](SECURITY.md)

Never commit `.env`, `config/sembleops.yaml`, databases, transcripts, artifacts, or backups. Treat all model output and externally sourced text as untrusted.

## Documentation

- [Architecture](docs/architecture.md)
- [Deployment](docs/deployment.md)
- [Data and privacy](docs/data-and-privacy.md)
- [Threat model](docs/threat-model.md)
- [Roadmap](docs/roadmap.md)
- [Community guide](docs/community.md)
- [Governance](GOVERNANCE.md)
- [Maintainer guide](docs/maintainer-guide.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)

## Project status

SembleOps is experimental self-hosted software. Interfaces, configuration, and database migrations may change between early releases. Back up the data directory before upgrading and test restores periodically.

## License

SembleOps is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for scope and third-party notices, and [TRADEMARKS.md](TRADEMARKS.md) for naming guidance. The software is provided without warranties or a hosted-service commitment.
