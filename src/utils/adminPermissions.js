import { ADMIN_SECTION_KEYS } from "../constants/adminSections.js";

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function looksLikeEmail(value) {
  return typeof value === "string" && value.includes("@");
}

export function extractEmails(raw) {
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(raw.map(normalizeEmail).filter((v) => v && looksLikeEmail(v)))
    );
  }

  if (raw && typeof raw === "object") {
    const candidates = [...Object.keys(raw), ...Object.values(raw)];
    return Array.from(
      new Set(
        candidates
          .map(normalizeEmail)
          .filter((v) => v && looksLikeEmail(v))
      )
    );
  }

  return [];
}

export function createEmptySectionsMap() {
  return ADMIN_SECTION_KEYS.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {});
}

export function createFullSectionsMap() {
  return ADMIN_SECTION_KEYS.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {});
}

export function normalizeSectionsConfig(rawSections) {
  const normalized = {};

  for (const key of ADMIN_SECTION_KEYS) {
    normalized[key] = extractEmails(rawSections?.[key]);
  }

  return normalized;
}

export function resolveAdminPermissions({
  email,
  usuariosConfig,
  permisosConfig,
  superAdminEmails = [],
}) {
  const emailLo = normalizeEmail(email);
  const superAdmins = extractEmails(superAdminEmails);
  const adminEmails = extractEmails(usuariosConfig?.admins);

  const isSuperAdmin = !!emailLo && superAdmins.includes(emailLo);
  const isAdmin = !!emailLo && (isSuperAdmin || adminEmails.includes(emailLo));

  const hasPermisosDoc = !!(permisosConfig && typeof permisosConfig === "object");
  const enforceSections = permisosConfig?.enforceSections === true;
  const adminFullEmails = extractEmails(permisosConfig?.adminFull);
  const normalizedSections = normalizeSectionsConfig(permisosConfig?.sections || {});

  let sections = createEmptySectionsMap();
  let isAdminFull = false;
  let mode = "none";

  if (isAdmin) {
    const shouldFallbackCompat = !hasPermisosDoc || !enforceSections;
    const isListedAsAdminFull = adminFullEmails.includes(emailLo);

    if (isSuperAdmin || shouldFallbackCompat || isListedAsAdminFull) {
      sections = createFullSectionsMap();
      isAdminFull = true;
      mode = isSuperAdmin
        ? "superadmin"
        : shouldFallbackCompat
          ? "compat"
          : "configured-full";
    } else {
      sections = ADMIN_SECTION_KEYS.reduce((acc, key) => {
        acc[key] = normalizedSections[key]?.includes(emailLo) || false;
        return acc;
      }, {});
      mode = "configured-limited";
    }
  }

  const can = (sectionKey) => !!sections?.[sectionKey];

  return {
    email: emailLo,
    isAdmin,
    isSuperAdmin,
    isAdminFull,
    hasPermisosDoc,
    enforceSections,
    mode,
    sections,
    adminEmails,
    adminFullEmails,
    configuredSections: normalizedSections,
    can,
  };
}
