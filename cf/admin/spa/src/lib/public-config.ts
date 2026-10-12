import { useEffect, useState } from "react";
import { api } from "./api";
import { NO_CONFIG, type PublicConfig, parsePublicConfig } from "./captcha";

/**
 * `GET /api/config`, read once when the page opens. Until the answer arrives,
 * and when it cannot be read at all, the result is "nothing configured": no
 * Google button and no widget, and the form works as it did before there was
 * one (the server still decides what it accepts).
 */
export function usePublicConfig(): PublicConfig {
  const [config, setConfig] = useState<PublicConfig>(NO_CONFIG);

  useEffect(() => {
    let cancelled = false;
    void api<unknown>("/api/config").then((result) => {
      if (!cancelled && result.ok) setConfig(parsePublicConfig(result.data));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}
