import { useState, useCallback } from "react";
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

export interface AppContext {
  navigateTo: (view: ViewName, deployment?: string) => void;
  selectedDeployment: string | null;
  deployments: Deployment[];
  refreshDeployments: () => void;
}

export function App() {
  const [currentView, setCurrentView] = useState<ViewName>("home");
  const [selectedDeployment, setSelectedDeployment] = useState<string | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>(() => {
    try {
      return getAllDeployments();
    } catch {
      return [];
    }
  });

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
    <box flexDirection="column" width="100%" height="100%">
      {renderView()}
    </box>
  );
}
