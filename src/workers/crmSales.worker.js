function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function asDate(value) {
  try {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value?.toDate === "function") {
      const date = value.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const seconds = Number(value?.seconds ?? value?._seconds);
    if (Number.isFinite(seconds)) {
      const nanos = Number(value?.nanoseconds ?? value?._nanoseconds ?? 0);
      const date = new Date((seconds * 1000) + Math.floor(nanos / 1_000_000));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function toDateInput(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function firstInboundDate(conversation) {
  return asDate(conversation?.firstInboundAt || conversation?.createdAt);
}

function firstReferralOf(conversation) {
  const referral = conversation?.firstReferral;
  return referral && typeof referral === "object" ? referral : {};
}

function leadSourceType(conversation) {
  const referral = firstReferralOf(conversation);
  return String(referral?.sourceType || conversation?.leadSourceType || "").trim().toLowerCase();
}

function isAdvertisingLead(conversation) {
  return leadSourceType(conversation) === "ad";
}

function isMarketplaceLead(conversation) {
  return leadSourceType(conversation) === "marketplace";
}

function isFacebookContentLead(conversation) {
  return leadSourceType(conversation) === "facebook_content";
}

function isMetaEntryLead(conversation) {
  return ["meta_entry", "post"].includes(leadSourceType(conversation));
}

function isUnattributedLead(conversation) {
  const type = leadSourceType(conversation);
  const status = String(conversation?.leadSourceStatus || "").trim().toLowerCase();
  return !type || type === "unknown" || status === "unattributed";
}

function getPedidoId(pedido) {
  return String(pedido?.id || pedido?.pedidoId || pedido?.docId || "").trim();
}

function getPedidoSeller(pedido) {
  return normalizeEmail(pedido?.vendedorEmail);
}

function phoneToCrmDigits(raw) {
  if (!raw) return "";

  const original = String(raw).trim();
  if (!original) return "";

  if (original.startsWith("+")) return original.slice(1).replace(/\D/g, "");
  if (original.startsWith("00")) return original.slice(2).replace(/\D/g, "");

  let digits = original.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("54")) digits = digits.slice(2);

  let hadTrunkZero = false;
  if (digits.startsWith("0")) {
    hadTrunkZero = true;
    digits = digits.slice(1);
  }

  if (hadTrunkZero) {
    digits = digits
      .replace(/^(\d{4})15(\d{5,7})$/, "$1$2")
      .replace(/^(\d{3})15(\d{6,8})$/, "$1$2")
      .replace(/^(\d{2})15(\d{7,8})$/, "$1$2");
  }

  if (!digits.startsWith("9")) digits = `9${digits}`;
  return `54${digits}`;
}

function conversationPhoneDigits(conversation) {
  return Array.from(
    new Set(
      [conversation?.clienteWaId, conversation?.telefonoE164]
        .map(phoneToCrmDigits)
        .filter(Boolean)
    )
  );
}

function pedidoPhoneDigits(pedido) {
  return Array.from(
    new Set(
      [pedido?.crmTelefonoE164, pedido?.telefono, pedido?.telefonoAlt]
        .map(phoneToCrmDigits)
        .filter(Boolean)
    )
  );
}

function buildClosedOrderIdSet(cierres = []) {
  const set = new Set();
  for (const cierre of cierres) {
    for (const pedido of Array.isArray(cierre?.pedidosEntregados) ? cierre.pedidosEntregados : []) {
      const id = getPedidoId(pedido);
      if (id) set.add(id);
    }
  }
  return set;
}

function computeLeadCohortConversion({
  conversations = [],
  pedidos = [],
  cierres = [],
  seller = "_all",
}) {
  const closedIds = buildClosedOrderIdSet(cierres);
  const filteredConversations = conversations.filter((conversation) => {
    if (seller === "_all") return true;
    return normalizeEmail(conversation?.assignedToEmail) === seller;
  });

  const conversationById = new Map(
    filteredConversations
      .map((conversation) => [String(conversation.id || "").trim(), conversation])
      .filter(([id]) => Boolean(id))
  );

  const conversationsBySellerPhone = new Map();
  const conversationByLegacyPedidoId = new Map();

  for (const [conversationId, conversation] of conversationById.entries()) {
    const assignedSeller = normalizeEmail(conversation?.assignedToEmail);
    for (const phone of conversationPhoneDigits(conversation)) {
      const key = `${assignedSeller}|${phone}`;
      if (!conversationsBySellerPhone.has(key)) conversationsBySellerPhone.set(key, []);
      conversationsBySellerPhone.get(key).push({ id: conversationId, conversation });
    }

    const legacyPedidoId = String(conversation?.crmPedidoId || "").trim();
    if (legacyPedidoId) conversationByLegacyPedidoId.set(legacyPedidoId, conversationId);
  }

  const pedidosByConversation = new Map();

  for (const pedido of pedidos) {
    const pedidoSeller = getPedidoSeller(pedido);
    if (seller !== "_all" && pedidoSeller !== seller) continue;

    const pedidoId = getPedidoId(pedido);
    const deliveryDate = String(pedido?.fechaStr || "").trim();
    if (!pedidoId || !deliveryDate) continue;

    let conversationId = String(pedido?.crmConversationId || "").trim();

    if (conversationId && !conversationById.has(conversationId)) continue;

    if (!conversationId) {
      const legacyConversationId = conversationByLegacyPedidoId.get(pedidoId);
      if (legacyConversationId && conversationById.has(legacyConversationId)) {
        conversationId = legacyConversationId;
      }
    }

    if (!conversationId && pedidoSeller) {
      const fallbackCandidates = new Map();
      for (const phone of pedidoPhoneDigits(pedido)) {
        const key = `${pedidoSeller}|${phone}`;
        for (const candidate of conversationsBySellerPhone.get(key) || []) {
          fallbackCandidates.set(candidate.id, candidate.conversation);
        }
      }

      const closestConversation = Array.from(fallbackCandidates.entries())
        .map(([id, conversation]) => ({
          id,
          conversation,
          leadDate: firstInboundDate(conversation),
        }))
        .filter((item) => item.leadDate && toDateInput(item.leadDate) <= deliveryDate)
        .sort((left, right) => right.leadDate.getTime() - left.leadDate.getTime())[0];

      if (closestConversation?.id) conversationId = closestConversation.id;
    }

    if (!conversationId) continue;
    if (!pedidosByConversation.has(conversationId)) pedidosByConversation.set(conversationId, []);
    pedidosByConversation.get(conversationId).push(pedido);
  }

  const grouped = new Map();

  for (const [conversationId, conversation] of conversationById.entries()) {
    const inbound = firstInboundDate(conversation);
    if (!inbound) continue;

    const leadDate = toDateInput(inbound);
    if (!grouped.has(leadDate)) {
      grouped.set(leadDate, {
        leadDate,
        leads: 0,
        converted: 0,
        sold: 0,
        pending: 0,
        deliveryDates: new Map(),
      });
    }

    const cohort = grouped.get(leadDate);
    cohort.leads += 1;

    const firstOrder = (pedidosByConversation.get(conversationId) || [])
      .filter((pedido) => {
        const deliveryDate = String(pedido?.fechaStr || "").trim();
        return deliveryDate && deliveryDate >= leadDate;
      })
      .sort((left, right) => {
        const leftDate = String(left?.fechaStr || "");
        const rightDate = String(right?.fechaStr || "");
        if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
        return getPedidoId(left).localeCompare(getPedidoId(right));
      })[0];

    if (!firstOrder) continue;

    const pedidoId = getPedidoId(firstOrder);
    const deliveryDate = String(firstOrder?.fechaStr || "").trim();
    if (!pedidoId || !deliveryDate) continue;

    const isSold = closedIds.has(pedidoId);
    cohort.converted += 1;
    if (isSold) cohort.sold += 1;
    else cohort.pending += 1;

    if (!cohort.deliveryDates.has(deliveryDate)) {
      cohort.deliveryDates.set(deliveryDate, {
        date: deliveryDate,
        count: 0,
        sold: 0,
        pending: 0,
      });
    }

    const delivery = cohort.deliveryDates.get(deliveryDate);
    delivery.count += 1;
    if (isSold) delivery.sold += 1;
    else delivery.pending += 1;
  }

  return Array.from(grouped.values())
    .map((cohort) => ({
      leadDate: cohort.leadDate,
      leads: cohort.leads,
      converted: cohort.converted,
      sold: cohort.sold,
      pending: cohort.pending,
      unconverted: Math.max(0, cohort.leads - cohort.converted),
      conversionRate: cohort.leads ? (cohort.converted / cohort.leads) * 100 : 0,
      soldRate: cohort.leads ? (cohort.sold / cohort.leads) * 100 : 0,
      pendingRate: cohort.leads ? (cohort.pending / cohort.leads) * 100 : 0,
      unconvertedRate: cohort.leads
        ? (Math.max(0, cohort.leads - cohort.converted) / cohort.leads) * 100
        : 0,
      deliveryDates: Array.from(cohort.deliveryDates.values())
        .map((delivery) => ({
          ...delivery,
          rate: cohort.leads ? (delivery.count / cohort.leads) * 100 : 0,
          soldRate: cohort.leads ? (delivery.sold / cohort.leads) * 100 : 0,
          pendingRate: cohort.leads ? (delivery.pending / cohort.leads) * 100 : 0,
        }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => a.leadDate.localeCompare(b.leadDate));
}

function salesAttributionCustomerName(pedido, conversation) {
  return String(
    pedido?.nombre
      || pedido?.clienteNombre
      || pedido?.cliente
      || conversation?.nombre
      || "Sin nombre"
  ).trim() || "Sin nombre";
}

function salesAttributionPhone(pedido, conversation) {
  return String(
    pedido?.telefono
      || pedido?.crmTelefonoE164
      || pedido?.telefonoAlt
      || conversation?.telefonoE164
      || conversation?.clienteWaId
      || ""
  ).trim() || "—";
}

function salesAttributionSource(conversation) {
  if (!conversation) return { type: "unknown", label: "Sin conversación CRM", sourceId: "", headline: "" };

  if (isMarketplaceLead(conversation)) {
    const attribution = conversation?.firstAttribution || {};
    const sourceId = String(attribution?.sourceId || conversation?.leadSourceId || "").trim();
    return {
      type: "marketplace",
      label: sourceId ? `Facebook Marketplace · item ${sourceId}` : "Facebook Marketplace",
      sourceId,
      headline: "Facebook Marketplace",
    };
  }

  if (isFacebookContentLead(conversation)) {
    return {
      type: "facebook_content",
      label: "Facebook · contenido compartido",
      sourceId: "",
      headline: "Facebook contenido",
    };
  }

  if (isMetaEntryLead(conversation)) {
    return {
      type: "meta_entry",
      label: leadSourceType(conversation) === "post"
        ? "Publicación Meta"
        : "Entrada Meta confirmada · anuncio o CTA",
      sourceId: "",
      headline: "",
    };
  }

  if (!isAdvertisingLead(conversation)) {
    if (isUnattributedLead(conversation)) {
      return { type: "unknown", label: "Sin identificar", sourceId: "", headline: "" };
    }
    return {
      type: "organic",
      label: "Orgánico / sin publicidad",
      sourceId: "",
      headline: "",
    };
  }

  const referral = firstReferralOf(conversation);
  const sourceId = String(referral?.sourceId || conversation?.leadSourceId || "").trim();
  const headline = String(referral?.headline || conversation?.leadSourceHeadline || "").trim();
  return {
    type: "ad",
    label: `Publicidad · ${headline || sourceId || "sin identificar"}`,
    sourceId,
    headline,
  };
}

function computeSalesAttributionByOrderDate({
  cohortConversations = [],
  allConversations = [],
  historicalPedidos = [],
  pedidos = [],
  seller = "_all",
  startDate = "",
  cohortStartDate = "",
  cohortEndDate = "",
}) {
  const cohortById = new Map(
    cohortConversations
      .map((conversation) => [String(conversation?.id || "").trim(), conversation])
      .filter(([id]) => Boolean(id))
  );

  const allById = new Map(
    allConversations
      .map((conversation) => [String(conversation?.id || "").trim(), conversation])
      .filter(([id]) => Boolean(id))
  );

  for (const [id, conversation] of cohortById.entries()) {
    if (!allById.has(id)) allById.set(id, conversation);
  }

  const conversationByLegacyPedidoId = new Map();
  const conversationsBySellerPhone = new Map();
  const ordersBySellerPhone = new Map();

  const allOrdersForHistory = new Map();
  for (const pedido of [...historicalPedidos, ...pedidos]) {
    const pedidoId = getPedidoId(pedido);
    if (pedidoId) allOrdersForHistory.set(pedidoId, pedido);
  }

  for (const pedido of allOrdersForHistory.values()) {
    const pedidoSeller = getPedidoSeller(pedido);
    const pedidoId = getPedidoId(pedido);
    const orderDate = String(pedido?.fechaStr || "").trim();
    if (!pedidoSeller || !pedidoId || !orderDate) continue;

    for (const phone of pedidoPhoneDigits(pedido)) {
      const key = `${pedidoSeller}|${phone}`;
      if (!ordersBySellerPhone.has(key)) ordersBySellerPhone.set(key, []);
      ordersBySellerPhone.get(key).push({ pedidoId, orderDate });
    }
  }

  for (const [conversationId, conversation] of allById.entries()) {
    const conversationSeller = normalizeEmail(conversation?.assignedToEmail);
    const legacyPedidoId = String(conversation?.crmPedidoId || "").trim();
    if (legacyPedidoId && !conversationByLegacyPedidoId.has(legacyPedidoId)) {
      conversationByLegacyPedidoId.set(legacyPedidoId, { id: conversationId, conversation });
    }

    for (const phone of conversationPhoneDigits(conversation)) {
      const key = `${conversationSeller}|${phone}`;
      if (!conversationsBySellerPhone.has(key)) conversationsBySellerPhone.set(key, []);
      conversationsBySellerPhone.get(key).push({ id: conversationId, conversation });
    }
  }

  const resolveConversationForPedido = (pedido, pedidoSeller, pedidoId, orderDate) => {
    const explicitConversationId = String(pedido?.crmConversationId || "").trim();
    if (explicitConversationId) {
      const explicitConversation = allById.get(explicitConversationId);
      if (explicitConversation) {
        return { id: explicitConversationId, conversation: explicitConversation, linkType: "crmConversationId" };
      }
      return null;
    }

    const legacy = conversationByLegacyPedidoId.get(pedidoId);
    if (legacy) return { ...legacy, linkType: "crmPedidoId" };

    if (!pedidoSeller) return null;

    const candidates = new Map();
    for (const phone of pedidoPhoneDigits(pedido)) {
      const key = `${pedidoSeller}|${phone}`;
      for (const candidate of conversationsBySellerPhone.get(key) || []) {
        candidates.set(candidate.id, candidate.conversation);
      }
    }

    const closest = Array.from(candidates.entries())
      .map(([id, conversation]) => ({
        id,
        conversation,
        leadDateObject: firstInboundDate(conversation),
      }))
      .filter((item) => item.leadDateObject && toDateInput(item.leadDateObject) <= orderDate)
      .sort((left, right) => right.leadDateObject.getTime() - left.leadDateObject.getTime())[0];

    return closest
      ? { id: closest.id, conversation: closest.conversation, linkType: "telefono" }
      : null;
  };

  const hasPreviousOrder = (pedido, conversation, pedidoSeller, pedidoId, orderDate) => {
    if (!pedidoSeller) return false;

    const phones = new Set([
      ...pedidoPhoneDigits(pedido),
      ...conversationPhoneDigits(conversation),
    ]);

    for (const phone of phones) {
      const key = `${pedidoSeller}|${phone}`;
      const priorOrders = ordersBySellerPhone.get(key) || [];
      if (priorOrders.some((item) => item.pedidoId !== pedidoId && item.orderDate < orderDate)) {
        return true;
      }
    }

    return false;
  };

  const rows = new Map();

  for (const pedido of pedidos) {
    const pedidoSeller = getPedidoSeller(pedido);
    if (seller !== "_all" && pedidoSeller !== seller) continue;

    const pedidoId = getPedidoId(pedido);
    const date = String(pedido?.fechaStr || "").trim();
    if (!pedidoId || !date) continue;
    if (startDate && date < startDate) continue;

    const resolved = resolveConversationForPedido(pedido, pedidoSeller, pedidoId, date);
    const conversation = resolved?.conversation || null;
    const conversationId = resolved?.id || "";
    const leadDateObject = firstInboundDate(conversation);
    const leadDate = leadDateObject ? toDateInput(leadDateObject) : "";
    const source = salesAttributionSource(conversation);
    const previousOrder = conversation
      ? hasPreviousOrder(pedido, conversation, pedidoSeller, pedidoId, date)
      : false;

    let category = "unidentified";

    if (conversation) {
      const linkedSeller = normalizeEmail(conversation?.assignedToEmail);
      const sellerMatches = !pedidoSeller || !linkedSeller || pedidoSeller === linkedSeller;
      const belongsToSelectedCohort = sellerMatches && (
        cohortById.has(conversationId)
        || (
          source.type === "ad"
          && leadDate
          && (!cohortStartDate || leadDate >= cohortStartDate)
          && (!cohortEndDate || leadDate < cohortEndDate)
        )
      );

      if (belongsToSelectedCohort) {
        category = "selected";
      } else if (source.type === "ad") {
        category = previousOrder ? "recurrentAd" : "previousLead";
      } else if (source.type === "meta_entry") {
        category = "metaEntry";
      } else if (source.type === "marketplace") {
        category = "marketplace";
      } else if (source.type === "facebook_content") {
        category = "facebookContent";
      } else if (source.type === "unknown") {
        category = "unidentified";
      } else {
        category = "organic";
      }
    }

    const detail = {
      pedidoId,
      date,
      seller: pedidoSeller,
      customerName: salesAttributionCustomerName(pedido, conversation),
      phone: salesAttributionPhone(pedido, conversation),
      conversationId,
      leadDate,
      sourceType: source.type,
      sourceLabel: source.label,
      sourceId: source.sourceId,
      sourceHeadline: source.headline,
      linkType: resolved?.linkType || "",
      hasPreviousOrder: previousOrder,
    };

    if (!rows.has(date)) {
      rows.set(date, {
        date,
        selectedLeadSales: 0,
        previousLeadSales: 0,
        recurrentAdSales: 0,
        metaEntrySales: 0,
        marketplaceSales: 0,
        facebookContentSales: 0,
        organicSales: 0,
        unidentifiedSales: 0,
        total: 0,
        selectedLeadItems: [],
        previousLeadItems: [],
        recurrentAdItems: [],
        metaEntryItems: [],
        marketplaceItems: [],
        facebookContentItems: [],
        organicItems: [],
        unidentifiedItems: [],
        totalItems: [],
      });
    }

    const row = rows.get(date);
    row.total += 1;
    row.totalItems.push(detail);

    if (category === "selected") {
      row.selectedLeadSales += 1;
      row.selectedLeadItems.push(detail);
    } else if (category === "previousLead") {
      row.previousLeadSales += 1;
      row.previousLeadItems.push(detail);
    } else if (category === "recurrentAd") {
      row.recurrentAdSales += 1;
      row.recurrentAdItems.push(detail);
    } else if (category === "metaEntry") {
      row.metaEntrySales += 1;
      row.metaEntryItems.push(detail);
    } else if (category === "marketplace") {
      row.marketplaceSales += 1;
      row.marketplaceItems.push(detail);
    } else if (category === "facebookContent") {
      row.facebookContentSales += 1;
      row.facebookContentItems.push(detail);
    } else if (category === "organic") {
      row.organicSales += 1;
      row.organicItems.push(detail);
    } else {
      row.unidentifiedSales += 1;
      row.unidentifiedItems.push(detail);
    }
  }

  return Array.from(rows.values())
    .filter((row) => row.total > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function computeSalesByVendor({
  vendors = [],
  conversations = [],
  salesOrders = [],
  salesClosures = [],
  conversionTargetPercent = 30,
  jobId,
}) {
  const advertisingByVendor = new Map();

  for (const conversation of conversations) {
    if (!isAdvertisingLead(conversation)) continue;
    const vendor = normalizeEmail(conversation?.assignedToEmail);
    if (!vendor) continue;
    if (!advertisingByVendor.has(vendor)) advertisingByVendor.set(vendor, []);
    advertisingByVendor.get(vendor).push(conversation);
  }

  const rows = [];

  for (let index = 0; index < vendors.length; index += 1) {
    const vendor = normalizeEmail(vendors[index]);
    const vendorConversations = advertisingByVendor.get(vendor) || [];
    const cohorts = computeLeadCohortConversion({
      conversations: vendorConversations,
      pedidos: salesOrders,
      cierres: salesClosures,
      seller: vendor,
    });

    const leads = cohorts.reduce((total, row) => total + Number(row.leads || 0), 0);
    const converted = cohorts.reduce((total, row) => total + Number(row.converted || 0), 0);
    const conversionRate = leads ? (converted / leads) * 100 : 0;
    const salesByDateMap = new Map();

    for (const cohort of cohorts) {
      for (const delivery of cohort.deliveryDates || []) {
        const date = String(delivery?.date || "").trim();
        if (!date) continue;
        salesByDateMap.set(date, (salesByDateMap.get(date) || 0) + Number(delivery?.count || 0));
      }
    }

    if (leads || converted) {
      rows.push({
        vendor,
        leads,
        converted,
        salesByDate: Array.from(salesByDateMap.entries())
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        conversionRate,
        remainingToGoal: Math.max(0, Math.ceil(leads * (conversionTargetPercent / 100)) - converted),
        goalReached: leads > 0 && conversionRate >= conversionTargetPercent,
      });
    }

    if ((index + 1) % 3 === 0 || index === vendors.length - 1) {
      self.postMessage({
        type: "progress",
        scope: "conversion",
        jobId,
        stage: `Calculando vendedores ${Math.min(index + 1, vendors.length)} de ${vendors.length}…`,
      });
    }
  }

  return rows;
}


function analyticsCompactAdText(value, maxLength = 72) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function analyticsSourceInfo(conversation) {
  if (!conversation) {
    return { type: "unknown", label: "Sin conversación CRM", sourceId: "", headline: "" };
  }

  if (isMarketplaceLead(conversation)) {
    const attribution = conversation?.firstAttribution || {};
    const sourceId = String(attribution?.sourceId || conversation?.leadSourceId || "").trim();
    return {
      type: "marketplace",
      label: sourceId ? `Facebook Marketplace · item ${sourceId}` : "Facebook Marketplace",
      sourceId,
      headline: "Facebook Marketplace",
    };
  }

  if (isFacebookContentLead(conversation)) {
    return {
      type: "facebook_content",
      label: "Facebook · contenido compartido",
      sourceId: "",
      headline: "Facebook contenido",
    };
  }

  if (isMetaEntryLead(conversation)) {
    return {
      type: "meta_entry",
      label: leadSourceType(conversation) === "post"
        ? "Publicación Meta"
        : "Entrada Meta confirmada · anuncio o CTA",
      sourceId: "",
      headline: "",
    };
  }

  if (!isAdvertisingLead(conversation)) {
    if (isUnattributedLead(conversation)) {
      return { type: "unknown", label: "Sin identificar", sourceId: "", headline: "" };
    }
    return { type: "organic", label: "Orgánico / sin publicidad", sourceId: "", headline: "" };
  }

  const referral = firstReferralOf(conversation);
  const sourceId = String(referral?.sourceId || conversation?.leadSourceId || "").trim();
  const headline = String(referral?.headline || conversation?.leadSourceHeadline || "").trim();
  const body = String(referral?.body || conversation?.leadSourceBody || "").trim();
  const genericHeadline = /^(chatea con nosotros|enviar mensaje|m[aá]s informaci[oó]n|contactanos|cont[aá]ctanos)$/i.test(headline);
  const displayName = analyticsCompactAdText(
    (!genericHeadline && headline) || body || headline || sourceId || "Publicidad sin identificar"
  );

  return {
    type: "ad",
    label: `Publicidad · ${displayName}`,
    sourceId,
    headline: displayName,
  };
}

function buildAnalyticsConversationResolver(conversations = []) {
  const byId = new Map();
  const bySellerPhone = new Map();
  const byLegacyPedidoId = new Map();

  for (const conversation of conversations) {
    const id = String(conversation?.id || "").trim();
    if (!id) continue;
    byId.set(id, conversation);

    const seller = normalizeEmail(conversation?.assignedToEmail);
    for (const phone of conversationPhoneDigits(conversation)) {
      const key = `${seller}|${phone}`;
      if (!bySellerPhone.has(key)) bySellerPhone.set(key, []);
      bySellerPhone.get(key).push({ id, conversation });
    }

    const legacyPedidoId = String(conversation?.crmPedidoId || "").trim();
    if (legacyPedidoId && !byLegacyPedidoId.has(legacyPedidoId)) {
      byLegacyPedidoId.set(legacyPedidoId, { id, conversation });
    }
  }

  return { byId, bySellerPhone, byLegacyPedidoId };
}

function resolveAnalyticsConversationForOrder(pedido, resolver) {
  const seller = getPedidoSeller(pedido);
  const pedidoId = getPedidoId(pedido);
  const orderDate = String(pedido?.fechaStr || "").trim();
  const explicitId = String(pedido?.crmConversationId || "").trim();

  if (explicitId) {
    const conversation = resolver.byId.get(explicitId);
    return conversation ? { id: explicitId, conversation, linkType: "crmConversationId" } : null;
  }

  const legacy = resolver.byLegacyPedidoId.get(pedidoId);
  if (legacy) return { ...legacy, linkType: "crmPedidoId" };
  if (!seller || !orderDate) return null;

  const candidates = new Map();
  for (const phone of pedidoPhoneDigits(pedido)) {
    for (const item of resolver.bySellerPhone.get(`${seller}|${phone}`) || []) {
      candidates.set(item.id, item.conversation);
    }
  }

  const closest = Array.from(candidates.entries())
    .map(([id, conversation]) => ({ id, conversation, inbound: firstInboundDate(conversation) }))
    .filter((item) => item.inbound && toDateInput(item.inbound) <= orderDate)
    .sort((a, b) => b.inbound.getTime() - a.inbound.getTime())[0];

  return closest ? { id: closest.id, conversation: closest.conversation, linkType: "telefono" } : null;
}

function buildAnalyticsOrdersBySellerPhone(orders = []) {
  const map = new Map();
  for (const pedido of orders) {
    const seller = getPedidoSeller(pedido);
    const id = getPedidoId(pedido);
    const date = String(pedido?.fechaStr || "").trim();
    if (!seller || !id || !date) continue;
    for (const phone of pedidoPhoneDigits(pedido)) {
      const key = `${seller}|${phone}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ pedidoId: id, orderDate: date });
    }
  }
  return map;
}

function analyticsHasPreviousOrder({ pedido, conversation, ordersBySellerPhone }) {
  const seller = getPedidoSeller(pedido);
  const pedidoId = getPedidoId(pedido);
  const orderDate = String(pedido?.fechaStr || "").trim();
  if (!seller || !pedidoId || !orderDate) return false;

  const phones = new Set([...pedidoPhoneDigits(pedido), ...conversationPhoneDigits(conversation)]);
  for (const phone of phones) {
    const previous = ordersBySellerPhone.get(`${seller}|${phone}`) || [];
    if (previous.some((row) => row.pedidoId !== pedidoId && row.orderDate < orderDate)) return true;
  }
  return false;
}

function buildAnalyticsAttributionRecords({
  cohortConversations = [],
  allConversations = [],
  historicalOrders = [],
  orders = [],
  seller = "_all",
  startKey = "",
  endKey = "",
}) {
  const cohortIds = new Set(cohortConversations.map((row) => String(row?.id || "").trim()).filter(Boolean));
  const resolver = buildAnalyticsConversationResolver([...allConversations, ...cohortConversations]);
  const ordersBySellerPhone = buildAnalyticsOrdersBySellerPhone([...historicalOrders, ...orders]);

  return orders
    .filter((pedido) => {
      const date = String(pedido?.fechaStr || "").trim();
      if (!date || (startKey && date < startKey) || (endKey && date >= endKey)) return false;
      return seller === "_all" || getPedidoSeller(pedido) === seller;
    })
    .map((pedido) => {
      const resolved = resolveAnalyticsConversationForOrder(pedido, resolver);
      const conversation = resolved?.conversation || null;
      const conversationId = resolved?.id || "";
      const leadDateObject = firstInboundDate(conversation);
      const leadDate = leadDateObject ? toDateInput(leadDateObject) : "";
      const source = analyticsSourceInfo(conversation);
      const previousOrder = conversation
        ? analyticsHasPreviousOrder({ pedido, conversation, ordersBySellerPhone })
        : false;
      const pedidoSeller = getPedidoSeller(pedido);
      const linkedSeller = normalizeEmail(conversation?.assignedToEmail);
      const sellerMatches = !pedidoSeller || !linkedSeller || pedidoSeller === linkedSeller;

      let category = "unidentified";
      if (conversation) {
        const inCohort = sellerMatches && (
          cohortIds.has(conversationId)
          || (source.type === "ad" && leadDate >= startKey && leadDate < endKey)
        );

        if (inCohort) {
          category = "selected";
        } else if (source.type === "ad") {
          category = previousOrder ? "recurrentAd" : "previousLead";
        } else if (source.type === "meta_entry") {
          category = "metaEntry";
        } else if (source.type === "marketplace") {
          category = "marketplace";
        } else if (source.type === "facebook_content") {
          category = "facebookContent";
        } else if (source.type === "unknown") {
          category = "unidentified";
        } else {
          category = "organic";
        }
      }

      return {
        category,
        pedido,
        conversation,
        conversationId,
        linkType: resolved?.linkType || "",
        leadDate,
        source,
        hasPreviousOrder: previousOrder,
      };
    });
}

function buildAnalyticsCohortConversions({ conversations = [], orders = [], seller = "_all" }) {
  const selected = conversations.filter((conversation) => (
    seller === "_all" || normalizeEmail(conversation?.assignedToEmail) === seller
  ));
  const byId = new Map(selected.map((row) => [String(row?.id || "").trim(), row]).filter(([id]) => id));
  const bySellerPhone = new Map();

  for (const [id, conversation] of byId.entries()) {
    const assigned = normalizeEmail(conversation?.assignedToEmail);
    for (const phone of conversationPhoneDigits(conversation)) {
      const key = `${assigned}|${phone}`;
      if (!bySellerPhone.has(key)) bySellerPhone.set(key, []);
      bySellerPhone.get(key).push({ id, conversation });
    }
  }

  const firstOrderByConversation = new Map();
  for (const pedido of orders) {
    const pedidoSeller = getPedidoSeller(pedido);
    if (seller !== "_all" && pedidoSeller !== seller) continue;
    const orderDate = String(pedido?.fechaStr || "").trim();
    if (!orderDate) continue;

    let conversationId = String(pedido?.crmConversationId || "").trim();
    if (conversationId && !byId.has(conversationId)) continue;

    if (!conversationId && pedidoSeller) {
      const candidates = new Map();
      for (const phone of pedidoPhoneDigits(pedido)) {
        for (const item of bySellerPhone.get(`${pedidoSeller}|${phone}`) || []) {
          candidates.set(item.id, item.conversation);
        }
      }
      const closest = Array.from(candidates.entries())
        .map(([id, conversation]) => ({ id, inbound: firstInboundDate(conversation) }))
        .filter((item) => item.inbound && toDateInput(item.inbound) <= orderDate)
        .sort((a, b) => b.inbound.getTime() - a.inbound.getTime())[0];
      conversationId = closest?.id || "";
    }

    if (!conversationId) continue;
    const leadDate = firstInboundDate(byId.get(conversationId));
    if (!leadDate || orderDate < toDateInput(leadDate)) continue;

    const current = firstOrderByConversation.get(conversationId);
    if (!current || orderDate < String(current?.fechaStr || "")) {
      firstOrderByConversation.set(conversationId, pedido);
    }
  }

  return {
    firstOrderEntries: Array.from(firstOrderByConversation.entries()),
    convertedConversationIds: Array.from(firstOrderByConversation.keys()),
  };
}

self.onmessage = (event) => {
  const message = event?.data || {};
  const { type, jobId, payload = {} } = message;

  try {
    if (type === "computeAnalyticsPrimary") {
      self.postMessage({
        type: "progress",
        scope: "analytics-primary",
        jobId,
        stage: "Calculando conversión y publicidades…",
      });

      const result = buildAnalyticsCohortConversions({
        conversations: payload.adConversations || [],
        orders: payload.orders || [],
        seller: payload.seller || "_all",
      });

      self.postMessage({
        type: "analyticsPrimaryResult",
        jobId,
        ...result,
      });
      return;
    }

    if (type === "computeAnalyticsAttribution") {
      self.postMessage({
        type: "progress",
        scope: "analytics-attribution",
        jobId,
        stage: "Clasificando el origen de las ventas…",
      });

      const records = buildAnalyticsAttributionRecords({
        cohortConversations: payload.adConversations || [],
        allConversations: payload.historyConversations || [],
        historicalOrders: payload.historicalOrders || [],
        orders: payload.orders || [],
        seller: payload.seller || "_all",
        startKey: payload.startKey || "",
        endKey: payload.endKey || "",
      });

      self.postMessage({
        type: "analyticsAttributionResult",
        jobId,
        records,
      });
      return;
    }

    if (type === "computeConversion") {
      self.postMessage({
        type: "progress",
        scope: "conversion",
        jobId,
        stage: "Calculando conversión general…",
      });

      const leadCohortRows = computeLeadCohortConversion({
        conversations: payload.selectedAdvertisingRows || [],
        pedidos: payload.salesOrders || [],
        cierres: payload.salesClosures || [],
        seller: payload.selectedVendor || "_all",
      });

      let salesByVendor = [];
      if ((payload.selectedVendor || "_all") === "_all") {
        salesByVendor = computeSalesByVendor({
          vendors: payload.vendors || [],
          conversations: payload.conversations || [],
          salesOrders: payload.salesOrders || [],
          salesClosures: payload.salesClosures || [],
          conversionTargetPercent: Number(payload.conversionTargetPercent || 30),
          jobId,
        });
      }

      self.postMessage({
        type: "conversionResult",
        jobId,
        leadCohortRows,
        salesByVendor,
      });
      return;
    }

    if (type === "computeAttribution") {
      self.postMessage({
        type: "progress",
        scope: "attribution",
        jobId,
        stage: "Cruzando pedidos con el historial CRM…",
      });

      const rows = computeSalesAttributionByOrderDate({
        cohortConversations: payload.selectedAdvertisingRows || [],
        allConversations: payload.attributionConversations || [],
        historicalPedidos: payload.attributionHistoricalOrders || [],
        pedidos: payload.salesOrders || [],
        seller: payload.selectedVendor || "_all",
        startDate: payload.startDate || "",
        cohortStartDate: payload.cohortStartDate || "",
        cohortEndDate: payload.cohortEndDate || "",
      });

      self.postMessage({
        type: "attributionResult",
        jobId,
        rows,
      });
    }
  } catch (error) {
    const scope = type === "computeAttribution"
      ? "attribution"
      : type === "computeAnalyticsAttribution"
        ? "analytics-attribution"
        : type === "computeAnalyticsPrimary"
          ? "analytics-primary"
          : "conversion";

    self.postMessage({
      type: "workerError",
      scope,
      jobId,
      message: error?.message || "No se pudo procesar la analítica de ventas.",
    });
  }
};
