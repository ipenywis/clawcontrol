import { useState, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import type { AppContext } from "../App.js";
import type { Deployment } from "../types/index.js";
import { deleteDeployment } from "../services/config.js";
import { PROVIDER_NAMES } from "../providers/index.js";
import { t, statusColor } from "../theme.js";

interface Props {
  context: AppContext;
}

type ViewState = "listing" | "detail" | "delete_confirm" | "deleting" | "success" | "error";

export function ListView({ context }: Props) {
  const [viewState, setViewState] = useState<ViewState>("listing");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deletedName, setDeletedName] = useState("");

  const deployments = context.deployments;
  const selectedDeployment: Deployment | undefined = deployments[selectedIndex];

  const stateRef = useRef({ viewState, selectedIndex });
  stateRef.current = { viewState, selectedIndex };

  useKeyboard((key) => {
    const current = stateRef.current;

    if (deployments.length === 0) {
      context.navigateTo("home");
      return;
    }

    if (current.viewState === "listing") {
      if (key.name === "up" && current.selectedIndex > 0) {
        setSelectedIndex(current.selectedIndex - 1);
      } else if (key.name === "down" && current.selectedIndex < deployments.length - 1) {
        setSelectedIndex(current.selectedIndex + 1);
      } else if (key.name === "return") {
        setViewState("detail");
      } else if (key.name === "escape") {
        context.navigateTo("home");
      }
    } else if (current.viewState === "detail") {
      const dep = deployments[current.selectedIndex];
      if (!dep) return;

      if (key.name === "e" && dep.state.status === "initialized") {
        context.setEditingDeployment({ config: dep.config, mode: "edit" });
        context.navigateTo("new");
      } else if (key.name === "f") {
        context.setEditingDeployment({ config: dep.config, mode: "fork" });
        context.navigateTo("new");
      } else if (key.name === "d") {
        if (dep.state.status === "initialized") {
          setConfirmText("");
          setError(null);
          setViewState("delete_confirm");
        } else {
          setError("Deployed agents must be destroyed first using the /destroy command.");
        }
      } else if (key.name === "escape") {
        setError(null);
        setViewState("listing");
      }
    } else if (current.viewState === "success") {
      context.navigateTo("home");
    } else if (current.viewState === "error") {
      setError(null);
      setViewState("listing");
    }
  });

  const handleDelete = (name: string) => {
    setViewState("deleting");
    try {
      deleteDeployment(name);
      setDeletedName(name);
      context.refreshDeployments();
      setViewState("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setViewState("error");
    }
  };

  // Empty state
  if (deployments.length === 0) {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.accent}>/list</text>
          <text fg={t.fg.secondary}> - Deployments</text>
        </box>
        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.border.default}
          padding={1}
        >
          <text fg={t.status.warning}>No deployments found!</text>
          <text fg={t.fg.secondary} marginTop={1}>Run /new to create a deployment.</text>
        </box>
        <text fg={t.fg.muted} marginTop={2}>Press any key to return to home</text>
      </box>
    );
  }

  // Listing state
  if (viewState === "listing") {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.accent}>/list</text>
          <text fg={t.fg.secondary}> - Deployments ({deployments.length})</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.border.default}
          padding={1}
        >
          {deployments.map((dep, index) => {
            const isSelected = index === selectedIndex;
            return (
              <box
                key={dep.config.name}
                flexDirection="row"
                backgroundColor={isSelected ? t.selection.bg : undefined}
              >
                <text fg={isSelected ? t.selection.indicator : t.fg.primary}>
                  {isSelected ? "> " : "  "}
                </text>
                <text fg={isSelected ? t.selection.fg : t.fg.primary} width={25}>
                  {dep.config.name}
                </text>
                <text fg={statusColor(dep.state.status)} width={16}>
                  [{dep.state.status}]
                </text>
                <text fg={isSelected ? t.fg.secondary : t.fg.muted}>
                  {PROVIDER_NAMES[dep.config.provider]}
                </text>
              </box>
            );
          })}
        </box>

        <text fg={t.fg.muted} marginTop={2}>Up/Down: Select | Enter: Details | Esc: Back</text>
      </box>
    );
  }

  // Detail state
  if (viewState === "detail" && selectedDeployment) {
    const dep = selectedDeployment;
    const isInitialized = dep.state.status === "initialized";

    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.accent}>/list</text>
          <text fg={t.fg.secondary}> - {dep.config.name}</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.border.focus}
          padding={1}
          marginBottom={1}
        >
          <text fg={t.accent} marginBottom={1}>Deployment Details</text>

          <box flexDirection="row">
            <text fg={t.fg.secondary} width={20}>Name:</text>
            <text fg={t.fg.primary}>{dep.config.name}</text>
          </box>
          <box flexDirection="row">
            <text fg={t.fg.secondary} width={20}>Status:</text>
            <text fg={statusColor(dep.state.status)}>{dep.state.status}</text>
          </box>
          <box flexDirection="row">
            <text fg={t.fg.secondary} width={20}>Provider:</text>
            <text fg={t.fg.primary}>{PROVIDER_NAMES[dep.config.provider]}</text>
          </box>
          <box flexDirection="row">
            <text fg={t.fg.secondary} width={20}>Created:</text>
            <text fg={t.fg.primary}>{new Date(dep.config.createdAt).toLocaleString()}</text>
          </box>
          {dep.state.serverIp && (
            <box flexDirection="row">
              <text fg={t.fg.secondary} width={20}>Server IP:</text>
              <text fg={t.accent}>{dep.state.serverIp}</text>
            </box>
          )}
          {dep.config.provider === "hetzner" && dep.config.hetzner && (
            <box flexDirection="row">
              <text fg={t.fg.secondary} width={20}>Server Type:</text>
              <text fg={t.fg.primary}>{dep.config.hetzner.serverType}</text>
            </box>
          )}
          {dep.config.provider === "digitalocean" && dep.config.digitalocean && (
            <box flexDirection="row">
              <text fg={t.fg.secondary} width={20}>Droplet Size:</text>
              <text fg={t.fg.primary}>{dep.config.digitalocean.size}</text>
            </box>
          )}
          {dep.config.openclawAgent && (
            <>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>AI Provider:</text>
                <text fg={t.fg.primary}>{dep.config.openclawAgent.aiProvider}</text>
              </box>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>Model:</text>
                <text fg={t.fg.primary}>{dep.config.openclawAgent.model}</text>
              </box>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>Channel:</text>
                <text fg={t.fg.primary}>{dep.config.openclawAgent.channel}</text>
              </box>
            </>
          )}
        </box>

        {/* Actions */}
        <box flexDirection="row" marginBottom={1}>
          {isInitialized && (
            <text fg={t.accent} marginRight={2}>[E]dit</text>
          )}
          <text fg={t.accent} marginRight={2}>[F]ork</text>
          {isInitialized ? (
            <text fg={t.status.error}>[D]elete</text>
          ) : (
            <text fg={t.fg.muted}>[D]elete (use /destroy)</text>
          )}
        </box>

        {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
        <text fg={t.fg.muted} marginTop={1}>Esc: Back to list</text>
      </box>
    );
  }

  // Delete confirm state
  if (viewState === "delete_confirm" && selectedDeployment) {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.status.error}>Confirm Deletion</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="double"
          borderColor={t.status.error}
          padding={1}
        >
          <text fg={t.status.error}>You are about to delete:</text>
          <text fg={t.fg.primary} marginTop={1}>Deployment: {selectedDeployment.config.name}</text>
          <text fg={t.status.error} marginTop={1}>This will permanently delete:</text>
          <text fg={t.fg.secondary}>  Local configuration files</text>
          <text fg={t.fg.secondary}>  SSH keys</text>
        </box>

        <text fg={t.status.warning} marginTop={2}>Type the deployment name to confirm:</text>
        <text fg={t.fg.primary} marginTop={1}>Confirm:</text>
        <input
          value={confirmText}
          placeholder={selectedDeployment.config.name}
          focused
          onInput={(value) => setConfirmText(value)}
          onSubmit={(value) => {
            if (value === selectedDeployment.config.name) {
              handleDelete(selectedDeployment.config.name);
            } else {
              setError("Name does not match. Please type the exact deployment name.");
            }
          }}
          onKeyDown={(e) => {
            if (e.name === "escape") {
              setViewState("detail");
              setConfirmText("");
              setError(null);
            }
          }}
        />

        {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
        <text fg={t.fg.muted} marginTop={2}>Press Esc to cancel</text>
      </box>
    );
  }

  // Deleting state
  if (viewState === "deleting") {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <text fg={t.status.warning}>Deleting deployment...</text>
        <text fg={t.fg.secondary} marginTop={1}>Removing local configuration files...</text>
      </box>
    );
  }

  // Success state
  if (viewState === "success") {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.status.success}
          padding={1}
        >
          <text fg={t.status.success}>Deployment Deleted</text>
          <text fg={t.fg.primary} marginTop={1}>
            The deployment "{deletedName}" has been permanently deleted.
          </text>
        </box>
        <text fg={t.fg.muted} marginTop={2}>Press any key to return to home</text>
      </box>
    );
  }

  // Error state
  if (viewState === "error") {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.status.error}
          padding={1}
        >
          <text fg={t.status.error}>Deletion Failed</text>
          <text fg={t.fg.primary} marginTop={1}>{error}</text>
        </box>
        <text fg={t.fg.muted} marginTop={2}>Press any key to go back</text>
      </box>
    );
  }

  return null;
}
