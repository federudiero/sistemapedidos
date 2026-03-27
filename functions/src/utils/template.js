const { safeStr } = require("./common");

function textParam(value) {
  return {
    type: "text",
    text: String(value || ""),
  };
}

function countTemplateVariables(text) {
  const matches = String(text || "").match(/\{\{\d+\}\}/g) || [];
  return new Set(matches).size;
}

function buildTemplatePreviewFromComponents(components) {
  const body = (Array.isArray(components) ? components : []).find(
    (c) => safeStr(c?.type).toUpperCase() === "BODY"
  );

  return safeStr(body?.text || "");
}

function normalizeTemplateButtonSchema(buttons) {
  return (Array.isArray(buttons) ? buttons : []).map((btn, idx) => ({
    index: String(btn?.index != null ? btn.index : idx),
    type: safeStr(btn?.type).toUpperCase() || null,
    subType: safeStr(btn?.sub_type || btn?.subType).toUpperCase() || null,
    text: safeStr(btn?.text || btn?.label || ""),
    variableCount: countTemplateVariables(btn?.url || btn?.text || ""),
    raw: btn || null,
  }));
}

function simplifyMetaTemplate(tpl) {
  const components = Array.isArray(tpl?.components) ? tpl.components : [];

  const normalizedComponents = components.map((c) => ({
    type: safeStr(c?.type).toUpperCase() || null,
    format: safeStr(c?.format).toUpperCase() || null,
    text: safeStr(c?.text || ""),
    example: c?.example || null,
    buttons: normalizeTemplateButtonSchema(c?.buttons),
    variableCount: countTemplateVariables(c?.text || ""),
  }));

  const header = normalizedComponents.find((c) => c.type === "HEADER") || null;
  const body = normalizedComponents.find((c) => c.type === "BODY") || null;
  const buttons = normalizedComponents
    .filter((c) => c.type === "BUTTONS")
    .flatMap((c) => c.buttons || []);

  return {
    id: tpl?.id ? String(tpl.id) : null,
    name: safeStr(tpl?.name || ""),
    language: safeStr(tpl?.language || ""),
    status: safeStr(tpl?.status || "").toUpperCase() || null,
    category: safeStr(tpl?.category || "").toUpperCase() || null,
    qualityScore: tpl?.quality_score || tpl?.qualityScore || null,
    previewText: buildTemplatePreviewFromComponents(normalizedComponents),
    schema: {
      header: header
        ? {
            format: header.format,
            text: header.text,
            variableCount: Number(header.variableCount || 0),
          }
        : null,
      body: body
        ? {
            text: body.text,
            variableCount: Number(body.variableCount || 0),
          }
        : null,
      buttons,
    },
    components: normalizedComponents,
  };
}

function buildTemplateComponentsFromRequest({
  headerVars,
  bodyVars,
  buttonVars,
  rawComponents,
}) {
  if (Array.isArray(rawComponents) && rawComponents.length) {
    return rawComponents;
  }

  const components = [];

  const header = (Array.isArray(headerVars) ? headerVars : [])
    .map((v) => String(v || ""))
    .filter((v) => v !== "");
  if (header.length) {
    components.push({
      type: "header",
      parameters: header.map(textParam),
    });
  }

  const body = (Array.isArray(bodyVars) ? bodyVars : [])
    .map((v) => String(v || ""))
    .filter((v) => v !== "");
  if (body.length) {
    components.push({
      type: "body",
      parameters: body.map(textParam),
    });
  }

  for (const btn of Array.isArray(buttonVars) ? buttonVars : []) {
    const params = (Array.isArray(btn?.parameters) ? btn.parameters : [])
      .map((v) => String(v || ""))
      .filter((v) => v !== "");

    if (!params.length) continue;

    components.push({
      type: "button",
      sub_type:
        safeStr(btn?.subType || btn?.sub_type || "url").toLowerCase() || "url",
      index: String(btn?.index != null ? btn.index : 0),
      parameters: params.map(textParam),
    });
  }

  return components.length ? components : undefined;
}

module.exports = {
  textParam,
  countTemplateVariables,
  buildTemplatePreviewFromComponents,
  normalizeTemplateButtonSchema,
  simplifyMetaTemplate,
  buildTemplateComponentsFromRequest,
};