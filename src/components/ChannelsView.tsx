import { useState, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import type { AppContext } from "../App.js";
import type { Deployment } from "../types/index.js";
import { t } from "../theme.js";

interface Props {
  context: AppContext;
}

type ViewState = "listing" | "detail";

function maskToken(token: string): string {
  if (token.length <= 10) return "****";
  return token.slice(0, 6) + "..." + token.slice(-4);
}

export function ChannelsView({ context }: Props) {
  const [viewState, setViewState] = useState<ViewState>("listing");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const deployments = context.deployments;
  const selectedDeployment: Deployment | undefined = deployments[selectedIndex];

  const stateRef = useRef({ viewState, selectedIndex });
  stateRef.current = { viewState, selectedIndex };

  useKeyboard((key) => {
    const current = stateRef.current;

    if (current.viewState === "listing") {
      if (deployments.length === 0) {
        if (key.name === "escape") {
          context.navigateTo("home");
        }
        return;
      }

      if (key.name === "up" && current.selectedIndex > 0) {
        setSelectedIndex(current.selectedIndex - 1);
      } else if (key.name === "down" && current.selectedIndex < deployments.length - 1) {
        setSelectedIndex(current.selectedIndex + 1);
      } else if (key.name === "return") {
        setRevealed(false);
        setViewState("detail");
      } else if (key.name === "escape") {
        context.navigateTo("home");
      }
    } else if (current.viewState === "detail") {
      if (key.name === "r") {
        setRevealed((prev) => !prev);
      } else if (key.name === "escape") {
        setRevealed(false);
        setViewState("listing");
      }
    }
  });

  // Empty state
  if (deployments.length === 0) {
    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.accent}>/channels</text>
          <text fg={t.fg.secondary}> - Communication Channels</text>
        </box>
        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.border.default}
          padding={1}
        >
          <text fg={t.status.warning}>No deployments found!</text>
          <text fg={t.fg.secondary} marginTop={1}>Run /new to create a deployment first.</text>
        </box>
        <text fg={t.fg.muted} marginTop={2}>Esc: Back</text>
      </box>
    );
  }

  // Detail state
  if (viewState === "detail" && selectedDeployment) {
    const dep = selectedDeployment;
    const agent = dep.config.openclawAgent;

    return (
      <box flexDirection="column" width="100%" padding={1}>
        <box flexDirection="row" marginBottom={2}>
          <text fg={t.accent}>/channels</text>
          <text fg={t.fg.secondary}> - {dep.config.name}</text>
        </box>

        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={t.border.focus}
          padding={1}
          marginBottom={1}
        >
          <text fg={t.accent} marginBottom={1}>Channel Details</text>

          <box flexDirection="row">
            <text fg={t.fg.secondary} width={20}>Deployment:</text>
            <text fg={t.fg.primary}>{dep.config.name}</text>
          </box>

          {agent ? (
            <>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>Channel:</text>
                <text fg={t.fg.primary}>{agent.channel}</text>
              </box>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>Bot Token:</text>
                <text fg={t.fg.primary}>
                  {revealed ? agent.telegramBotToken : maskToken(agent.telegramBotToken)}
                </text>
              </box>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>Allowed Users:</text>
                <text fg={t.fg.primary}>{agent.telegramAllowFrom || "Any"}</text>
              </box>
            </>
          ) : (
            <box flexDirection="row" marginTop={1}>
              <text fg={t.fg.muted}>No channel configured for this deployment.</text>
            </box>
          )}
        </box>

        <text fg={t.fg.muted} marginTop={1}>
          {agent ? "R: Reveal/hide secrets | Esc: Back to list" : "Esc: Back to list"}
        </text>
      </box>
    );
  }

  // Listing state
  return (
    <box flexDirection="column" width="100%" padding={1}>
      <box flexDirection="row" marginBottom={2}>
        <text fg={t.accent}>/channels</text>
        <text fg={t.fg.secondary}> - Communication Channels ({deployments.length})</text>
      </box>

      <box
        flexDirection="column"
        borderStyle="single"
        borderColor={t.border.default}
        padding={1}
      >
        {deployments.map((dep, index) => {
          const isSelected = index === selectedIndex;
          const agent = dep.config.openclawAgent;

          return (
            <box
              key={dep.config.name}
              flexDirection="row"
              backgroundColor={isSelected ? t.selection.bg : undefined}
            >
              <text fg={isSelected ? t.selection.indicator : t.fg.primary}>
                {isSelected ? "> " : "  "}
              </text>
              <text fg={isSelected ? t.selection.fg : t.fg.primary} width={22}>
                {dep.config.name}
              </text>
              {agent ? (
                <>
                  <text fg={isSelected ? t.fg.primary : t.fg.secondary} width={12}>
                    {agent.channel}
                  </text>
                  <text fg={t.fg.muted}>
                    {agent.telegramAllowFrom ? `users: ${agent.telegramAllowFrom}` : ""}
                  </text>
                </>
              ) : (
                <text fg={t.fg.muted}>No channel</text>
              )}
            </box>
          );
        })}
      </box>

      <text fg={t.fg.muted} marginTop={2}>Up/Down: Select | Enter: Details | Esc: Back</text>
    </box>
  );
}
