import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  SendHorizonal,
  ShieldAlert,
} from "lucide-react";

function getBannerConfig(policy) {
  if (!policy) {
    return {
      icon: Clock3,
      className:
        "border-base-300 bg-base-200 text-base-content",
      title: "Cargando policy de envío",
      description: "Estamos verificando si esta conversación permite texto libre o requiere plantilla.",
      actionLabel: null,
    };
  }

  if (policy?.recommendedAction === "send_text") {
    return {
      icon: CheckCircle2,
      className:
        "border-success/30 bg-success/10 text-success-content",
      title: "Ventana de 24 horas activa",
      description:
        policy?.recommendedReason ||
        "Podés enviar texto libre en esta conversación.",
      actionLabel: null,
    };
  }

  if (policy?.recommendedAction === "send_template") {
    return {
      icon: SendHorizonal,
      className:
        "border-warning/30 bg-warning/10 text-warning-content",
      title: "Esta conversación requiere plantilla",
      description:
        policy?.recommendedReason ||
        "Para continuar, usá una plantilla aprobada.",
      actionLabel:
        policy?.recommendedTemplateCategory
          ? `Usar ${policy.recommendedTemplateCategory}`
          : "Usar plantilla",
    };
  }

  return {
    icon: ShieldAlert,
    className:
      "border-error/30 bg-error/10 text-error-content",
    title: "No se recomienda enviar mensajes ahora",
    description:
      policy?.summary ||
      "Esta conversación no tiene una acción habilitada por el momento.",
    actionLabel: null,
  };
}

export default function ChatPolicyBanner({
  policy,
  loading = false,
  error = "",
  onUseTemplate,
}) {
  if (error) {
    return (
      <div className="p-3 mb-2 text-sm border rounded-2xl border-error/30 bg-error/10 text-error">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">No se pudo verificar la policy</div>
            <div className="opacity-90">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  const effectivePolicy = loading
    ? null
    : policy;

  const cfg = getBannerConfig(effectivePolicy);
  const Icon = cfg.icon;

  return (
    <div className={`mb-2 rounded-2xl border p-3 text-sm ${cfg.className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Icon size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">{cfg.title}</div>
            <div className="opacity-90">{cfg.description}</div>

            {policy?.window?.hoursSinceInbound != null && (
              <div className="mt-1 text-xs opacity-70">
                Último inbound hace {policy.window.hoursSinceInbound.toFixed(1)} h
              </div>
            )}
          </div>
        </div>

        {cfg.actionLabel && typeof onUseTemplate === "function" && (
          <button
            type="button"
            onClick={() =>
              onUseTemplate(policy?.recommendedTemplateCategory || null)
            }
            className="btn btn-warning btn-sm rounded-xl"
          >
            {cfg.actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}