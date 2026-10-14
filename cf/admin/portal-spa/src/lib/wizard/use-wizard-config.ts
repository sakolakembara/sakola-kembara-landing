import { api } from "@shared/spa/api";
import { useEffect, useState } from "react";
import { ENDPOINTS } from "~/lib/paths";
import { NO_WIZARD_CONFIG, parseWizardConfig, type WizardConfig } from "./config";

/** `GET /portal/api/config`, read once when the wizard opens; until it arrives (or when it cannot be read) there are no links and the words stand alone. */
export function useWizardConfig(): WizardConfig {
  const [config, setConfig] = useState<WizardConfig>(NO_WIZARD_CONFIG);
  useEffect(() => {
    let cancelled = false;
    void api<unknown>(ENDPOINTS.config).then((result) => {
      if (!cancelled && result.ok) setConfig(parseWizardConfig(result.data));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}
