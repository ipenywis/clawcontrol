import { useKeyboard } from "@opentui/react";
import type { AppContext } from "../App.js";

interface Props {
  context: AppContext;
}

export function HelpView({ context }: Props) {
  useKeyboard(() => {
    context.navigateTo("home");
  });

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      <box flexDirection="row" marginBottom={2}>
        <text fg="cyan">/help</text>
        <text fg="gray"> - ClawControl Help</text>
      </box>

      {/* Overview */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor="cyan"
        padding={1}
        marginBottom={1}
      >
        <text fg="cyan">What is ClawControl?</text>
        <text fg="white" marginTop={1}>
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
        borderColor="gray"
        padding={1}
        marginBottom={1}
      >
        <text fg="white">Available Commands</text>

        <box flexDirection="column" marginTop={1}>
          <box flexDirection="row">
            <text fg="yellow" width={12}>/new</text>
            <text fg="white">Initialize a new deployment configuration</text>
          </box>
          <text fg="gray">            Creates deployment config in ~/.clawcontrol/deployments/</text>

          <box flexDirection="row" marginTop={1}>
            <text fg="yellow" width={12}>/deploy</text>
            <text fg="white">Deploy a configured instance to the cloud</text>
          </box>
          <text fg="gray">            Provisions VPS, installs dependencies, configures OpenClaw</text>

          <box flexDirection="row" marginTop={1}>
            <text fg="yellow" width={12}>/status</text>
            <text fg="white">View status of all deployments</text>
          </box>
          <text fg="gray">            Shows deployment state, health checks, and connection info</text>

          <box flexDirection="row" marginTop={1}>
            <text fg="yellow" width={12}>/ssh</text>
            <text fg="white">SSH into a deployed instance</text>
          </box>
          <text fg="gray">            Opens interactive SSH session to your server</text>

          <box flexDirection="row" marginTop={1}>
            <text fg="yellow" width={12}>/logs</text>
            <text fg="white">View OpenClaw logs from a deployment</text>
          </box>
          <text fg="gray">            Streams logs from journalctl with auto-refresh option</text>

          <box flexDirection="row" marginTop={1}>
            <text fg="red" width={12}>/destroy</text>
            <text fg="white">Permanently delete a deployment</text>
          </box>
          <text fg="gray">            Deletes VPS, SSH keys, and local configuration</text>
        </box>
      </box>

      {/* Workflow */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor="green"
        padding={1}
        marginBottom={1}
      >
        <text fg="green">Typical Workflow</text>
        <text fg="white" marginTop={1}>1. Run /new to create a deployment config</text>
        <text fg="white">2. Run /deploy to deploy to the cloud</text>
        <text fg="white">3. Authenticate Tailscale when prompted</text>
        <text fg="white">4. Complete OpenClaw onboarding via SSH</text>
        <text fg="white">5. Use /status and /logs to monitor</text>
      </box>

      {/* Supported Providers */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        padding={1}
        marginBottom={1}
      >
        <text fg="white">Supported Cloud Providers</text>
        <box flexDirection="row" marginTop={1}>
          <text fg="green">✓ </text>
          <text fg="white">Hetzner Cloud - ~$4.99/mo for CPX11 (US East)</text>
        </box>
        <box flexDirection="row">
          <text fg="yellow">○ </text>
          <text fg="gray">DigitalOcean - Coming soon</text>
        </box>
        <box flexDirection="row">
          <text fg="yellow">○ </text>
          <text fg="gray">Vultr - Coming soon</text>
        </box>
      </box>

      {/* Links */}
      <box flexDirection="column" marginBottom={1}>
        <text fg="white">Useful Links</text>
        <text fg="blue">• OpenClaw Docs: https://docs.openclaw.ai/</text>
        <text fg="blue">• Hetzner API: https://docs.hetzner.cloud/</text>
        <text fg="blue">• Tailscale: https://tailscale.com/</text>
      </box>

      <text fg="yellow">Press any key to return to home</text>
    </box>
  );
}
