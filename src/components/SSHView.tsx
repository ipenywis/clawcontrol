import { useState, useEffect, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import type { AppContext } from "../App.js";
import { connectToDeployment, type SSHConnection } from "../services/ssh.js";
import type { ClientChannel } from "ssh2";

interface Props {
  context: AppContext;
}

type ViewState = "selecting" | "connecting" | "connected" | "error";

export function SSHView({ context }: Props) {
  const [viewState, setViewState] = useState<ViewState>("selecting");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");

  const sshRef = useRef<SSHConnection | null>(null);
  const shellRef = useRef<ClientChannel | null>(null);

  const deployedDeployments = context.deployments.filter(
    (d) => d.state.status === "deployed" && d.state.serverIp
  );

  useEffect(() => {
    return () => {
      if (shellRef.current) {
        shellRef.current.end();
      }
      if (sshRef.current?.isConnected()) {
        sshRef.current.disconnect();
      }
    };
  }, []);

  const connectToServer = async (deploymentName: string, serverIp: string) => {
    setViewState("connecting");
    setOutput([`Connecting to ${serverIp}...`]);

    try {
      const ssh = await connectToDeployment(deploymentName, serverIp);
      sshRef.current = ssh;

      const shell = await ssh.shell();
      shellRef.current = shell;

      shell.on("data", (data: Buffer) => {
        const text = data.toString();
        setOutput((prev) => [...prev.slice(-500), ...text.split("\n")]);
      });

      shell.on("close", () => {
        setOutput((prev) => [...prev, "\n[Connection closed]"]);
        setViewState("selecting");
      });

      setViewState("connected");
      setOutput((prev) => [...prev, "Connected! Type commands below.\n"]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setViewState("error");
    }
  };

  const sendCommand = (command: string) => {
    if (shellRef.current) {
      shellRef.current.write(command + "\n");
    }
  };

  const disconnect = () => {
    if (shellRef.current) {
      shellRef.current.end();
      shellRef.current = null;
    }
    if (sshRef.current?.isConnected()) {
      sshRef.current.disconnect();
      sshRef.current = null;
    }
    setViewState("selecting");
    setOutput([]);
  };

  const selectedDeployment = deployedDeployments[selectedIndex];

  // Handle keyboard events for non-connected states
  useKeyboard((key) => {
    if (deployedDeployments.length === 0) {
      context.navigateTo("home");
      return;
    }

    if (viewState === "selecting") {
      if (key.name === "up" && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      } else if (key.name === "down" && selectedIndex < deployedDeployments.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      } else if (key.name === "return") {
        connectToServer(selectedDeployment.config.name, selectedDeployment.state.serverIp!);
      } else if (key.name === "escape") {
        context.navigateTo("home");
      }
    } else if (viewState === "error") {
      setViewState("selecting");
      setError(null);
    }
  });

  if (deployedDeployments.length === 0) {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="cyan">/ssh</text>
          <text fg="gray"> - SSH into deployment</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="yellow"
          padding={1}
        >
          <text fg="yellow">No deployed instances found!</text>
          <text fg="gray" marginTop={1}>Deploy an instance first with /deploy</text>
        </box>

        <text fg="yellow" marginTop={2}>Press any key to return to home</text>
      </box>
    );
  }

  if (viewState === "selecting") {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="cyan">/ssh</text>
          <text fg="gray"> - Select a deployment to connect</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          padding={1}
        >
          {deployedDeployments.map((deployment, index) => {
            const isSelected = index === selectedIndex;

            return (
              <box
                key={deployment.config.name}
                flexDirection="row"
                backgroundColor={isSelected ? "blue" : undefined}
              >
                <text fg={isSelected ? "white" : "gray"}>
                  {isSelected ? "> " : "  "}
                </text>
                <text fg={isSelected ? "white" : "gray"} width={25}>
                  {deployment.config.name}
                </text>
                <text fg="cyan">{deployment.state.serverIp}</text>
              </box>
            );
          })}
        </box>

        <text fg="gray" marginTop={2}>Arrow keys to select | Enter to connect | Esc to go back</text>
      </box>
    );
  }

  if (viewState === "connecting") {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <text fg="cyan">Connecting...</text>
        <text fg="yellow" marginTop={1}>
          {output[output.length - 1] || "Establishing SSH connection..."}
        </text>
      </box>
    );
  }

  if (viewState === "error") {
    return (
      <box flexDirection="column" width="100%" height="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg="red">Connection Error</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor="red"
          padding={1}
        >
          <text fg="red">{error}</text>
        </box>

        <text fg="yellow" marginTop={2}>Press any key to go back</text>
      </box>
    );
  }

  // Connected state - need input for SSH commands
  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      <box flexDirection="row" marginBottom={1}>
        <text fg="green">SSH Connected</text>
        <text fg="gray"> | Ctrl+D to disconnect</text>
      </box>

      {/* Terminal output */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        padding={1}
        flexGrow={1}
        overflow="hidden"
      >
        <box flexDirection="column">
          {output.slice(-20).map((line, i) => (
            <text key={i} fg="white">{line}</text>
          ))}
        </box>
      </box>

      {/* Command input */}
      <text fg="green" marginTop={1}>$ Command:</text>
      <input
        value={inputValue}
        focused
        onInput={(value) => setInputValue(value)}
        onSubmit={(value) => {
          sendCommand(value);
          setInputValue("");
        }}
        onKeyDown={(e) => {
          if (e.ctrl && e.name === "d") {
            disconnect();
          } else if (e.ctrl && e.name === "c") {
            if (shellRef.current) {
              shellRef.current.write("\x03");
            }
          }
        }}
      />
    </box>
  );
}
