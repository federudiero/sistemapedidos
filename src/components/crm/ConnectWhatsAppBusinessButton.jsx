import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  completeEmbeddedWhatsAppConnection,
  completeManualWhatsAppConnection,
  disconnectWhatsAppConnection,
  startWhatsAppConnection,
} from "../../services/crmConnectionApi";

const DEFAULT_FEATURE_TYPE = "whatsapp_business_app_onboarding";

// DEBUG TEMPORAL: dejar en true hasta terminar de diagnosticar Embedded Signup.
// Después podés cambiarlo a false o borrar los console.* si ya quedó estable.
const META_DEBUG_ENABLED = true;
const META_DEBUG_PREFIX = "[META_WA_DEBUG]";

function redactForConsole(value, depth = 0) {
  if (depth > 5) return "[MaxDepth]";

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactForConsole(item, depth + 1));
  }

  if (value && typeof value === "object") {
    const out = {};

    Object.entries(value).forEach(([key, item]) => {
      const lower = String(key).toLowerCase();
      const sensitive =
        lower.includes("token") ||
        lower.includes("secret") ||
        lower.includes("password") ||
        lower === "code" ||
        lower.includes("access_token");

      if (sensitive) {
        out[key] = item ? `[redacted:${String(item).length}]` : "";
      } else {
        out[key] = redactForConsole(item, depth + 1);
      }
    });

    return out;
  }

  return value;
}

function debugLog(step, payload = {}) {
  if (!META_DEBUG_ENABLED) return;
  console.info(META_DEBUG_PREFIX, step, redactForConsole(payload));
}

function debugWarn(step, payload = {}) {
  if (!META_DEBUG_ENABLED) return;
  console.warn(META_DEBUG_PREFIX, step, redactForConsole(payload));
}

function debugError(step, payload = {}) {
  if (!META_DEBUG_ENABLED) return;
  console.error(META_DEBUG_PREFIX, step, redactForConsole(payload));
}

function getBrowserDebugInfo() {
  if (typeof window === "undefined") return {};

  return {
    href: window.location?.href || "",
    origin: window.location?.origin || "",
    hasFB: Boolean(window.FB),
    hasFbAsyncInit: Boolean(window.fbAsyncInit),
    userAgent: window.navigator?.userAgent || "",
  };
}

function clean(value) {
  return String(value || "").trim();
}

function statusLabel(status) {
  switch (status) {
    case "connected":
      return "Conectado";
    case "pending":
      return "Pendiente";
    case "disconnected":
      return "Desconectado";
    case "disabled":
      return "Deshabilitado";
    case "error":
      return "Error";
    default:
      return "Sin configurar";
  }
}

function StatusPill({ status }) {
  const tone =
    status === "connected"
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
      : status === "error" || status === "disconnected" || status === "disabled"
        ? "border-red-400/30 bg-red-500/10 text-red-200"
        : "border-amber-400/30 bg-amber-500/10 text-amber-100";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {statusLabel(status)}
    </span>
  );
}

