import { useState, useRef, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { AppContext } from "../App.js";
import type { Provider, DeploymentConfig, Template, SavedSecret } from "../types/index.js";
import {
  createDeployment,
  validateDeploymentName,
} from "../services/config.js";
import { getAllTemplates } from "../services/templates.js";
import { getSecretsForService, saveSecret } from "../services/secrets.js";
import { createHetznerClient } from "../providers/hetzner/api.js";
import { createDigitalOceanClient } from "../providers/digitalocean/api.js";
import { SUPPORTED_PROVIDERS, PROVIDER_NAMES, AI_PROVIDERS } from "../providers/index.js";
import { t } from "../theme.js";

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

type Step =
  | "template_choice"
  | "name"
  | "provider"
  | "api_key_choose"
  | "api_key"
  | "api_key_save"
  | "api_key_name"
  | "droplet_size"
  | "ai_provider"
  | "ai_api_key_choose"
  | "ai_api_key"
  | "ai_api_key_save"
  | "ai_api_key_name"
  | "model"
  | "telegram_token_choose"
  | "telegram_bot_token"
  | "telegram_token_save"
  | "telegram_token_name"
  | "telegram_allow_choose"
  | "telegram_allow_from"
  | "telegram_allow_save"
  | "telegram_allow_name"
  | "confirm"
  | "complete";

const DO_DROPLET_SIZES = [
  //NOTE: Minimum size for running OpenClaw without heap out of memory errors is 2GB RAM
  // { slug: "s-1vcpu-512mb", label: "1 vCPU, 512MB RAM, 10GB SSD", price: "$4/mo" },
  // { slug: "s-1vcpu-1gb", label: "1 vCPU, 1GB RAM, 25GB SSD", price: "$6/mo" },
  { slug: "s-1vcpu-2gb", label: "1 vCPU, 2GB RAM, 50GB SSD", price: "$12/mo" },
  { slug: "s-2vcpu-2gb", label: "2 vCPU, 2GB RAM, 60GB SSD", price: "$18/mo" },
  { slug: "s-2vcpu-4gb", label: "2 vCPU, 4GB RAM, 80GB SSD", price: "$24/mo" },
  { slug: "s-4vcpu-8gb", label: "4 vCPU, 8GB RAM, 160GB SSD", price: "$48/mo" },
  { slug: "s-8vcpu-16gb", label: "8 vCPU, 16GB RAM, 320GB SSD", price: "$96/mo" },
];

function getStepList(provider: Provider, activeTemplate: Template | null): Step[] {
  const base: Step[] = ["template_choice"];

  if (!activeTemplate) {
    base.push("name", "provider", "api_key_choose");
    if (provider === "digitalocean") {
      base.push("droplet_size");
    }
    base.push("ai_provider", "ai_api_key_choose", "model", "telegram_token_choose", "telegram_allow_choose", "confirm");
  } else {
    // Template active: skip provider, ai_provider (auto-set from template)
    base.push("name", "api_key_choose");
    if (activeTemplate.provider === "digitalocean") {
      base.push("droplet_size");
    }
    base.push("ai_api_key_choose", "model", "telegram_token_choose", "telegram_allow_choose", "confirm");
  }
  return base;
}

// Maps sub-steps to their parent step for progress indicator
function resolveStepForProgress(s: Step): Step {
  switch (s) {
    case "api_key":
    case "api_key_save":
    case "api_key_name":
      return "api_key_choose";
    case "ai_api_key":
    case "ai_api_key_save":
    case "ai_api_key_name":
      return "ai_api_key_choose";
    case "telegram_bot_token":
    case "telegram_token_save":
    case "telegram_token_name":
      return "telegram_token_choose";
    case "telegram_allow_from":
    case "telegram_allow_save":
    case "telegram_allow_name":
      return "telegram_allow_choose";
    default:
      return s;
  }
}

export function NewDeployment({ context }: Props) {
  // Template state
  const [templateChoices, setTemplateChoices] = useState<Array<{ label: string; template: Template | null }>>([]);
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState(0);
  const [activeTemplate, setActiveTemplate] = useState<Template | null>(null);

  const [step, setStep] = useState<Step>(() => {
    // If navigating from TemplatesView [U]se, skip to name
    if (context.selectedTemplate) return "name";
    return "template_choice";
  });
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<Provider>(() => {
    return context.selectedTemplate?.provider ?? "hetzner";
  });
  const [apiKey, setApiKey] = useState("");
  const [selectedDropletSizeIndex, setSelectedDropletSizeIndex] = useState(() => {
    if (context.selectedTemplate?.digitalocean) {
      const idx = DO_DROPLET_SIZES.findIndex((s) => s.slug === context.selectedTemplate!.digitalocean!.size);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });
  const [aiProvider, setAiProvider] = useState(() => {
    return context.selectedTemplate?.aiProvider ?? "";
  });
  const [aiApiKey, setAiApiKey] = useState("");
  const [model, setModel] = useState(() => {
    return context.selectedTemplate?.model ?? "";
  });
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramAllowFrom, setTelegramAllowFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [selectedProviderIndex, setSelectedProviderIndex] = useState(() => {
    if (context.selectedTemplate) {
      const idx = SUPPORTED_PROVIDERS.indexOf(context.selectedTemplate.provider);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });
  const [selectedAiProviderIndex, setSelectedAiProviderIndex] = useState(() => {
    if (context.selectedTemplate) {
      const idx = AI_PROVIDERS.findIndex((p) => p.name === context.selectedTemplate!.aiProvider);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });

  // Saved key state
  const [savedProviderKeys, setSavedProviderKeys] = useState<SavedSecret[]>([]);
  const [savedAiKeys, setSavedAiKeys] = useState<SavedSecret[]>([]);
  const [savedTelegramTokens, setSavedTelegramTokens] = useState<SavedSecret[]>([]);
  const [savedTelegramUsers, setSavedTelegramUsers] = useState<SavedSecret[]>([]);
  const [selectedSavedKeyIndex, setSelectedSavedKeyIndex] = useState(0);
  const [newKeyName, setNewKeyName] = useState("");
  const [apiKeyFromSaved, setApiKeyFromSaved] = useState(false);
  const [aiApiKeyFromSaved, setAiApiKeyFromSaved] = useState(false);
  const [telegramTokenFromSaved, setTelegramTokenFromSaved] = useState(false);
  const [telegramAllowFromSaved, setTelegramAllowFromSaved] = useState(false);

  // Initialize template from context on mount
  useEffect(() => {
    if (context.selectedTemplate) {
      setActiveTemplate(context.selectedTemplate);
      context.setSelectedTemplate(null);
    }

    // Load template choices
    try {
      const templates = getAllTemplates();
      const choices: Array<{ label: string; template: Template | null }> = [
        { label: "Blank configuration", template: null },
        ...templates.map((tmpl) => ({
          label: `${tmpl.name} ${tmpl.builtIn ? "[built-in]" : "[custom]"}`,
          template: tmpl,
        })),
      ];
      setTemplateChoices(choices);
    } catch {
      setTemplateChoices([{ label: "Blank configuration", template: null }]);
    }
  }, []);

  // Load saved keys when entering a *_choose step
  useEffect(() => {
    if (step === "api_key_choose") {
      setSavedProviderKeys(getSecretsForService(provider));
      setSelectedSavedKeyIndex(0);
    } else if (step === "ai_api_key_choose") {
      setSavedAiKeys(getSecretsForService(aiProvider));
      setSelectedSavedKeyIndex(0);
    } else if (step === "telegram_token_choose") {
      setSavedTelegramTokens(getSecretsForService("telegram"));
      setSelectedSavedKeyIndex(0);
    } else if (step === "telegram_allow_choose") {
      setSavedTelegramUsers(getSecretsForService("telegram-user"));
      setSelectedSavedKeyIndex(0);
    }
  }, [step]);

  // Use refs to avoid stale closures in useKeyboard callback
  const stateRef = useRef({
    name, provider, apiKey, aiProvider, aiApiKey, model, telegramBotToken, telegramAllowFrom, step,
    selectedDropletSizeIndex, activeTemplate,
    savedProviderKeys, savedAiKeys, savedTelegramTokens, savedTelegramUsers, selectedSavedKeyIndex, newKeyName,
    apiKeyFromSaved, aiApiKeyFromSaved, telegramTokenFromSaved, telegramAllowFromSaved,
  });
  stateRef.current = {
    name, provider, apiKey, aiProvider, aiApiKey, model, telegramBotToken, telegramAllowFrom, step,
    selectedDropletSizeIndex, activeTemplate,
    savedProviderKeys, savedAiKeys, savedTelegramTokens, savedTelegramUsers, selectedSavedKeyIndex, newKeyName,
    apiKeyFromSaved, aiApiKeyFromSaved, telegramTokenFromSaved, telegramAllowFromSaved,
  };

  debugLog(`RENDER: step=${step}, apiKey.length=${apiKey?.length ?? "null"}`);

  const stepList = getStepList(provider, activeTemplate);

  const handleConfirmFromRef = () => {
    const s = stateRef.current;

    debugLog(`handleConfirmFromRef CALLED: apiKey.length=${s.apiKey?.length ?? "null"}`);

    if (!s.apiKey.trim()) {
      setError("API key is missing. Please go back and re-enter your API key.");
      setStep("api_key_choose");
      return;
    }

    if (!s.aiProvider.trim()) {
      setError("AI provider is required.");
      setStep("ai_provider");
      return;
    }

    if (!s.aiApiKey.trim()) {
      setError("AI provider API key is required.");
      setStep("ai_api_key_choose");
      return;
    }

    if (!s.model.trim()) {
      setError("Model is required.");
      setStep("model");
      return;
    }

    if (!s.telegramBotToken.trim()) {
      setError("Telegram bot token is required.");
      setStep("telegram_token_choose");
      return;
    }

    if (!s.telegramAllowFrom.trim()) {
      setError("Telegram user ID is required for access control.");
      setStep("telegram_allow_choose");
      return;
    }

    try {
      const tmpl = s.activeTemplate;
      const config: DeploymentConfig = {
        name: s.name,
        provider: s.provider,
        createdAt: new Date().toISOString(),
        hetzner: s.provider === "hetzner" ? {
          apiKey: s.apiKey,
          serverType: tmpl?.hetzner?.serverType ?? "cpx11",
          location: tmpl?.hetzner?.location ?? "ash",
          image: tmpl?.hetzner?.image ?? "ubuntu-24.04",
        } : undefined,
        digitalocean: s.provider === "digitalocean" ? {
          apiKey: s.apiKey,
          size: DO_DROPLET_SIZES[s.selectedDropletSizeIndex].slug,
          region: tmpl?.digitalocean?.region ?? "nyc1",
          image: tmpl?.digitalocean?.image ?? "ubuntu-24-04-x64",
        } : undefined,
        openclawConfig: undefined,
        openclawAgent: {
          aiProvider: s.aiProvider,
          aiApiKey: s.aiApiKey,
          model: s.model,
          channel: "telegram",
          telegramBotToken: s.telegramBotToken,
          telegramAllowFrom: s.telegramAllowFrom,
        },
      };

      createDeployment(config);
      context.refreshDeployments();
      setStep("complete");
    } catch (err) {
      setError(`Failed to create deployment: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Handle keyboard for provider selection, droplet size, confirm, and complete steps
  useKeyboard((key) => {
    const currentState = stateRef.current;
    debugLog(`useKeyboard: key=${key.name}, step=${currentState.step}`);
    if (currentState.step === "template_choice") {
      if (key.name === "up") {
        setSelectedTemplateIndex((prev) => Math.max(0, prev - 1));
      } else if (key.name === "down") {
        setSelectedTemplateIndex((prev) => Math.min(templateChoices.length - 1, prev + 1));
      } else if (key.name === "return") {
        const choice = templateChoices[selectedTemplateIndex];
        if (choice) {
          const tmpl = choice.template;
          setActiveTemplate(tmpl);
          if (tmpl) {
            // Pre-fill from template
            setProvider(tmpl.provider);
            setSelectedProviderIndex(SUPPORTED_PROVIDERS.indexOf(tmpl.provider));
            setAiProvider(tmpl.aiProvider);
            const aiIdx = AI_PROVIDERS.findIndex((p) => p.name === tmpl.aiProvider);
            setSelectedAiProviderIndex(aiIdx >= 0 ? aiIdx : 0);
            setModel(tmpl.model);
            if (tmpl.digitalocean) {
              const sizeIdx = DO_DROPLET_SIZES.findIndex((s) => s.slug === tmpl.digitalocean!.size);
              setSelectedDropletSizeIndex(sizeIdx >= 0 ? sizeIdx : 0);
            }
          }
          setStep("name");
          setError(null);
        }
      } else if (key.name === "escape") {
        context.navigateTo("home");
      }
    } else if (currentState.step === "provider") {
      if (key.name === "up") {
        setSelectedProviderIndex((prev) => Math.max(0, prev - 1));
      } else if (key.name === "down") {
        setSelectedProviderIndex((prev) => Math.min(SUPPORTED_PROVIDERS.length - 1, prev + 1));
      } else if (key.name === "return") {
        handleProviderSubmit();
      } else if (key.name === "escape") {
        setStep("name");
      }
    } else if (currentState.step === "droplet_size") {
      if (key.name === "up") {
        setSelectedDropletSizeIndex((prev) => Math.max(0, prev - 1));
      } else if (key.name === "down") {
        setSelectedDropletSizeIndex((prev) => Math.min(DO_DROPLET_SIZES.length - 1, prev + 1));
      } else if (key.name === "return") {
        setError(null);
        if (currentState.activeTemplate) {
          setStep("ai_api_key_choose");
        } else {
          setStep("ai_provider");
        }
      } else if (key.name === "escape") {
        setStep("api_key_choose");
      }
    } else if (currentState.step === "ai_provider") {
      if (key.name === "up") {
        setSelectedAiProviderIndex((prev) => Math.max(0, prev - 1));
      } else if (key.name === "down") {
        setSelectedAiProviderIndex((prev) => Math.min(AI_PROVIDERS.length - 1, prev + 1));
      } else if (key.name === "return") {
        handleAiProviderSubmit();
      } else if (key.name === "escape") {
        if (currentState.provider === "digitalocean") {
          setStep("droplet_size");
        } else {
          setStep("api_key_choose");
        }
      }
    } else if (currentState.step === "api_key_choose") {
      const keys = currentState.savedProviderKeys;
      const totalOptions = 1 + keys.length; // "Enter new" + saved keys
      if (key.name === "up") {
        setSelectedSavedKeyIndex((prev) => Math.max(0, prev - 1));
      } else if (key.name === "down") {
        setSelectedSavedKeyIndex((prev) => Math.min(totalOptions - 1, prev + 1));
      } else if (key.name === "return") {
        const idx = currentState.selectedSavedKeyIndex;
        if (idx === 0) {
          // Enter a new key
          setApiKeyFromSaved(false);
          setStep("api_key");
          setError(null);
        } else {
          // Use saved key
          const saved = keys[idx - 1];
          setApiKey(saved.value);
          setApiKeyFromSaved(true);
          setError(null);
          // Validate and proceed
          setIsValidating(true);
          (async () => {
            try {
              let isValid: boolean;
              if (currentState.provider === "digitalocean") {
                const client = createDigitalOceanClient(saved.value);
                isValid = await client.validateAPIKey();
              } else {
                const client = createHetznerClient(saved.value);
                isValid = await client.validateAPIKey();
              }
              if (!isValid) {
                setError("Saved API key is no longer valid.");
                setIsValidating(false);
                return;
              }
              setIsValidating(false);
              if (currentState.provider === "digitalocean") {
                setStep("droplet_size");
              } else if (currentState.activeTemplate) {
                setStep("ai_api_key_choose");
              } else {
                setStep("ai_provider");
              }
            } catch (err) {
              setError(`Failed to validate API key: ${err instanceof Error ? err.message : String(err)}`);
              setIsValidating(false);
            }
          })();
        }
      } else if (key.name === "escape") {
        setStep(currentState.activeTemplate ? "name" : "provider");
      }
    } else if (currentState.step === "ai_api_key_choose") {
      const keys = currentState.savedAiKeys;
      const totalOptions = 1 + keys.length;
      if (key.name === "up") {
        setSelectedSavedKeyIndex((prev) => Math.max(0, prev - 1));
      } else if (key.name === "down") {
        setSelectedSavedKeyIndex((prev) => Math.min(totalOptions - 1, prev + 1));
      } else if (key.name === "return") {
        const idx = currentState.selectedSavedKeyIndex;
        if (idx === 0) {
          setAiApiKeyFromSaved(false);
          setStep("ai_api_key");
          setError(null);
        } else {
          const saved = keys[idx - 1];
          setAiApiKey(saved.value);
          setAiApiKeyFromSaved(true);
          setError(null);
          setStep("model");
        }
      } else if (key.name === "escape") {
        if (currentState.activeTemplate) {
          setStep(currentState.provider === "digitalocean" ? "droplet_size" : "api_key_choose");
        } else {
          setStep("ai_provider");
        }
      }
    } else if (currentState.step === "telegram_token_choose") {
      const keys = currentState.savedTelegramTokens;
      const totalOptions = 1 + keys.length;
      if (key.name === "up") {
        setSelectedSavedKeyIndex((prev) => Math.max(0, prev - 1));
      } else if (key.name === "down") {
        setSelectedSavedKeyIndex((prev) => Math.min(totalOptions - 1, prev + 1));
      } else if (key.name === "return") {
        const idx = currentState.selectedSavedKeyIndex;
        if (idx === 0) {
          setTelegramTokenFromSaved(false);
          setStep("telegram_bot_token");
          setError(null);
        } else {
          const saved = keys[idx - 1];
          setTelegramBotToken(saved.value);
          setTelegramTokenFromSaved(true);
          setError(null);
          setStep("telegram_allow_choose");
        }
      } else if (key.name === "escape") {
        setStep("model");
      }
    } else if (currentState.step === "telegram_allow_choose") {
      const keys = currentState.savedTelegramUsers;
      const totalOptions = 1 + keys.length;
      if (key.name === "up") {
        setSelectedSavedKeyIndex((prev) => Math.max(0, prev - 1));
      } else if (key.name === "down") {
        setSelectedSavedKeyIndex((prev) => Math.min(totalOptions - 1, prev + 1));
      } else if (key.name === "return") {
        const idx = currentState.selectedSavedKeyIndex;
        if (idx === 0) {
          setTelegramAllowFromSaved(false);
          setStep("telegram_allow_from");
          setError(null);
        } else {
          const saved = keys[idx - 1];
          setTelegramAllowFrom(saved.value);
          setTelegramAllowFromSaved(true);
          setError(null);
          setStep("confirm");
        }
      } else if (key.name === "escape") {
        setStep("telegram_token_choose");
      }
    } else if (currentState.step === "api_key_save") {
      if (key.name === "y") {
        setStep("api_key_name");
        setNewKeyName("");
      } else if (key.name === "n" || key.name === "escape") {
        if (currentState.provider === "digitalocean") {
          setStep("droplet_size");
        } else if (currentState.activeTemplate) {
          setStep("ai_api_key_choose");
        } else {
          setStep("ai_provider");
        }
      }
    } else if (currentState.step === "ai_api_key_save") {
      if (key.name === "y") {
        setStep("ai_api_key_name");
        setNewKeyName("");
      } else if (key.name === "n" || key.name === "escape") {
        setStep("model");
      }
    } else if (currentState.step === "telegram_token_save") {
      if (key.name === "y") {
        setStep("telegram_token_name");
        setNewKeyName("");
      } else if (key.name === "n" || key.name === "escape") {
        setStep("telegram_allow_choose");
      }
    } else if (currentState.step === "telegram_allow_save") {
      if (key.name === "y") {
        setStep("telegram_allow_name");
        setNewKeyName("");
      } else if (key.name === "n" || key.name === "escape") {
        setStep("confirm");
      }
    } else if (currentState.step === "confirm") {
      if (key.name === "y" || key.name === "return") {
        handleConfirmFromRef();
      } else if (key.name === "n" || key.name === "escape") {
        setStep("telegram_allow_choose");
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
    if (activeTemplate) {
      // Skip provider step when template is active
      setStep("api_key_choose");
    } else {
      setStep("provider");
    }
  };

  const handleProviderSubmit = () => {
    setProvider(SUPPORTED_PROVIDERS[selectedProviderIndex]);
    setStep("api_key_choose");
  };

  const handleApiKeySubmit = async () => {
    debugLog(`handleApiKeySubmit CALLED: apiKey.length=${apiKey?.length ?? "null"}`);

    if (!apiKey.trim()) {
      setError("API key is required");
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      let isValid: boolean;
      if (provider === "digitalocean") {
        const client = createDigitalOceanClient(apiKey);
        isValid = await client.validateAPIKey();
      } else {
        const client = createHetznerClient(apiKey);
        isValid = await client.validateAPIKey();
      }

      if (!isValid) {
        setError("Invalid API key. Please check and try again.");
        setIsValidating(false);
        return;
      }

      debugLog(`  SUCCESS: Moving to next step`);
      if (apiKeyFromSaved) {
        // Already saved, skip save prompt
        if (provider === "digitalocean") {
          setStep("droplet_size");
        } else if (activeTemplate) {
          setStep("ai_api_key_choose");
        } else {
          setStep("ai_provider");
        }
      } else {
        setStep("api_key_save");
      }
    } catch (err) {
      setError(`Failed to validate API key: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsValidating(false);
    }
  };

  const handleAiProviderSubmit = () => {
    const selected = AI_PROVIDERS[selectedAiProviderIndex];
    setAiProvider(selected.name);
    setError(null);
    setStep("ai_api_key_choose");
  };

  const handleAiApiKeySubmit = () => {
    if (!aiApiKey.trim()) {
      setError("AI provider API key is required");
      return;
    }
    setError(null);
    if (aiApiKeyFromSaved) {
      setStep("model");
    } else {
      setStep("ai_api_key_save");
    }
  };

  const handleModelSubmit = () => {
    if (!model.trim()) {
      setError("Model identifier is required");
      return;
    }
    setError(null);
    setStep("telegram_token_choose");
  };

  const handleTelegramBotTokenSubmit = () => {
    if (!telegramBotToken.trim()) {
      setError("Telegram bot token is required");
      return;
    }
    setError(null);
    if (telegramTokenFromSaved) {
      setStep("telegram_allow_choose");
    } else {
      setStep("telegram_token_save");
    }
  };

  const handleSaveKeyName = (service: string, value: string, nextStep: Step) => {
    if (!newKeyName.trim()) {
      setError("Name is required");
      return;
    }
    try {
      saveSecret(service, newKeyName.trim(), value);
      setError(null);
      setNewKeyName("");
      setStep(nextStep);
    } catch (err) {
      setError(`Failed to save key: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleTelegramAllowFromSubmit = () => {
    if (!telegramAllowFrom.trim()) {
      setError("Telegram user ID is required for access control");
      return;
    }
    setError(null);
    if (telegramAllowFromSaved) {
      setStep("confirm");
    } else {
      setStep("telegram_allow_save");
    }
  };

  const getAiProviderLabel = (): string => {
    const found = AI_PROVIDERS.find((p) => p.name === aiProvider);
    return found?.label || aiProvider || "AI Provider";
  };

  const getAiProviderHint = (): string => {
    const p = aiProvider.trim().toLowerCase();
    if (p === "anthropic") return "ANTHROPIC_API_KEY";
    if (p === "openai") return "OPENAI_API_KEY";
    if (p === "openrouter") return "OPENROUTER_API_KEY";
    if (p === "google") return "GOOGLE_API_KEY";
    if (p === "groq") return "GROQ_API_KEY";
    return "API Key";
  };

  const getModelHint = (): string => {
    const p = aiProvider.trim().toLowerCase();
    if (p === "anthropic") return "e.g. claude-sonnet-4-20250514, claude-3-5-haiku-20241022";
    if (p === "openai") return "e.g. gpt-4o, gpt-4o-mini, o1-preview";
    if (p === "openrouter") return "e.g. anthropic/claude-sonnet-4-20250514, openai/gpt-4o";
    if (p === "google") return "e.g. gemini-2.0-flash, gemini-1.5-pro";
    if (p === "groq") return "e.g. llama-3.3-70b-versatile";
    return "e.g. claude-sonnet-4-20250514";
  };

  const getApiKeyLabel = (): string => {
    if (provider === "digitalocean") return "DigitalOcean API Token";
    return "Hetzner API Key";
  };

  const getApiKeyHelpUrl = (): string => {
    if (provider === "digitalocean") {
      return "https://docs.digitalocean.com/reference/api/create-personal-access-token/";
    }
    return "https://docs.hetzner.com/cloud/api/getting-started/generating-api-token";
  };

  const getServerSpecsLabel = (): string => {
    if (provider === "digitalocean") {
      const size = DO_DROPLET_SIZES[selectedDropletSizeIndex];
      return `${size.slug} (${size.label})`;
    }
    return "CPX11 (2 vCPU, 2GB RAM, 40GB SSD)";
  };

  const getLocationLabel = (): string => {
    if (provider === "digitalocean") return "NYC1 (New York 1)";
    return "Ashburn, VA (US East)";
  };

  const currentStepNumber = (s: Step): number => {
    const resolved = resolveStepForProgress(s);
    const idx = stepList.indexOf(resolved);
    return idx >= 0 ? idx + 1 : 0;
  };

  const renderStep = () => {
    switch (step) {
      case "template_choice":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Step 1: Choose Template</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Start from a template or blank configuration (use arrow keys and Enter):
            </text>
            <box
              flexDirection="column"
              borderStyle="single"
              borderColor={t.border.default}
              marginTop={1}
              padding={1}
            >
              {templateChoices.map((choice, i) => {
                const isSelected = i === selectedTemplateIndex;
                return (
                  <box key={choice.label} flexDirection="row" backgroundColor={isSelected ? t.selection.bg : undefined}>
                    <text fg={isSelected ? t.selection.indicator : t.fg.primary}>
                      {isSelected ? "> " : "  "}
                    </text>
                    <text fg={isSelected ? t.selection.fg : t.fg.primary}>{choice.label}</text>
                  </box>
                );
              })}
            </box>
            <text fg={t.fg.muted} marginTop={1}>Press Enter to select, Esc to go back</text>
          </box>
        );

      case "name":
        return (
          <box flexDirection="column">
            {activeTemplate && (
              <box marginBottom={1} flexDirection="row">
                <text fg={t.status.info}>Using template: </text>
                <text fg={t.fg.primary}>{activeTemplate.name}</text>
              </box>
            )}
            <text fg={t.accent}>Step {currentStepNumber("name")}: Deployment Name</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Enter a unique name for this deployment (lowercase, alphanumeric, hyphens allowed):
            </text>
            <text fg={t.fg.primary} marginTop={1}>Name:</text>
            <input
              value={name}
              placeholder="my-openclaw-server"
              focused
              onInput={(value) => {
                if (typeof value === "string" && stateRef.current.step === "name") {
                  setName(value);
                }
              }}
              onSubmit={() => handleNameSubmit()}
              onKeyDown={(e) => {
                if (e.name === "escape") {
                  if (activeTemplate) {
                    context.navigateTo("home");
                  } else {
                    setStep("template_choice");
                  }
                }
              }}
            />
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={2}>Press Enter to continue, or Esc to go back</text>
          </box>
        );

      case "provider":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Step {currentStepNumber("provider")}: Cloud Provider</text>
            <text fg={t.fg.secondary} marginTop={1}>Select where to deploy (use arrow keys and Enter):</text>
            <box
              flexDirection="column"
              borderStyle="single"
              borderColor={t.border.default}
              marginTop={1}
              padding={1}
            >
              {SUPPORTED_PROVIDERS.map((p, i) => {
                const isSelected = i === selectedProviderIndex;
                const desc = p === "hetzner" ? "Recommended - US East" : "NYC1 - New York";
                return (
                  <box key={p} flexDirection="row" backgroundColor={isSelected ? t.selection.bg : undefined}>
                    <text fg={isSelected ? t.selection.indicator : t.fg.primary}>{isSelected ? ">" : " "} </text>
                    <text fg={isSelected ? t.selection.indicator : t.fg.primary}>{PROVIDER_NAMES[p]}</text>
                    <text fg={isSelected ? t.fg.primary : t.fg.secondary}>{" - " + desc}</text>
                  </box>
                );
              })}
            </box>
            <text fg={t.fg.muted} marginTop={1}>Press Enter to select, Esc to go back</text>
          </box>
        );

      case "api_key_choose":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Step {currentStepNumber("api_key_choose")}: {getApiKeyLabel()}</text>
            <text fg={t.fg.secondary} marginTop={1}>Choose a saved key or enter a new one:</text>
            <box
              flexDirection="column"
              borderStyle="single"
              borderColor={t.border.default}
              marginTop={1}
              padding={1}
            >
              <box flexDirection="row" backgroundColor={selectedSavedKeyIndex === 0 ? t.selection.bg : undefined}>
                <text fg={selectedSavedKeyIndex === 0 ? t.selection.indicator : t.fg.primary}>
                  {selectedSavedKeyIndex === 0 ? "> " : "  "}
                </text>
                <text fg={selectedSavedKeyIndex === 0 ? t.selection.fg : t.fg.primary}>Enter a new API key</text>
              </box>
              {savedProviderKeys.map((k, i) => {
                const idx = i + 1;
                const isSelected = idx === selectedSavedKeyIndex;
                return (
                  <box key={k.id} flexDirection="row" backgroundColor={isSelected ? t.selection.bg : undefined}>
                    <text fg={isSelected ? t.selection.indicator : t.fg.primary}>
                      {isSelected ? "> " : "  "}
                    </text>
                    <text fg={isSelected ? t.selection.fg : t.fg.primary}>
                      {k.name} ({k.value.substring(0, 8)}...)
                    </text>
                  </box>
                );
              })}
            </box>
            {isValidating && <text fg={t.status.warning} marginTop={1}>Validating API key...</text>}
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={1}>Press Enter to select, Esc to go back</text>
          </box>
        );

      case "api_key":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Step {currentStepNumber("api_key")}: {getApiKeyLabel()}</text>
            <text fg={t.fg.secondary} marginTop={1}>Enter your {getApiKeyLabel()}.</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Get one at: {getApiKeyHelpUrl()}
            </text>
            <text fg={t.fg.primary} marginTop={2}>API Key:</text>
            <input
              value={apiKey}
              placeholder={`Enter your ${getApiKeyLabel()}...`}
              focused
              onInput={(value) => {
                debugLog(`API_KEY onInput: value.type=${typeof value}, currentStep=${stateRef.current.step}`);
                if (typeof value === "string" && stateRef.current.step === "api_key") {
                  setApiKey(value);
                }
              }}
              onSubmit={() => {
                if (!isValidating) {
                  handleApiKeySubmit();
                }
              }}
              onKeyDown={(e) => {
                if (e.name === "escape") {
                  setStep("api_key_choose");
                }
              }}
            />
            {isValidating && <text fg={t.status.warning} marginTop={1}>Validating API key...</text>}
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
          </box>
        );

      case "api_key_save":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Save API Key</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Would you like to save this API key for future deployments?
            </text>
            <text fg={t.status.warning} marginTop={2}>Press Y to save, N to skip</text>
          </box>
        );

      case "api_key_name":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Name Your API Key</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Enter a name to identify this key (e.g. 'prod-hetzner', 'my-account'):
            </text>
            <text fg={t.fg.primary} marginTop={2}>Key Name:</text>
            <input
              value={newKeyName}
              placeholder="my-hetzner-key"
              focused
              onInput={(value) => {
                if (typeof value === "string" && stateRef.current.step === "api_key_name") {
                  setNewKeyName(value);
                }
              }}
              onSubmit={() => {
                const nextStep: Step = provider === "digitalocean"
                  ? "droplet_size"
                  : activeTemplate ? "ai_api_key_choose" : "ai_provider";
                handleSaveKeyName(provider, apiKey, nextStep);
              }}
              onKeyDown={(e) => {
                if (e.name === "escape") {
                  const nextStep: Step = provider === "digitalocean"
                    ? "droplet_size"
                    : activeTemplate ? "ai_api_key_choose" : "ai_provider";
                  setStep(nextStep);
                }
              }}
            />
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={2}>Press Enter to save, Esc to skip</text>
          </box>
        );

      case "droplet_size":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Step {currentStepNumber("droplet_size")}: Droplet Size</text>
            <text fg={t.fg.secondary} marginTop={1}>Select your DigitalOcean droplet size (use arrow keys and Enter):</text>
            <text fg={t.fg.muted} marginTop={1}>NOTE: Minimum size for running OpenClaw without heap out of memory errors is 2GB RAM</text>
            <box
              flexDirection="column"
              borderStyle="single"
              borderColor={t.border.default}
              marginTop={1}
              padding={1}
            >
              {DO_DROPLET_SIZES.map((size, i) => {
                const isSelected = i === selectedDropletSizeIndex;
                return (
                  <box key={size.slug} flexDirection="row" backgroundColor={isSelected ? t.selection.bg : undefined}>
                    <text fg={isSelected ? t.selection.indicator : t.fg.primary}>{isSelected ? ">" : " "} </text>
                    <text fg={isSelected ? t.selection.indicator : t.fg.primary}>{size.slug}</text>
                    <text fg={isSelected ? t.fg.primary : t.fg.secondary}>{" - " + size.label + " - " + size.price}</text>
                  </box>
                );
              })}
            </box>
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={1}>Press Enter to select, Esc to go back</text>
          </box>
        );

      case "ai_provider":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Step {currentStepNumber("ai_provider")}: AI Provider</text>
            <text fg={t.fg.secondary} marginTop={1}>Select your AI model provider (use arrow keys and Enter):</text>
            <box
              flexDirection="column"
              borderStyle="single"
              borderColor={t.border.default}
              marginTop={1}
              padding={1}
            >
              {AI_PROVIDERS.map((p, i) => {
                const isSelected = i === selectedAiProviderIndex;
                return (
                  <box key={p.name} flexDirection="row" backgroundColor={isSelected ? t.selection.bg : undefined}>
                    <text fg={isSelected ? t.selection.indicator : t.fg.primary}>{isSelected ? ">" : " "} </text>
                    <text fg={isSelected ? t.selection.indicator : t.fg.primary}>{p.label}</text>
                    <text fg={isSelected ? t.fg.primary : t.fg.secondary}>{" - " + p.description}</text>
                  </box>
                );
              })}
            </box>
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={1}>Press Enter to select, Esc to go back</text>
          </box>
        );

      case "ai_api_key_choose":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Step {currentStepNumber("ai_api_key_choose")}: {getAiProviderLabel()} API Key ({getAiProviderHint()})</text>
            <text fg={t.fg.secondary} marginTop={1}>Choose a saved key or enter a new one:</text>
            <box
              flexDirection="column"
              borderStyle="single"
              borderColor={t.border.default}
              marginTop={1}
              padding={1}
            >
              <box flexDirection="row" backgroundColor={selectedSavedKeyIndex === 0 ? t.selection.bg : undefined}>
                <text fg={selectedSavedKeyIndex === 0 ? t.selection.indicator : t.fg.primary}>
                  {selectedSavedKeyIndex === 0 ? "> " : "  "}
                </text>
                <text fg={selectedSavedKeyIndex === 0 ? t.selection.fg : t.fg.primary}>Enter a new API key</text>
              </box>
              {savedAiKeys.map((k, i) => {
                const idx = i + 1;
                const isSelected = idx === selectedSavedKeyIndex;
                return (
                  <box key={k.id} flexDirection="row" backgroundColor={isSelected ? t.selection.bg : undefined}>
                    <text fg={isSelected ? t.selection.indicator : t.fg.primary}>
                      {isSelected ? "> " : "  "}
                    </text>
                    <text fg={isSelected ? t.selection.fg : t.fg.primary}>
                      {k.name} ({k.value.substring(0, 8)}...)
                    </text>
                  </box>
                );
              })}
            </box>
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={1}>Press Enter to select, Esc to go back</text>
          </box>
        );

      case "ai_api_key":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Step {currentStepNumber("ai_api_key")}: {getAiProviderLabel()} API Key ({getAiProviderHint()})</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Enter your {aiProvider || "AI provider"} API key ({getAiProviderHint()}).
            </text>
            <text fg={t.fg.primary} marginTop={2}>{getAiProviderHint()}:</text>
            <input
              value={aiApiKey}
              placeholder={`Enter your ${aiProvider || "AI provider"} API key...`}
              focused
              onInput={(value) => {
                if (typeof value === "string" && stateRef.current.step === "ai_api_key") {
                  setAiApiKey(value);
                }
              }}
              onSubmit={() => handleAiApiKeySubmit()}
              onKeyDown={(e) => {
                if (e.name === "escape") {
                  setStep("ai_api_key_choose");
                }
              }}
            />
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={2}>Press Enter to continue, Esc to go back</text>
          </box>
        );

      case "ai_api_key_save":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Save {getAiProviderLabel()} API Key</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Would you like to save this {getAiProviderLabel()} API key for future deployments?
            </text>
            <text fg={t.status.warning} marginTop={2}>Press Y to save, N to skip</text>
          </box>
        );

      case "ai_api_key_name":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Name Your {getAiProviderLabel()} API Key</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Enter a name to identify this key (e.g. 'prod-{aiProvider}', 'my-{aiProvider}'):
            </text>
            <text fg={t.fg.primary} marginTop={2}>Key Name:</text>
            <input
              value={newKeyName}
              placeholder="my-anthropic-key"
              focused
              onInput={(value) => {
                if (typeof value === "string" && stateRef.current.step === "ai_api_key_name") {
                  setNewKeyName(value);
                }
              }}
              onSubmit={() => handleSaveKeyName(aiProvider, aiApiKey, "model")}
              onKeyDown={(e) => {
                if (e.name === "escape") {
                  setStep("model");
                }
              }}
            />
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={2}>Press Enter to save, Esc to skip</text>
          </box>
        );

      case "model":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Step {currentStepNumber("model")}: Default Model</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Enter the model identifier for {aiProvider || "your AI provider"}.
            </text>
            <text fg={t.fg.secondary} marginTop={1}>
              {getModelHint()}
            </text>
            <text fg={t.fg.primary} marginTop={2}>Model:</text>
            <input
              value={model}
              placeholder="claude-sonnet-4-20250514"
              focused
              onInput={(value) => {
                if (typeof value === "string" && stateRef.current.step === "model") {
                  setModel(value);
                }
              }}
              onSubmit={() => handleModelSubmit()}
              onKeyDown={(e) => {
                if (e.name === "escape") {
                  setStep("ai_api_key_choose");
                }
              }}
            />
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={2}>Press Enter to continue, Esc to go back</text>
          </box>
        );

      case "telegram_token_choose":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Step {currentStepNumber("telegram_token_choose")}: Telegram Bot Token</text>
            <text fg={t.fg.secondary} marginTop={1}>Choose a saved token or enter a new one:</text>
            <box
              flexDirection="column"
              borderStyle="single"
              borderColor={t.border.default}
              marginTop={1}
              padding={1}
            >
              <box flexDirection="row" backgroundColor={selectedSavedKeyIndex === 0 ? t.selection.bg : undefined}>
                <text fg={selectedSavedKeyIndex === 0 ? t.selection.indicator : t.fg.primary}>
                  {selectedSavedKeyIndex === 0 ? "> " : "  "}
                </text>
                <text fg={selectedSavedKeyIndex === 0 ? t.selection.fg : t.fg.primary}>Enter a new bot token</text>
              </box>
              {savedTelegramTokens.map((k, i) => {
                const idx = i + 1;
                const isSelected = idx === selectedSavedKeyIndex;
                return (
                  <box key={k.id} flexDirection="row" backgroundColor={isSelected ? t.selection.bg : undefined}>
                    <text fg={isSelected ? t.selection.indicator : t.fg.primary}>
                      {isSelected ? "> " : "  "}
                    </text>
                    <text fg={isSelected ? t.selection.fg : t.fg.primary}>
                      {k.name} ({k.value.substring(0, 8)}...)
                    </text>
                  </box>
                );
              })}
            </box>
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={1}>Press Enter to select, Esc to go back</text>
          </box>
        );

      case "telegram_bot_token":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Step {currentStepNumber("telegram_bot_token")}: Telegram Bot Token</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Enter your Telegram bot token. Create one via @BotFather on Telegram.
            </text>
            <text fg={t.fg.secondary} marginTop={1}>
              Open Telegram, search for @BotFather, send /newbot and follow the steps.
            </text>
            <text fg={t.fg.primary} marginTop={2}>Bot Token:</text>
            <input
              value={telegramBotToken}
              placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz..."
              focused
              onInput={(value) => {
                if (typeof value === "string" && stateRef.current.step === "telegram_bot_token") {
                  setTelegramBotToken(value);
                }
              }}
              onSubmit={() => handleTelegramBotTokenSubmit()}
              onKeyDown={(e) => {
                if (e.name === "escape") {
                  setStep("telegram_token_choose");
                }
              }}
            />
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={2}>Press Enter to continue, Esc to go back</text>
          </box>
        );

      case "telegram_token_save":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Save Telegram Bot Token</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Would you like to save this bot token for future deployments?
            </text>
            <text fg={t.status.warning} marginTop={2}>Press Y to save, N to skip</text>
          </box>
        );

      case "telegram_token_name":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Name Your Bot Token</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Enter a name to identify this token (e.g. 'my-bot', 'prod-telegram'):
            </text>
            <text fg={t.fg.primary} marginTop={2}>Token Name:</text>
            <input
              value={newKeyName}
              placeholder="my-telegram-bot"
              focused
              onInput={(value) => {
                if (typeof value === "string" && stateRef.current.step === "telegram_token_name") {
                  setNewKeyName(value);
                }
              }}
              onSubmit={() => handleSaveKeyName("telegram", telegramBotToken, "telegram_allow_choose")}
              onKeyDown={(e) => {
                if (e.name === "escape") {
                  setStep("telegram_allow_choose");
                }
              }}
            />
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={2}>Press Enter to save, Esc to skip</text>
          </box>
        );

      case "telegram_allow_choose":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Step {currentStepNumber("telegram_allow_choose")}: Telegram Access Control</text>
            <text fg={t.fg.secondary} marginTop={1}>Choose a saved user or enter a new one:</text>
            <box
              flexDirection="column"
              borderStyle="single"
              borderColor={t.border.default}
              marginTop={1}
              padding={1}
            >
              <box flexDirection="row" backgroundColor={selectedSavedKeyIndex === 0 ? t.selection.bg : undefined}>
                <text fg={selectedSavedKeyIndex === 0 ? t.selection.indicator : t.fg.primary}>
                  {selectedSavedKeyIndex === 0 ? "> " : "  "}
                </text>
                <text fg={selectedSavedKeyIndex === 0 ? t.selection.fg : t.fg.primary}>Enter a new user ID or @username</text>
              </box>
              {savedTelegramUsers.map((k, i) => {
                const idx = i + 1;
                const isSelected = idx === selectedSavedKeyIndex;
                return (
                  <box key={k.id} flexDirection="row" backgroundColor={isSelected ? t.selection.bg : undefined}>
                    <text fg={isSelected ? t.selection.indicator : t.fg.primary}>
                      {isSelected ? "> " : "  "}
                    </text>
                    <text fg={isSelected ? t.selection.fg : t.fg.primary}>
                      {k.name} ({k.value})
                    </text>
                  </box>
                );
              })}
            </box>
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={1}>Press Enter to select, Esc to go back</text>
          </box>
        );

      case "telegram_allow_from":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Step {currentStepNumber("telegram_allow_from")}: Telegram Access Control</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Enter your Telegram user ID or @username to restrict bot access.
            </text>
            <text fg={t.fg.secondary}>
              Only messages from this user will be processed by the agent.
            </text>
            <text fg={t.fg.secondary} marginTop={1}>
              Find your user ID: https://docs.openclaw.ai/channels/telegram#finding-your-telegram-user-id
            </text>
            <text fg={t.fg.secondary}>
              Learn more: https://docs.openclaw.ai/channels/telegram#access-control-dms-+-groups
            </text>
            <text fg={t.fg.primary} marginTop={2}>User ID or @username:</text>
            <input
              value={telegramAllowFrom}
              placeholder="123456789 or @yourusername"
              focused
              onInput={(value) => {
                if (typeof value === "string" && stateRef.current.step === "telegram_allow_from") {
                  setTelegramAllowFrom(value);
                }
              }}
              onSubmit={() => handleTelegramAllowFromSubmit()}
              onKeyDown={(e) => {
                if (e.name === "escape") {
                  setStep("telegram_allow_choose");
                }
              }}
            />
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={2}>Press Enter to continue, Esc to go back</text>
          </box>
        );

      case "telegram_allow_save":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Save Telegram User</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Would you like to save this user ID for future deployments?
            </text>
            <text fg={t.status.warning} marginTop={2}>Press Y to save, N to skip</text>
          </box>
        );

      case "telegram_allow_name":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Name This Telegram User</text>
            <text fg={t.fg.secondary} marginTop={1}>
              Enter a name to identify this user (e.g. 'my-account', 'personal'):
            </text>
            <text fg={t.fg.primary} marginTop={2}>Name:</text>
            <input
              value={newKeyName}
              placeholder="my-telegram-user"
              focused
              onInput={(value) => {
                if (typeof value === "string" && stateRef.current.step === "telegram_allow_name") {
                  setNewKeyName(value);
                }
              }}
              onSubmit={() => handleSaveKeyName("telegram-user", telegramAllowFrom, "confirm")}
              onKeyDown={(e) => {
                if (e.name === "escape") {
                  setStep("confirm");
                }
              }}
            />
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.fg.muted} marginTop={2}>Press Enter to save, Esc to skip</text>
          </box>
        );

      case "confirm":
        return (
          <box flexDirection="column">
            <text fg={t.accent}>Step {currentStepNumber("confirm")}: Confirm Configuration</text>
            <box
              flexDirection="column"
              borderStyle="single"
              borderColor={t.border.default}
              padding={1}
              marginTop={1}
            >
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>Name:</text>
                <text fg={t.fg.primary}>{name}</text>
              </box>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>Cloud Provider:</text>
                <text fg={t.fg.primary}>{PROVIDER_NAMES[provider]}</text>
              </box>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>Server Type:</text>
                <text fg={t.fg.primary}>{getServerSpecsLabel()}</text>
              </box>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>Location:</text>
                <text fg={t.fg.primary}>{getLocationLabel()}</text>
              </box>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>OS:</text>
                <text fg={t.fg.primary}>Ubuntu 24.04 LTS</text>
              </box>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>AI Provider:</text>
                <text fg={t.fg.primary}>{aiProvider}</text>
              </box>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>AI API Key:</text>
                <text fg={t.fg.primary}>{aiApiKey ? `${aiApiKey.substring(0, 8)}...` : "N/A"}</text>
              </box>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>Model:</text>
                <text fg={t.fg.primary}>{model}</text>
              </box>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>Channel:</text>
                <text fg={t.fg.primary}>Telegram</text>
              </box>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>Bot Token:</text>
                <text fg={t.fg.primary}>{telegramBotToken ? `${telegramBotToken.substring(0, 12)}...` : "N/A"}</text>
              </box>
              <box flexDirection="row">
                <text fg={t.fg.secondary} width={20}>Allow From:</text>
                <text fg={t.fg.primary}>{telegramAllowFrom || "N/A"}</text>
              </box>
            </box>
            {error && <text fg={t.status.error} marginTop={1}>{error}</text>}
            <text fg={t.status.warning} marginTop={2}>Press Y to confirm, N to go back</text>
          </box>
        );

      case "complete":
        return (
          <box flexDirection="column">
            <text fg={t.status.success}>Deployment Configuration Created!</text>
            <box
              flexDirection="column"
              borderStyle="single"
              borderColor={t.border.default}
              padding={1}
              marginTop={1}
            >
              <text fg={t.fg.primary}>Your deployment "{name}" has been initialized.</text>
              <text fg={t.fg.secondary} marginTop={1}>
                Configuration saved to: ~/.clawcontrol/deployments/{name}/
              </text>
              <text fg={t.fg.secondary} marginTop={1}>
                AI: {aiProvider} / {model}
              </text>
              <text fg={t.fg.secondary}>
                Channel: Telegram (allowed: {telegramAllowFrom})
              </text>
            </box>
            <text fg={t.accent} marginTop={2}>Next step: Run /deploy to deploy this configuration</text>
            <text fg={t.fg.muted} marginTop={2}>Press any key to return to home</text>
          </box>
        );
    }
  };

  return (
    <box flexDirection="column" width="100%" padding={1}>
      {/* Header */}
      <box flexDirection="row" marginBottom={2}>
        <text fg={t.accent}>/new</text>
        <text fg={t.fg.secondary}> - Initialize a new deployment</text>
      </box>

      {/* Progress indicator */}
      <box flexDirection="row" marginBottom={2}>
        {stepList.map((s, i) => {
          const resolvedStep = resolveStepForProgress(step);
          const currentIdx = stepList.indexOf(resolvedStep);
          const stepColor = resolvedStep === s ? t.accent : currentIdx > i ? t.status.success : t.fg.muted;
          return (
            <box key={s} flexDirection="row">
              <text fg={stepColor}>{i + 1}</text>
              {i < stepList.length - 1 && <text fg={t.fg.muted}> → </text>}
            </box>
          );
        })}
      </box>

      {/* Step content */}
      {renderStep()}
    </box>
  );
}
