import { useState, useEffect, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { AppContext } from "../App.js";
import type { Provider, DeploymentConfig } from "../types/index.js";
import {
  createDeployment,
  validateDeploymentName,
} from "../services/config.js";
import { createHetznerClient } from "../providers/hetzner/api.js";
import { SUPPORTED_PROVIDERS, PROVIDER_NAMES } from "../providers/index.js";

// Debug logging to file
const DEBUG_FILE = join(homedir(), ".clawcontrol", "debug.log");
function debugLog(msg: string) {
  try {
    appendFileSync(DEBUG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // Ignore errors
  }
}

interface Props {
  context: AppContext;
}

type Step = "name" | "provider" | "api_key" | "custom_config" | "confirm" | "complete";

export function NewDeployment({ context }: Props) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<Provider>("hetzner");
  const [apiKey, setApiKey] = useState("");
  const [customConfig, setCustomConfig] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);

  // Use refs to avoid stale closures in useKeyboard callback
  const stateRef = useRef({ name, provider, apiKey, customConfig, step });
  stateRef.current = { name, provider, apiKey, customConfig, step };

  // Debug: log every render with state values
  debugLog(`RENDER: step=${step}, apiKey.length=${apiKey?.length ?? 'null'}, apiKey.type=${typeof apiKey}, apiKey.first10=${String(apiKey).substring(0, 10)}`);

  // Ref-based confirm handler (defined before useKeyboard to avoid hoisting issues)
  const handleConfirmFromRef = () => {
    const { name: currentName, provider: currentProvider, apiKey: currentApiKey, customConfig: currentCustomConfig } = stateRef.current;

    debugLog(`handleConfirmFromRef CALLED:`);
    debugLog(`  stateRef.current.apiKey.length=${currentApiKey?.length ?? 'null'}`);
    debugLog(`  stateRef.current.apiKey.type=${typeof currentApiKey}`);
    debugLog(`  stateRef.current.apiKey.first10=${String(currentApiKey).substring(0, 10)}`);
    debugLog(`  direct apiKey state.length=${apiKey?.length ?? 'null'}`);
    debugLog(`  direct apiKey state.type=${typeof apiKey}`);

    // Defensive check: ensure API key is present for Hetzner deployments
    if (currentProvider === "hetzner" && !currentApiKey.trim()) {
      debugLog(`  FAILED: apiKey is empty or not a string with trim()`);
      setError("Hetzner API key is missing. Please go back and re-enter your API key.");
      setStep("api_key");
      return;
    }
    debugLog(`  PASSED: apiKey check passed`);

    try {
      const config: DeploymentConfig = {
        name: currentName,
        provider: currentProvider,
        createdAt: new Date().toISOString(),
        hetzner: currentProvider === "hetzner" ? {
          apiKey: currentApiKey,
          serverType: "cpx11",
          location: "ash",
          image: "ubuntu-24.04",
        } : undefined,
        openclawConfig: currentCustomConfig.trim() ? JSON.parse(currentCustomConfig) : undefined,
      };

      createDeployment(config);
      context.refreshDeployments();
      setStep("complete");
    } catch (err) {
      setError(`Failed to create deployment: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Handle keyboard for confirm and complete steps
  useKeyboard((key) => {
    const currentState = stateRef.current;
    debugLog(`useKeyboard: key=${key.name}, currentState.step=${currentState.step}, currentState.apiKey.length=${currentState.apiKey?.length ?? 'null'}`);
    if (currentState.step === "confirm") {
      if (key.name === "y" || key.name === "return") {
        debugLog(`  Calling handleConfirmFromRef...`);
        handleConfirmFromRef();
      } else if (key.name === "n" || key.name === "escape") {
        setStep("custom_config");
      }
    } else if (currentState.step === "complete") {
      context.navigateTo("home");
    }
  });

  const handleNameSubmit = () => {
    const validation = validateDeploymentName(name);
    if (!validation.valid) {
      setError(validation.error || "Invalid name");
      return;
    }
    setError(null);
    setStep("provider");
  };

  const handleProviderSubmit = () => {
    setProvider(SUPPORTED_PROVIDERS[selectedProviderIndex]);
    setStep("api_key");
  };

  const handleApiKeySubmit = async () => {
    debugLog(`handleApiKeySubmit CALLED: apiKey.length=${apiKey?.length ?? 'null'}, type=${typeof apiKey}`);

    if (!apiKey.trim()) {
      debugLog(`  FAILED: apiKey.trim() is falsy`);
      setError("API key is required");
      return;
    }

    debugLog(`  PASSED initial check, starting validation...`);
    setIsValidating(true);
    setError(null);

    try {
      const client = createHetznerClient(apiKey);
      const isValid = await client.validateAPIKey();

      if (!isValid) {
        debugLog(`  FAILED: Hetzner API returned invalid`);
        setError("Invalid API key. Please check and try again.");
        setIsValidating(false);
        return;
      }

      debugLog(`  SUCCESS: Moving to custom_config step. apiKey.length=${apiKey.length}`);
      setStep("custom_config");
    } catch (err) {
      debugLog(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
      setError(`Failed to validate API key: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsValidating(false);
    }
  };

  const handleCustomConfigSubmit = () => {
    debugLog(`handleCustomConfigSubmit CALLED: apiKey.length=${apiKey?.length ?? 'null'}, step=${step}`);
    if (customConfig.trim()) {
      try {
        JSON.parse(customConfig);
      } catch {
        setError("Invalid JSON format for custom config");
        return;
      }
    }
    setError(null);
    debugLog(`  Moving to confirm step. apiKey.length=${apiKey?.length ?? 'null'}`);
    setStep("confirm");
  };

  const handleConfirm = () => {
    // Defensive check: ensure API key is present for Hetzner deployments
    if (provider === "hetzner" && !apiKey.trim()) {
      setError("Hetzner API key is missing. Please go back and re-enter your API key.");
      setStep("api_key");
      return;
    }

    try {
      const config: DeploymentConfig = {
        name,
        provider,
        createdAt: new Date().toISOString(),
        hetzner: provider === "hetzner" ? {
          apiKey,
          serverType: "cpx11",
          location: "ash",
          image: "ubuntu-24.04",
        } : undefined,
        openclawConfig: customConfig.trim() ? JSON.parse(customConfig) : undefined,
      };

      createDeployment(config);
      context.refreshDeployments();
      setStep("complete");
    } catch (err) {
      setError(`Failed to create deployment: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const renderStep = () => {
    switch (step) {
      case "name":
        return (
          <box flexDirection="column">
            <text fg="cyan">Step 1: Deployment Name</text>
            <text fg="gray" marginTop={1}>
              Enter a unique name for this deployment (lowercase, alphanumeric, hyphens allowed):
            </text>
            <text fg="white" marginTop={1}>Name:</text>
            <input
              value={name}
              placeholder="my-openclaw-server"
              focused
              onInput={(value) => {
                // Only update if we're still on the name step
                if (typeof value === 'string' && stateRef.current.step === 'name') {
                  setName(value);
                }
              }}
              onSubmit={() => handleNameSubmit()}
              onKeyDown={(e) => {
                if (e.name === "escape") {
                  context.navigateTo("home");
                }
              }}
            />
            {error && <text fg="red" marginTop={1}>{error}</text>}
            <text fg="gray" marginTop={2}>Press Enter to continue, or Esc to go back</text>
          </box>
        );

      case "provider":
        return (
          <box flexDirection="column">
            <text fg="cyan">Step 2: Cloud Provider</text>
            <text fg="gray" marginTop={1}>Select where to deploy (use arrow keys and Enter):</text>
            <box
              flexDirection="column"
              borderStyle="single"
              borderColor="gray"
              marginTop={1}
              height={8}
            >
              <select
                focused
                options={SUPPORTED_PROVIDERS.map((p) => ({
                  name: PROVIDER_NAMES[p],
                  description: p !== "hetzner" ? "Coming soon" : "Recommended - US East",
                  value: p,
                }))}
                onChange={(index) => {
                  setSelectedProviderIndex(index);
                }}
                onSelect={(index) => {
                  setSelectedProviderIndex(index);
                  handleProviderSubmit();
                }}
                onKeyDown={(e) => {
                  if (e.name === "escape") {
                    setStep("name");
                  }
                }}
              />
            </box>
            <text fg="gray" marginTop={1}>Press Enter to select, Esc to go back</text>
          </box>
        );

      case "api_key":
        return (
          <box flexDirection="column">
            <text fg="cyan">Step 3: Hetzner API Key</text>
            <text fg="gray" marginTop={1}>Enter your Hetzner Cloud API token.</text>
            <text fg="blue" marginTop={1}>
              Get one at: https://docs.hetzner.com/cloud/api/getting-started/generating-api-token
            </text>
            <text fg="white" marginTop={2}>API Key:</text>
            <input
              value={apiKey}
              placeholder="Enter your Hetzner API key..."
              focused
              onInput={(value) => {
                debugLog(`API_KEY onInput: value.type=${typeof value}, value.length=${typeof value === 'string' ? value.length : 'N/A'}, isString=${typeof value === 'string'}, currentStep=${stateRef.current.step}`);
                // Only update apiKey if we're still on the api_key step
                // This prevents the unmount event from clearing the value
                if (typeof value === 'string' && stateRef.current.step === 'api_key') {
                  setApiKey(value);
                } else {
                  debugLog(`  IGNORED: step changed or non-string value`);
                }
              }}
              onSubmit={() => {
                debugLog(`API_KEY onSubmit called`);
                if (!isValidating) {
                  handleApiKeySubmit();
                }
              }}
              onKeyDown={(e) => {
                if (e.name === "escape") {
                  setStep("provider");
                }
              }}
            />
            {isValidating && <text fg="yellow" marginTop={1}>Validating API key...</text>}
            {error && <text fg="red" marginTop={1}>{error}</text>}
          </box>
        );

      case "custom_config":
        return (
          <box flexDirection="column">
            <text fg="cyan">Step 4: Custom OpenClaw Config (Optional)</text>
            <text fg="gray" marginTop={1}>
              Enter custom OpenClaw configuration as JSON, or leave empty for defaults.
            </text>
            <text fg="blue" marginTop={1}>See docs: https://docs.openclaw.ai/</text>
            <text fg="white" marginTop={2}>Config (JSON, optional):</text>
            <input
              value={customConfig}
              placeholder='{"gateway": {"port": 18789}}'
              focused
              onInput={(value) => {
                debugLog(`CUSTOM_CONFIG onInput: value.type=${typeof value}, apiKey.length=${apiKey?.length ?? 'null'}, currentStep=${stateRef.current.step}`);
                // Only update if we're still on the custom_config step
                if (typeof value === 'string' && stateRef.current.step === 'custom_config') {
                  setCustomConfig(value);
                }
              }}
              onSubmit={() => {
                debugLog(`CUSTOM_CONFIG onSubmit: apiKey.length=${apiKey?.length ?? 'null'}`);
                handleCustomConfigSubmit();
              }}
              onKeyDown={(e) => {
                if (e.name === "escape") {
                  setStep("api_key");
                }
              }}
            />
            {error && <text fg="red" marginTop={1}>{error}</text>}
            <text fg="gray" marginTop={2}>Press Enter to continue (leave empty for defaults)</text>
          </box>
        );

      case "confirm":
        return (
          <box flexDirection="column">
            <text fg="cyan">Step 5: Confirm Configuration</text>
            <box
              flexDirection="column"
              borderStyle="single"
              borderColor="gray"
              padding={1}
              marginTop={1}
            >
              <box flexDirection="row">
                <text fg="gray" width={15}>Name:</text>
                <text fg="white">{name}</text>
              </box>
              <box flexDirection="row">
                <text fg="gray" width={15}>Provider:</text>
                <text fg="white">{PROVIDER_NAMES[provider]}</text>
              </box>
              <box flexDirection="row">
                <text fg="gray" width={15}>Server Type:</text>
                <text fg="white">CPX11 (2 vCPU, 2GB RAM, 40GB SSD)</text>
              </box>
              <box flexDirection="row">
                <text fg="gray" width={15}>Location:</text>
                <text fg="white">Ashburn, VA (US East)</text>
              </box>
              <box flexDirection="row">
                <text fg="gray" width={15}>OS:</text>
                <text fg="white">Ubuntu 24.04 LTS</text>
              </box>
              <box flexDirection="row">
                <text fg="gray" width={15}>Custom Config:</text>
                <text fg="white">{customConfig.trim() ? "Yes" : "Default"}</text>
              </box>
            </box>
            {error && <text fg="red" marginTop={1}>{error}</text>}
            <text fg="yellow" marginTop={2}>Press Y to confirm, N to go back</text>
          </box>
        );

      case "complete":
        return (
          <box flexDirection="column">
            <text fg="green">Deployment Configuration Created!</text>
            <box
              flexDirection="column"
              borderStyle="single"
              borderColor="green"
              padding={1}
              marginTop={1}
            >
              <text fg="white">Your deployment "{name}" has been initialized.</text>
              <text fg="gray" marginTop={1}>
                Configuration saved to: ~/.clawcontrol/deployments/{name}/
              </text>
            </box>
            <text fg="cyan" marginTop={2}>Next step: Run /deploy to deploy this configuration</text>
            <text fg="yellow" marginTop={2}>Press any key to return to home</text>
          </box>
        );
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      {/* Header */}
      <box flexDirection="row" marginBottom={2}>
        <text fg="cyan">/new</text>
        <text fg="gray"> - Initialize a new deployment</text>
      </box>

      {/* Progress indicator */}
      <box flexDirection="row" marginBottom={2}>
        {["name", "provider", "api_key", "custom_config", "confirm"].map((s, i) => {
          const steps = ["name", "provider", "api_key", "custom_config", "confirm"];
          const currentIdx = steps.indexOf(step);
          const stepColor = step === s ? "cyan" : currentIdx > i ? "green" : "gray";
          return (
            <box key={s} flexDirection="row">
              <text fg={stepColor}>{i + 1}</text>
              {i < 4 && <text fg="gray"> → </text>}
            </box>
          );
        })}
      </box>

      {/* Step content */}
      {renderStep()}
    </box>
  );
}