function safeJsonParse(value) {
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

function isFacebookOrigin(origin) {
  const value = String(origin || "").toLowerCase();

  return (
    value === "https://www.facebook.com" ||
    value === "https://web.facebook.com" ||
    value === "https://business.facebook.com" ||
    value.endsWith(".facebook.com")
  );
}

function normalizeSignupData(raw) {
  const data = raw?.data || raw?.payload?.data || raw?.payload || raw || {};

  return {
    raw: raw || null,
    event: clean(raw?.event || ""),
    phoneNumberId: clean(
      raw?.phoneNumberId ||
        raw?.phone_number_id ||
        data.phone_number_id ||
        data.phoneNumberId ||
        data.phoneNumberID ||
        data.phone?.id ||
        data.phone_number?.id ||
        data.phoneNumber?.id
    ),
    wabaId: clean(
      raw?.wabaId ||
        raw?.waba_id ||
        data.waba_id ||
        data.wabaId ||
        data.whatsapp_business_account_id ||
        data.waba?.id ||
        data.whatsapp_business_account?.id
    ),
    businessId: clean(
      raw?.businessId ||
        raw?.business_id ||
        data.business_id ||
        data.businessId ||
        data.businessID ||
        data.business?.id
    ),
    currentStep: clean(data.current_step || data.currentStep),
    errorMessage: clean(data.error_message || data.errorMessage || data.error),
  };
}

function isFinishEvent(eventName, normalized) {
  const event = clean(eventName);

  return (
    event === "FINISH" ||
    event === "FINISH_ONLY_WABA" ||
    event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" ||
    Boolean(normalized?.phoneNumberId && normalized?.wabaId)
  );
}

let facebookSdkPromise = null;

function loadFacebookSdk({ appId, graphVersion }) {
  const cleanAppId = clean(appId);
  const version = clean(graphVersion) || "v20.0";

  debugLog("SDK_LOAD_START", {
    appId: cleanAppId,
    graphVersion: version,
    browser: getBrowserDebugInfo(),
  });

  if (!cleanAppId) {
    return Promise.reject(new Error("Falta appId de Meta para abrir Embedded Signup."));
  }

  if (typeof window === "undefined") {
    return Promise.reject(new Error("Facebook SDK solo puede inicializarse en el navegador."));
  }

  if (window.FB) {
    debugLog("SDK_ALREADY_AVAILABLE", { appId: cleanAppId, graphVersion: version });
    window.FB.init({
      appId: cleanAppId,
      cookie: true,
      xfbml: true,
      version,
    });
    return Promise.resolve(window.FB);
  }

  if (facebookSdkPromise) return facebookSdkPromise;

  facebookSdkPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("facebook-jssdk");

    window.fbAsyncInit = function () {
      debugLog("SDK_ASYNC_INIT_CALLED", { appId: cleanAppId, graphVersion: version });
      window.FB.init({
        appId: cleanAppId,
        cookie: true,
        xfbml: true,
        version,
      });
      debugLog("SDK_INIT_RESOLVED", { hasFB: Boolean(window.FB) });
      resolve(window.FB);
    };

    if (existing) {
      debugWarn("SDK_SCRIPT_ALREADY_EXISTS_WAITING", { id: existing.id, src: existing.src });
      return;
    }

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.src = "https://connect.facebook.net/es_LA/sdk.js";
    script.onload = () => {
      debugLog("SDK_SCRIPT_LOADED", { src: script.src });
    };

    script.onerror = (error) => {
      facebookSdkPromise = null;
      debugError("SDK_SCRIPT_ERROR", {
        src: script.src,
        error,
        browser: getBrowserDebugInfo(),
      });
      reject(new Error("No se pudo cargar Facebook SDK. Revisá conexión, dominio permitido y bloqueadores del navegador."));
    };

    document.body.appendChild(script);
    debugLog("SDK_SCRIPT_APPENDED", { src: script.src });
  });

  return facebookSdkPromise;
}

async function launchEmbeddedSignupWithSdk({
  appId,
  graphVersion,
  configId,
  featureType,
  solutionId,
}) {
  const FB = await loadFacebookSdk({ appId, graphVersion });
  const cleanConfigId = clean(configId);

  debugLog("FB_LOGIN_PREPARE", {
    appId: clean(appId),
    graphVersion: clean(graphVersion) || "v20.0",
    configId: cleanConfigId,
    featureType: clean(featureType) || DEFAULT_FEATURE_TYPE,
    hasSolutionId: Boolean(clean(solutionId)),
    browser: getBrowserDebugInfo(),
  });

  if (!cleanConfigId) {
    throw new Error("Falta configId de Meta Embedded Signup.");
  }

  return new Promise((resolve, reject) => {
    const loginOptions = {
      config_id: cleanConfigId,
      auth_type: "rerequest",
      response_type: "code",
      override_default_response_type: true,
      extras: {
        setup: clean(solutionId) ? { solutionID: clean(solutionId) } : {},
        featureType: clean(featureType) || DEFAULT_FEATURE_TYPE,
        sessionInfoVersion: "3",
      },
    };

    debugLog("FB_LOGIN_OPEN", { loginOptions });

    FB.login(
      (response) => {
        const code = clean(response?.authResponse?.code);

        debugLog("FB_LOGIN_CALLBACK", {
          status: response?.status || "",
          hasAuthResponse: Boolean(response?.authResponse),
          authResponseKeys:
            response?.authResponse && typeof response.authResponse === "object"
              ? Object.keys(response.authResponse)
              : [],
          hasCode: Boolean(code),
          codeLength: code.length,
          response,
        });

        if (code) {
          resolve({
            code,
            raw: response || null,
          });
          return;
        }

        reject(
          new Error(
            response?.status === "not_authorized"
              ? "Meta no autorizó la conexión. Reintentá aceptando todos los permisos requeridos."
              : "Meta no devolvió código OAuth. Completá el alta hasta el final y reintentá."
          )
        );
      },
      loginOptions
    );
  });
}

