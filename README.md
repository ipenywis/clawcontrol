# ClawControl

ClawControl is a CLI/TUI that deploys and manages OpenClaw on VPS providers. It guides you through provisioning, installs dependencies, configures OpenClaw, and secures access with Tailscale.

Quick start: run `clawcontrol`, then use `/new`, `/deploy`, and `/status`.

## Intro

ClawControl makes OpenClaw setup repeatable and fast. It handles VPS provisioning, SSH setup, Node and pnpm installs, OpenClaw configuration, and Tailscale onboarding so you can focus on running your agent.

## Installation

One-liner (Linux / macOS):

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

One-liner (Windows PowerShell):

```powershell
irm https://openclaw.ai/install.ps1 | iex
```

Package managers (Bun must be installed — the install scripts handle this automatically):

```bash
bun add -g clawcontrol
```

```bash
npm install -g clawcontrol
```

```bash
pnpm add -g clawcontrol
```

> **Note:** ClawControl requires the [Bun](https://bun.sh) runtime. If you install manually with npm or pnpm, make sure Bun is also installed (`curl -fsSL https://bun.sh/install | bash`).

After install:

```
clawcontrol
```

## Features

- Guided deployments with a CLI/TUI workflow and command palette (`/new`, `/deploy`, `/status`, `/ssh`, `/logs`, `/destroy`, `/templates`, `/help`).
- Cloud providers: Hetzner and DigitalOcean supported, Vultr planned.
- Template system with built-in presets and forkable/custom templates.
- Automated provisioning steps: SSH keys, swap, system updates, Node/NVM, pnpm, Chrome, OpenClaw, Tailscale, and daemon setup.
- Day-2 management: status dashboards, log streaming, SSH access, and safe teardown.

## Development

Prerequisites:

- [Bun](https://bun.sh) (runtime for the CLI)
- Node.js >= 20
- pnpm 10.25.x

Setup:

```
pnpm install
```

Run locally:

```
pnpm dev
```

Build:

```
pnpm build
```

Typecheck:

```
pnpm typecheck
```

Tests:

```
pnpm test
```

## Built by Islem

Built by Islem — https://x.com/ipenywis
