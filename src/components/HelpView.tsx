import { useKeyboard } from "@opentui/react";
import type { AppContext } from "../App.js";
import { t } from "../theme.js";

interface Props {
  context: AppContext;
}

export function HelpView({ context }: Props) {
  useKeyboard(() => {
    context.navigateTo("home");
  });

  return (
    <box flexDirection="column" width="100%" padding={1}>
      <box flexDirection="row" marginBottom={2}>
        <text fg={t.accent}>/help</text>
        <text fg={t.fg.secondary}> - ClawControl Help</text>
      </box>

      {/* Overview */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor={t.border.focus}
        padding={1}
        marginBottom={1}
      >
        <text fg={t.accent}>What is ClawControl?</text>
        <text fg={t.fg.primary} marginTop={1}>
          ClawControl is a CLI tool that simplifies deploying OpenClaw instances
          to cloud providers. It handles all the complex setup including VPS
          provisioning, Node.js installation, OpenClaw configuration, and
          Tailscale VPN setup.
        </text>
      </box>

      {/* Commands */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor={t.border.default}
        padding={1}
        marginBottom={1}
      >
        <text fg={t.fg.primary}>Available Commands</text>

        <box flexDirection="column" marginTop={1}>
          <box flexDirection="row">
            <text fg={t.accent} width={12}>/new</text>
            <text fg={t.fg.primary}>Initialize a new deployment configuration</text>
          </box>
          <text fg={t.fg.secondary}>            Creates deployment config in ~/.clawcontrol/deployments/</text>

          <box flexDirection="row" marginTop={1}>
            <text fg={t.accent} width={12}>/deploy</text>
            <text fg={t.fg.primary}>Deploy a configured instance to the cloud</text>
          </box>
          <text fg={t.fg.secondary}>            Provisions VPS, installs dependencies, configures OpenClaw</text>

          <box flexDirection="row" marginTop={1}>
            <text fg={t.accent} width={12}>/status</text>
            <text fg={t.fg.primary}>View status of all deployments</text>
          </box>
          <text fg={t.fg.secondary}>            Shows deployment state, health checks, and connection info</text>

          <box flexDirection="row" marginTop={1}>
            <text fg={t.accent} width={12}>/ssh</text>
            <text fg={t.fg.primary}>SSH into a deployed instance</text>
          </box>
          <text fg={t.fg.secondary}>            Opens interactive SSH session to your server</text>

          <box flexDirection="row" marginTop={1}>
            <text fg={t.accent} width={12}>/logs</text>
            <text fg={t.fg.primary}>View OpenClaw logs from a deployment</text>
          </box>
          <text fg={t.fg.secondary}>            Streams logs from journalctl with auto-refresh option</text>

          <box flexDirection="row" marginTop={1}>
            <text fg={t.status.error} width={12}>/destroy</text>
            <text fg={t.fg.primary}>Permanently delete a deployment</text>
          </box>
          <text fg={t.fg.secondary}>            Deletes VPS, SSH keys, and local configuration</text>
        </box>
      </box>

      {/* Workflow */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor={t.border.default}
        padding={1}
        marginBottom={1}
      >
        <text fg={t.status.success}>Typical Workflow</text>
        <text fg={t.fg.primary} marginTop={1}>1. Run /new to create a deployment config</text>
        <text fg={t.fg.primary}>2. Run /deploy to deploy to the cloud</text>
        <text fg={t.fg.primary}>3. Authenticate Tailscale when prompted</text>
        <text fg={t.fg.primary}>4. Complete OpenClaw onboarding via SSH</text>
        <text fg={t.fg.primary}>5. Use /status and /logs to monitor</text>
      </box>

      {/* Supported Providers */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor={t.border.default}
        padding={1}
        marginBottom={1}
      >
        <text fg={t.fg.primary}>Supported Cloud Providers</text>
        <box flexDirection="row" marginTop={1}>
          <text fg={t.status.success}>✓ </text>
          <text fg={t.fg.primary}>Hetzner Cloud - ~$4.99/mo for CPX11 (US East)</text>
        </box>
        <box flexDirection="row">
          <text fg={t.fg.muted}>○ </text>
          <text fg={t.fg.secondary}>DigitalOcean - Coming soon</text>
        </box>
        <box flexDirection="row">
          <text fg={t.fg.muted}>○ </text>
          <text fg={t.fg.secondary}>Vultr - Coming soon</text>
        </box>
      </box>

      {/* Links */}
      <box flexDirection="column" marginBottom={1}>
        <text fg={t.fg.primary}>Useful Links</text>
        <text fg={t.fg.secondary}>• OpenClaw Docs: https://docs.openclaw.ai/</text>
        <text fg={t.fg.secondary}>• Hetzner API: https://docs.hetzner.cloud/</text>
        <text fg={t.fg.secondary}>• Tailscale: https://tailscale.com/</text>
      </box>

      <text fg={t.fg.muted}>Press any key to return to home</text>
    </box>
  );
}