export default function ConnectWhatsAppBusinessButton({
  provinciaId,
  email,
  connection,
  onRefresh,
  onConnected,
}) {
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [showManual, setShowManual] = useState(false);
  const [form, setForm] = useState({
    phoneNumberId: "",
    displayPhoneNumber: "",
    wabaId: "",
    token: "",
  });
  const [embeddedConfig, setEmbeddedConfig] = useState(null);

  const signupEventRef = useRef(null);
  const signupWaitersRef = useRef([]);

  const currentStatus = connection?.connectionStatus || "pending";
  const connected = Boolean(connection?.connected);

  useEffect(() => {
    debugLog("COMPONENT_MOUNT", {
      provinciaId,
      email,
      currentStatus,
      connected,
      connection: {
        exists: connection?.exists,
        connected: connection?.connected,
        canSendFromCrm: connection?.canSendFromCrm,
        connectionStatus: connection?.connectionStatus,
        connectionMode: connection?.connectionMode,
        hasToken: connection?.hasToken,
        tokenSource: connection?.tokenSource,
        hasPhoneNumberId: Boolean(connection?.phoneNumberId || connection?.phoneNumberIdMasked),
        hasWabaId: Boolean(connection?.wabaId),
      },
      browser: getBrowserDebugInfo(),
    });
  }, [connected, connection, currentStatus, email, provinciaId]);

  const helperText = useMemo(() => {
    if (connected) return "Tu WhatsApp Business ya está conectado al CRM.";

    if (currentStatus === "disconnected") {
      return "La casilla fue desconectada. Podés reconectarla cuando quieras.";
    }

    if (currentStatus === "error") {
      return (
        connection?.connectionError ||
        "La conexión quedó en error. Reintentá la configuración."
      );
    }

    return "Conectá el WhatsApp Business del vendedor para responder desde la app y guardar el historial en Firestore.";
  }, [connected, connection?.connectionError, currentStatus]);

  const setField = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const notifySignupWaiters = useCallback((normalized) => {
    const waiters = signupWaitersRef.current;
    signupWaitersRef.current = [];
    waiters.forEach(({ resolve }) => resolve(normalized));
  }, []);

  useEffect(() => {
    const handleMessage = (event) => {
      // Mensajes de Meta (WA_EMBEDDED_SIGNUP)
      if (isFacebookOrigin(event.origin)) {
        const parsed = safeJsonParse(event.data);

        debugLog("WINDOW_MESSAGE_FROM_FACEBOOK", {
          origin: event.origin,
          rawType: typeof event.data,
          rawPreview:
            typeof event.data === "string"
              ? event.data.slice(0, 1200)
              : event.data,
          parsedType: parsed?.type || "",
          parsedEvent: parsed?.event || "",
          parsed,
        });

        window.__CRM_META_WA_LAST_RAW_MESSAGE__ = parsed || event.data;

        if (!parsed || parsed.type !== "WA_EMBEDDED_SIGNUP") {
          debugWarn("WINDOW_MESSAGE_IGNORED_NOT_WA_EMBEDDED_SIGNUP", {
            origin: event.origin,
            parsedType: parsed?.type || "",
            parsedEvent: parsed?.event || "",
          });
          return;
        }

        debugLog("WA_EMBEDDED_SIGNUP_EVENT", {
          origin: event.origin,
          type: parsed?.type || "",
          event: parsed?.event || "",
          hasData: Boolean(parsed?.data),
          dataKeys:
            parsed?.data && typeof parsed.data === "object"
              ? Object.keys(parsed.data)
              : [],
          hasPhoneNumberId: Boolean(
            parsed?.data?.phone_number_id ||
              parsed?.data?.phoneNumberId ||
              parsed?.data?.phoneNumberID
          ),
          hasWabaId: Boolean(
            parsed?.data?.waba_id ||
              parsed?.data?.wabaId ||
              parsed?.data?.whatsapp_business_account_id
          ),
          hasBusinessId: Boolean(
            parsed?.data?.business_id ||
              parsed?.data?.businessId ||
              parsed?.data?.businessID
          ),
          parsed,
        });

        const normalized = normalizeSignupData(parsed);
        signupEventRef.current = normalized;
        window.__CRM_META_WA_LAST_EVENT__ = normalized;

        if (parsed.event === "ERROR") {
          setNotice({
            kind: "error",
            message:
              normalized.errorMessage ||
              "Meta devolvió un error durante la conexión.",
          });
          notifySignupWaiters(normalized);
          return;
        }

        if (parsed.event === "CANCEL") {
          setNotice({
            kind: "warn",
            message: normalized.currentStep
              ? `Conexión cancelada en el paso: ${normalized.currentStep}.`
              : "Conexión cancelada antes de finalizar.",
          });
          notifySignupWaiters(normalized);
          return;
        }

        if (isFinishEvent(parsed.event, normalized)) {
          notifySignupWaiters(normalized);
        }
        return;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [notifySignupWaiters]);

  const waitForSignupEvent = useCallback((timeoutMs = 10000) => {
    const current = signupEventRef.current;

    debugLog("WAIT_SIGNUP_EVENT_START", { timeoutMs, current });

    if (
      current?.event === "ERROR" ||
      current?.event === "CANCEL" ||
      isFinishEvent(current?.event, current)
    ) {
      return Promise.resolve(current);
    }

    return new Promise((resolve) => {
      const waiter = { resolve };
      signupWaitersRef.current.push(waiter);

      window.setTimeout(() => {
        signupWaitersRef.current = signupWaitersRef.current.filter(
          (item) => item !== waiter
        );
        const finalEvent = signupEventRef.current || null;
        debugWarn("WAIT_SIGNUP_EVENT_TIMEOUT_OR_RESOLVE", {
          timeoutMs,
          finalEvent,
        });
        resolve(finalEvent);
      }, timeoutMs);
    });
  }, []);

  const prepareOfficialConnection = useCallback(async () => {
    if (!provinciaId) {
      throw new Error("Falta provinciaId para iniciar la conexión.");
    }

    if (connected) {
      throw new Error("La casilla ya está conectada.");
    }

    setPreparing(true);

    debugLog("PREPARE_CONNECTION_START", { provinciaId });

    try {
      const result = await startWhatsAppConnection({ provinciaId });

      debugLog("PREPARE_CONNECTION_RESULT", { result });
      setEmbeddedConfig(result);

      if (!result?.embeddedSignupConfigured) {
        setNotice({
          kind: "warn",
          message:
            result?.message ||
            "Faltan variables de Meta para abrir el alta oficial.",
        });
        setShowManual(true);
        return result;
      }

      if (!result?.state) {
        throw new Error(
          "Falta state de conexión en la respuesta del backend. Reintentá desde el botón Conectar WhatsApp Business."
        );
      }

      return result;
    } finally {
      setPreparing(false);
    }
  }, [connected, provinciaId]);

  const handleStart = async () => {
    setBusy(true);
    setNotice({ kind: "info", message: "Abriendo conexión oficial de Meta..." });
    signupEventRef.current = null;
    signupWaitersRef.current = [];
    window.__CRM_META_WA_LAST_EVENT__ = null;
    window.__CRM_META_WA_LAST_ERROR__ = null;

    debugLog("HANDLE_START_CLICK", {
      provinciaId,
      email,
      currentStatus,
      connected,
      browser: getBrowserDebugInfo(),
    });

    try {
      const result = await prepareOfficialConnection();

      if (!result?.embeddedSignupConfigured) {
        setShowManual(true);
        return;
      }

      const state = clean(result.state);

      debugLog("HANDLE_START_PREPARED", {
        stateLength: state.length,
        embeddedSignupConfigured: result?.embeddedSignupConfigured,
        appId: result?.appId,
        configId: result?.configId,
        graphVersion: result?.graphVersion,
        featureType: result?.featureType,
        hasSolutionId: Boolean(clean(result?.solutionId)),
      });

      if (!state) {
        throw new Error(
          "Falta state de conexión. Reintentá desde el botón Conectar WhatsApp Business."
        );
      }

      setNotice({
        kind: "info",
        message:
          "Ventana de Meta abierta. Completá el proceso y esperá la confirmación.",
      });

      const oauthResult = await launchEmbeddedSignupWithSdk({
        appId: result.appId,
        graphVersion: result.graphVersion,
        configId: result.configId,
        featureType: result.featureType || DEFAULT_FEATURE_TYPE,
        solutionId: result.solutionId || "",
      });

      const code = clean(oauthResult?.code);

      debugLog("HANDLE_START_OAUTH_RESULT", {
        hasCode: Boolean(code),
        codeLength: code.length,
        oauthResult,
      });

      if (!code) {
        throw new Error(
          "Meta no devolvió el código de autorización. Reintentá la conexión."
        );
      }

      let lastEvent = signupEventRef.current;

      if (
        !lastEvent ||
        (!isFinishEvent(lastEvent.event, lastEvent) &&
          lastEvent.event !== "ERROR" &&
          lastEvent.event !== "CANCEL")
      ) {
        debugWarn("HANDLE_START_WAITING_FOR_WA_EVENT", { lastEvent });
        lastEvent = await waitForSignupEvent(30000);
      }

      debugLog("HANDLE_START_LAST_EVENT", { lastEvent });

      if (lastEvent?.event === "ERROR") {
        throw new Error(
          lastEvent.errorMessage || "Meta devolvió un error durante la conexión."
        );
      }

      if (lastEvent?.event === "CANCEL") {
        throw new Error(
          lastEvent.currentStep
            ? `Conexión cancelada en el paso: ${lastEvent.currentStep}.`
            : "Conexión cancelada antes de finalizar."
        );
      }

      const phoneNumberIdFromSignup = clean(lastEvent?.phoneNumberId || "");
      const wabaIdFromSignup = clean(lastEvent?.wabaId || "");
      const businessIdFromSignup = clean(lastEvent?.businessId || "");
      const hasSignupIdentifiers = Boolean(phoneNumberIdFromSignup || wabaIdFromSignup);

      if (!hasSignupIdentifiers) {
        debugWarn("HANDLE_START_MISSING_WA_EMBEDDED_SIGNUP_EVENT", {
          hasCode: Boolean(code),
          codeLength: code.length,
          lastEvent,
          lastRawMessage: window.__CRM_META_WA_LAST_RAW_MESSAGE__ || null,
        });

        throw new Error(
          "Meta inició sesión y devolvió un código OAuth, pero no completó Embedded Signup de WhatsApp: faltan phone_number_id y waba_id. Revisá Solution ID / configuración del caso de uso o cargá los datos técnicos manualmente."
        );
      }

      debugLog("HANDLE_START_COMPLETE_CONNECTION_REQUEST", {
        provinciaId,
        hasCode: Boolean(code),
        codeLength: code.length,
        stateLength: state.length,
        phoneNumberId: phoneNumberIdFromSignup,
        wabaId: wabaIdFromSignup,
        businessId: businessIdFromSignup,
        usingBackendDiscoveryFallback: false,
      });

      const completed = await completeEmbeddedWhatsAppConnection({
        provinciaId,
        code,
        state,
        phoneNumberId: phoneNumberIdFromSignup,
        wabaId: wabaIdFromSignup,
        businessId: businessIdFromSignup,
        embeddedSignupData: lastEvent?.raw || lastEvent || null,
      });

      debugLog("HANDLE_START_COMPLETE_CONNECTION_RESULT", { completed });

      setNotice({
        kind: "success",
        message: completed?.connection?.displayPhoneNumber
          ? `WhatsApp conectado: ${completed.connection.displayPhoneNumber}`
          : "WhatsApp conectado. Ya podés entrar al CRM.",
      });

      await onRefresh?.();
      await onConnected?.();
    } catch (err) {
      window.__CRM_META_WA_LAST_ERROR__ = err;
      debugError("HANDLE_START_ERROR", err);
      setNotice({
        kind: "error",
        message: err?.message || "No se pudo iniciar la conexión oficial.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleManualComplete = async (event) => {
    event.preventDefault();

    const phoneNumberId = clean(form.phoneNumberId);

    if (!phoneNumberId) {
      setNotice({ kind: "error", message: "Ingresá el phoneNumberId de Meta." });
      return;
    }

    setBusy(true);
    setNotice(null);

    debugLog("MANUAL_COMPLETE_START", {
      provinciaId,
      phoneNumberId,
      hasDisplayPhoneNumber: Boolean(clean(form.displayPhoneNumber)),
      hasWabaId: Boolean(clean(form.wabaId)),
      hasTokenInForm: Boolean(clean(form.token)),
    });

    try {
      await completeManualWhatsAppConnection({
        provinciaId,
        phoneNumberId,
        displayPhoneNumber: clean(form.displayPhoneNumber),
        wabaId: clean(form.wabaId),
        token: clean(form.token),
      });

      setNotice({
        kind: "success",
        message: "WhatsApp conectado. Ya podés entrar al CRM.",
      });

      await onRefresh?.();
      await onConnected?.();
    } catch (err) {
      window.__CRM_META_WA_LAST_ERROR__ = err;
      debugError("MANUAL_COMPLETE_ERROR", err);
      setNotice({
        kind: "error",
        message: err?.message || "No se pudo guardar la conexión.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    const ok = window.confirm("¿Desconectar esta casilla de WhatsApp del CRM?");
    if (!ok) return;

    setBusy(true);
    setNotice(null);

    try {
      await disconnectWhatsAppConnection({ provinciaId, clearToken: true });

      setEmbeddedConfig(null);
      setNotice({ kind: "success", message: "Casilla desconectada." });

      await onRefresh?.();
    } catch (err) {
      setNotice({
        kind: "error",
        message: err?.message || "No se pudo desconectar.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--crm-app)] text-[var(--crm-text)] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
        <div className="border-b border-[var(--crm-border)] bg-[var(--crm-elevated)] px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--crm-muted)]">
                CRM WhatsApp
              </div>
              <h1 className="mt-1 text-2xl font-bold leading-tight">
                Conectar WhatsApp Business
              </h1>
              <p className="mt-1 text-sm text-[var(--crm-muted)]">
                {email ? `${email} · ` : ""}
                Provincia: {provinciaId}
              </p>
            </div>

            <StatusPill status={currentStatus} />
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-app)] p-4">
            <p className="text-sm leading-6 text-[var(--crm-soft)]">
              {helperText}
            </p>

            <div className="grid gap-2 mt-4 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--crm-border-soft)] bg-[var(--crm-surface)] p-3">
                <div className="text-xs text-[var(--crm-muted)]">Número</div>
                <div className="mt-1 font-semibold">
                  {connection?.displayPhoneNumber ||
                    connection?.phoneNumberIdMasked ||
                    "Sin número"}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--crm-border-soft)] bg-[var(--crm-surface)] p-3">
                <div className="text-xs text-[var(--crm-muted)]">Token</div>
                <div className="mt-1 font-semibold">
                  {connection?.hasToken
                    ? `Disponible (${connection?.tokenSource})`
                    : "Falta token"}
                </div>
              </div>
            </div>
          </div>

          {notice ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                notice.kind === "error"
                  ? "border-red-400/30 bg-red-500/10 text-red-100"
                  : notice.kind === "success"
                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                    : notice.kind === "info"
                      ? "border-sky-400/30 bg-sky-500/10 text-sky-100"
                      : "border-amber-400/30 bg-amber-500/10 text-amber-100"
              }`}
            >
              {notice.message}
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleStart}
              disabled={busy || preparing || connected}
              className="rounded-2xl bg-[var(--crm-accent)] px-4 py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy
                ? "Procesando..."
                : preparing
                  ? "Preparando Meta..."
                  : "Iniciar conexión oficial"}
            </button>

            <button
              type="button"
              onClick={() => setShowManual((x) => !x)}
              disabled={busy || preparing}
              className="rounded-2xl border border-[var(--crm-border)] px-4 py-3 text-sm font-semibold text-[var(--crm-text)] transition hover:bg-[var(--crm-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {showManual ? "Ocultar carga técnica" : "Cargar datos técnicos"}
            </button>

            <button
              type="button"
              onClick={onRefresh}
              disabled={busy || preparing}
              className="rounded-2xl border border-[var(--crm-border)] px-4 py-3 text-sm font-semibold text-[var(--crm-text)] transition hover:bg-[var(--crm-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Revalidar
            </button>
          </div>

          {embeddedConfig?.state && !connected ? (
            <p className="text-xs text-[var(--crm-muted)]">
              Conexión preparada. Si el flujo falla, cerrá la ventana de Meta y
              volvé a iniciar desde este mismo botón.
            </p>
          ) : null}

          {showManual ? (
            <form
              onSubmit={handleManualComplete}
              className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-elevated)] p-4"
            >
              <div className="mb-3">
                <div className="font-semibold">Carga técnica temporal</div>
                <p className="mt-1 text-xs leading-5 text-[var(--crm-muted)]">
                  Usala solo para números ya registrados en Cloud API. Para
                  WhatsApp Business App, usá "Iniciar conexión oficial".
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-semibold text-[var(--crm-muted)]">
                    phoneNumberId *
                  </span>
                  <input
                    value={form.phoneNumberId}
                    onChange={(e) => setField("phoneNumberId", e.target.value)}
                    className="w-full rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 py-2 outline-none focus:border-[var(--crm-accent)]"
                    placeholder="Ej: 123456789012345"
                  />
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-semibold text-[var(--crm-muted)]">
                    Número visible
                  </span>
                  <input
                    value={form.displayPhoneNumber}
                    onChange={(e) =>
                      setField("displayPhoneNumber", e.target.value)
                    }
                    className="w-full rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 py-2 outline-none focus:border-[var(--crm-accent)]"
                    placeholder="Ej: +54 9 351 ..."
                  />
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-semibold text-[var(--crm-muted)]">
                    WABA ID
                  </span>
                  <input
                    value={form.wabaId}
                    onChange={(e) => setField("wabaId", e.target.value)}
                    className="w-full rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 py-2 outline-none focus:border-[var(--crm-accent)]"
                    placeholder="Opcional"
                  />
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-semibold text-[var(--crm-muted)]">
                    Token
                  </span>
                  <input
                    type="password"
                    value={form.token}
                    onChange={(e) => setField("token", e.target.value)}
                    className="w-full rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 py-2 outline-none focus:border-[var(--crm-accent)]"
                    placeholder="Opcional si usás META_WA_TOKEN"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-2 mt-4 sm:flex-row sm:justify-end">
                <button
                  type="submit"
                  disabled={busy || preparing}
                  className="rounded-2xl bg-[var(--crm-accent)] px-4 py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Guardar conexión
                </button>
              </div>
            </form>
          ) : null}

          {connected ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={busy || preparing}
                className="px-4 py-3 text-sm font-semibold text-red-200 transition border rounded-2xl border-red-400/30 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Desconectar casilla
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
