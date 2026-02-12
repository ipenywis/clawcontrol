import { useState, useCallback, useRef } from "react";
import { useRenderer } from "@opentui/react";
import type { ViewName, Deployment, DeploymentConfig, Template } from "./types/index.js";
import { Home } from "./components/Home.js";
import { NewDeployment } from "./components/NewDeployment.js";
import { ListView } from "./components/ListView.js";
import { DeployView } from "./components/DeployView.js";
import { DeployingView } from "./components/DeployingView.js";
import { StatusView } from "./components/StatusView.js";
import { SSHView } from "./components/SSHView.js";
import { LogsView } from "./components/LogsView.js";
import { DestroyView } from "./components/DestroyView.js";
import { HelpView } from "./components/HelpView.js";
import { TemplatesView } from "./components/TemplatesView.js";
import { DashboardView } from "./components/DashboardView.js";
import { ChannelsView } from "./components/ChannelsView.js";
import { getAllDeployments } from "./services/config.js";
import { t } from "./theme.js";

export interface EditingDeployment {
  config: DeploymentConfig;
  mode: "edit" | "fork";
}

export interface AppContext {
  navigateTo: (view: ViewName, deployment?: string) => void;
  selectedDeployment: string | null;
  deployments: Deployment[];
  refreshDeployments: () => void;
  selectedTemplate: Template | null;
  setSelectedTemplate: (template: Template | null) => void;
  editingDeployment: EditingDeployment | null;
  setEditingDeployment: (ed: EditingDeployment | null) => void;
}

export function App({ lacksTrueColor }: { lacksTrueColor?: boolean }) {
  const renderer = useRenderer();
  const [currentView, setCurrentView] = useState<ViewName>("home");
  const [selectedDeployment, setSelectedDeployment] = useState<string | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>(() => {
    try {
      return getAllDeployments();
    } catch {
      return [];
    }
  });

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [editingDeployment, setEditingDeployment] = useState<EditingDeployment | null>(null);

  const wasDraggingRef = useRef(false);

  const handleMouseDrag = useCallback(() => {
    wasDraggingRef.current = true;
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!wasDraggingRef.current) return;
    wasDraggingRef.current = false;

    const selection = renderer.getSelection();
    if (selection) {
      const text = selection.getSelectedText();
      if (text) {
        renderer.copyToClipboardOSC52(text);
      }
    }
  }, [renderer]);

  const refreshDeployments = useCallback(() => {
    try {
      setDeployments(getAllDeployments());
    } catch {
      setDeployments([]);
    }
  }, []);

  const navigateTo = useCallback((view: ViewName, deployment?: string) => {
    if (deployment !== undefined) {
      setSelectedDeployment(deployment);
    }
    setCurrentView(view);
    refreshDeployments();
  }, [refreshDeployments]);

  const context: AppContext = {
    navigateTo,
    selectedDeployment,
    deployments,
    refreshDeployments,
    selectedTemplate,
    setSelectedTemplate,
    editingDeployment,
    setEditingDeployment,
  };

  const renderView = () => {
    switch (currentView) {
      case "home":
        return <Home context={context} />;
      case "new":
        return <NewDeployment context={context} />;
      case "list":
        return <ListView context={context} />;
      case "deploy":
        return <DeployView context={context} />;
      case "deploying":
        return <DeployingView context={context} />;
      case "status":
        return <StatusView context={context} />;
      case "ssh":
        return <SSHView context={context} />;
      case "logs":
        return <LogsView context={context} />;
      case "dashboard":
        return <DashboardView context={context} />;
      case "destroy":
        return <DestroyView context={context} />;
      case "help":
        return <HelpView context={context} />;
      case "templates":
        return <TemplatesView context={context} />;
      case "channels":
        return <ChannelsView context={context} />;
      default:
        return <Home context={context} />;
    }
  };

  return (
    <scrollbox
      width="100%"
      height="100%"
      scrollY={true}
      scrollX={false}
      focused={false}
      selectable
      onMouseDrag={handleMouseDrag}
      onMouseUp={handleMouseUp}
      style={{
        flexGrow: 1,
        flexShrink: 1,
        width: "100%",
        height: "100%",
        backgroundColor: t.bg.base
      }}
      verticalScrollbarOptions={{
        showArrows: false,
      }}
    >
      {lacksTrueColor && (
        <box
          width="100%"
          style={{
            paddingLeft: 1,
            paddingRight: 1,
            paddingTop: 0,
            paddingBottom: 0,
            backgroundColor: t.status.warning,
          }}
        >
          <text fg="#000000">
            {"⚠ Your terminal does not support true color. Colors may look wrong. For full color support, use Ghostty, iTerm2, Kitty, or WezTerm — or upgrade to macOS 26+ for Terminal.app true color support."}
          </text>
        </box>
      )}
      {renderView()}
    </scrollbox>
  );
}


