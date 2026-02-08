import { useState, useCallback, useRef } from "react";
import { useRenderer } from "@opentui/react";
import type { ViewName, Deployment } from "./types/index.js";
import { Home } from "./components/Home.js";
import { NewDeployment } from "./components/NewDeployment.js";
import { DeployView } from "./components/DeployView.js";
import { DeployingView } from "./components/DeployingView.js";
import { StatusView } from "./components/StatusView.js";
import { SSHView } from "./components/SSHView.js";
import { LogsView } from "./components/LogsView.js";
import { DestroyView } from "./components/DestroyView.js";
import { HelpView } from "./components/HelpView.js";
import { getAllDeployments } from "./services/config.js";
import { t } from "./theme.js";

export interface AppContext {
  navigateTo: (view: ViewName, deployment?: string) => void;
  selectedDeployment: string | null;
  deployments: Deployment[];
  refreshDeployments: () => void;
}

export function App() {
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
  };

  const renderView = () => {
    switch (currentView) {
      case "home":
        return <Home context={context} />;
      case "new":
        return <NewDeployment context={context} />;
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
      case "destroy":
        return <DestroyView context={context} />;
      case "help":
        return <HelpView context={context} />;
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
      {renderView()}
    </scrollbox>
  );
}


