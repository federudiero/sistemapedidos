import { useCallback, useEffect, useMemo, useState } from "react";
import { getConversationSendPolicy } from "../services/crmPolicyApi";

export function useConversationSendPolicy({
  provinciaId,
  convId,
  selectedTemplateCategory = null,
  enabled = true,
}) {
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadPolicy = useCallback(async () => {
    if (!enabled || !provinciaId || !convId) {
      setPolicy(null);
      setError("");
      return null;
    }

    setLoading(true);
    setError("");

    try {
      const data = await getConversationSendPolicy({
        provinciaId,
        convId,
        selectedTemplateCategory,
      });
      setPolicy(data);
      return data;
    } catch (err) {
      const msg =
        err?.message || "No se pudo cargar la policy de la conversación";
      setError(msg);
      setPolicy(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [enabled, provinciaId, convId, selectedTemplateCategory]);

  useEffect(() => {
    loadPolicy();
  }, [loadPolicy]);

  const derived = useMemo(() => {
    const textAllowed = Boolean(policy?.text?.allowed);
    const recommendedAction = policy?.recommendedAction || "no_action";
    const recommendedTemplateCategory =
      policy?.recommendedTemplateCategory || null;

    return {
      textAllowed,
      recommendedAction,
      recommendedTemplateCategory,
      isTemplateRecommended: recommendedAction === "send_template",
      shouldLockComposer: !textAllowed,
      summary:
        policy?.summary ||
        policy?.recommendedReason ||
        "",
    };
  }, [policy]);

  return {
    policy,
    loading,
    error,
    reloadPolicy: loadPolicy,
    ...derived,
  };
}