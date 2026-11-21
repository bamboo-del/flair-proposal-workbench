(function () {
  "use strict";

  const DATA = window.NEWCLOUD_DATA;
  if (!DATA) {
    document.body.innerHTML =
      '<p style="padding:32px;font-family:sans-serif">数据文件未载入，请确认 assets/data.js 存在。</p>';
    return;
  }

  const teaZones = ["jingan", "lujiazui", "nanjing_east", "huaihai", "xujiahui", "wujiaochang"];
  DATA.brands.tea = {
    ...DATA.brands.food,
    brand: "某连锁茶饮品牌",
    campaign: "春醒上海",
    headline: "春醒上海",
    subhead: "在上海核心商圈，以公交触达通勤客流、以地铁口承接门店打卡与新品上市。",
    audience: "核心商圈通勤人群、周末商圈客流",
    proposition: "沿通勤和逛街的动线，以出站步行触点衔接门店打卡。",
    kpis: ["核心商圈覆盖", "门店打卡参与", "新品认知"],
    targetZones: DATA.zones.filter((zone) => teaZones.includes(zone.id))
      .map((zone) => ({ id: zone.id, weight: 1, label: zone.name })),
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const LEVEL_RANK = {
    S: 5,
    "A++": 4,
    "A+": 3,
    AA: 2,
    A: 1,
  };

  const ZONE_KEYWORDS = {
    renmin: ["人民广场", "上海火车站", "人民"],
    nanjing_east: ["南京东路", "豫园", "南京东"],
    nanjing_west: ["南京西路", "南京西"],
    jingan: ["静安"],
    huaihai: ["淮海", "陕西南路"],
    xintiandi: ["新天地"],
    xujiahui: ["徐家汇"],
    lujiazui: ["陆家嘴", "浦东"],
    zhongshan: ["中山公园", "长宁"],
    wujiaochang: ["五角场", "杨浦"],
    hongqiao: ["虹桥"],
    qiantan: ["前滩", "东方体育中心"],
    longyang: ["龙阳路", "花木"],
    haichang: ["海昌", "海洋公园"],
  };

  const FIELD_ALIASES = {
    mediaType: ["媒体类型", "资源类型", "类型", "media", "mediatype", "媒体形式"],
    mediaFormat: ["媒体形式", "车身形式", "媒体规格", "广告形式", "format"],
    routeName: ["线路名称", "线路号", "线路", "路别", "route", "line", "routeName"],
    pointName: [
      "线路/点位名称",
      "点位名称",
      "站点名称",
      "出口名称",
      "站名",
      "点位",
      "站点",
      "出口",
      "point",
      "station",
      "pointName",
    ],
    station: ["站点", "站名", "车站", "station"],
    exitName: ["出入口", "出口", "exit"],
    level: ["线路等级", "媒体等级", "资源等级", "等级", "level"],
    total: ["媒体总数", "车辆总数", "总数", "数量", "total"],
    available: ["空车数", "可售数量", "可用数量", "剩余可售", "空位", "可用", "available"],
    contracted: ["合同车数", "合同数", "已售数量", "合同", "contracted", "sold"],
    reserved: ["预定车数", "预定数", "暂占", "reserved"],
    status: ["可售状态", "状态", "status"],
    operator: ["运营公司", "运营单位", "公司", "operator", "operater"],
    sourceDate: ["数据日期", "查询日期", "日期", "date", "asof"],
    queryStart: ["查询起日", "查询开始日期", "查询开始", "查询起始日", "档期开始", "queryStart"],
    queryEnd: ["查询止日", "查询结束日期", "查询结束", "查询终止日", "档期结束", "queryEnd"],
    area: ["画面面积", "实际面积", "面积", "area", "areaSqm"],
    lines: ["地铁线路", "轨道线路", "线路号", "lines"],
  };

  const state = {
    industry: DATA.meta.defaultIndustry || "food",
    brand: "",
    budget: DATA.meta.defaultBudget || 2000000,
    media: new Set(DATA.meta.defaultMedia || ["bus", "metro"]),
    startDate: DATA.meta.defaultStartDate || "2027-05-10",
    duration: DATA.meta.defaultDuration || 30,
    strategy: DATA.meta.defaultStrategy || "coverage",
    packages: [],
    tableView: "selected",
    selectedMediaId: null,
    mapExpanded: false,
    busRoutes: clone(DATA.busRoutes),
    metroPoints: clone(DATA.subwayPoints),
    sources: clone(DATA.meta.sources),
    importedKinds: new Set(),
    inventoryAsOf: DATA.meta.sources.find((source) => source.id === "bus-ledger")?.asOf || "",
    lastImportName: "",
    toastTimer: null,
    polishTimer: null,
    brandTimer: null,
    diffBase: null,
    editingArea: null,
    coverageMatches: null,
    coverageEvidence: "",
  };

  state.brand = DATA.brands[state.industry].brand;

  const zoneById = new Map(DATA.zones.map((zone) => [zone.id, zone]));
  const pricing = () => state.rateCard || (state.sample === false ? null : DATA.rates);
  const metroRate = () => pricing()?.metroProductionPerSqm;
  const budgetCap = () => Math.floor(state.budget * 0.95);
  const metroProductionFee = (area) => Math.round(metroRate() * area * 100) / 100;

  function planWindow() {
    return { start: state.startDate, end: addDays(state.startDate, state.duration - 1) };
  }

  function defaultDemoWindow() {
    return state.industry === "tea" ? { start: "2027-03-01", duration: 31 }
      : { start: DATA.meta.defaultStartDate, duration: DATA.meta.defaultDuration };
  }

  function isDemoWindow() {
    const demo = defaultDemoWindow();
    return state.sample !== false && !state.importedKinds.size && state.startDate === demo.start && state.duration === demo.duration;
  }

  function inventoryState(row) {
    if (!(row.available > 0) || ["sold", "unavailable", "reserved"].includes(row.status)) return "blocked";
    const { start, end } = planWindow();
    if (row.sourceState === "imported" && row.queryStart === start && row.queryEnd === end) return "matched";
    if (row.sourceState !== "imported" && isDemoWindow()) return "sample";
    return "stale";
  }

  const inventoryLabels = {
    blocked: "不可售",
    matched: "档期已核对 · 待抽检",
    sample: "演示估算 · 待重查",
    stale: "待重查 · 未入组合",
  };

  function evidenceFor(row) {
    const snapshotDate = row.sourceState === "snapshot" ? row.asOf : "";
    return {
      availabilityState: inventoryState(row),
      queryStart: row.queryStart || snapshotDate,
      queryEnd: row.queryEnd || snapshotDate,
    };
  }

  function queryLabel(resource) {
    if (!resource.queryStart || !resource.queryEnd) return "查询区间缺失";
    if (resource.queryStart === resource.queryEnd) return resource.queryStart + "（单日）";
    return resource.queryStart + " 至 " + resource.queryEnd;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return entities[character];
    });
  }

  function formatMoney(value, options = {}) {
    const { compact = false } = options;
    if (!Number.isFinite(value)) return "--";
    if (Math.abs(value) >= 100000000) {
      const yi = value / 100000000;
      return `¥${yi.toFixed(yi >= 10 ? 0 : 1)}亿`;
    }
    const wan = value / 10000;
    const digits = compact || Math.abs(wan) >= 100 ? (Number.isInteger(wan) ? 0 : 1) : 1;
    return `¥${wan.toFixed(digits).replace(/\.0$/, "")}万`;
  }

  function formatPriceRange(candidate, kind) {
    const range = candidate.range;
    if (!range) return "--";
    if (kind === "bus") {
      return `${formatMoney(range.min, { compact: true })}–${formatMoney(range.max, { compact: true })} / 辆`;
    }
    return `${formatMoney(range.min, { compact: true })}–${formatMoney(range.max, { compact: true })} / 点`;
  }

  function parseISODate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function toISODate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addDays(value, amount) {
    const date = typeof value === "string" ? parseISODate(value) : new Date(value);
    if (!date) return value;
    date.setDate(date.getDate() + Number(amount || 0));
    return toISODate(date);
  }

  function differenceInDays(startValue, endValue) {
    const start = typeof startValue === "string" ? parseISODate(startValue) : startValue;
    const end = typeof endValue === "string" ? parseISODate(endValue) : endValue;
    if (!start || !end) return 0;
    return Math.round((end.getTime() - start.getTime()) / 86400000);
  }

  function formatDate(value, separator = ".") {
    const date = typeof value === "string" ? parseISODate(value) : value;
    if (!date) return "--";
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join(separator);
  }

  function formatDateShort(value) {
    const date = typeof value === "string" ? parseISODate(value) : value;
    if (!date) return "--";
    return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatDateRange(start, end) {
    return start === end ? formatDate(start) : `${formatDate(start)} — ${formatDate(end)}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function stableNumber(value, modulo) {
    let hash = 2166136261;
    for (let index = 0; index < String(value).length; index += 1) {
      hash ^= String(value).charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash) % modulo;
  }

  function normalizeText(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[_\-\/\\:：()（）[\]【】]/g, "");
  }

  function parseNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const cleaned = String(value ?? "").replace(/[^\d.-]/g, "");
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeLevel(value) {
    const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "").replace(/[＋]/g, "+");
    const grade = raw.match(/^(A\+\+|A\+|AA|A|S)(?:级|类)?$/)?.[1];
    return grade || "待核";
  }

  function getBrandProfile() {
    const base = clone(DATA.brands[state.industry]);
    base.brand = state.brand.trim() || base.brand;
    const assumptions = state.assumptions || {};
    base.campaign = state.campaign || base.campaign;
    base.headline = state.campaign || base.headline;
    base.subhead = assumptions.business || base.subhead;
    base.audience = assumptions.audience || base.audience;
    base.proposition = assumptions.goal || base.proposition;
    if (state.targets?.length) {
      base.targetZones = state.targets.map(({ id, label, priority }) => ({ id, label, weight: priority ? 1 : 0.75 }));
    }
    return base;
  }

  function getTargetZoneData(profile) {
    return profile.targetZones
      .map((target) => {
        const zone = zoneById.get(target.id);
        return zone ? { ...target, zone } : null;
      })
      .filter(Boolean);
  }

  function getRate(kind, level) {
    const table = pricing()?.[kind];
    if (!table) return null;
    return table[level] || (state.sample !== false ? table["A+"] : null);
  }

  function unitEconomics(kind, level, actualArea) {
    const rate = getRate(kind, level);
    if (!rate) return { productionPending: true, range: null };
    const catalog = pricing();
    const monthFactor = state.duration / 30 * (state.rateCard?.discount || 1);
    if (kind === "bus") {
      return {
        media: rate.mid * monthFactor,
        mediaMin: rate.min * monthFactor,
        mediaMax: rate.max * monthFactor,
        production: catalog.busProductionMid,
        productionMin: catalog.busProductionMin,
        productionMax: catalog.busProductionMax,
        mid: rate.mid * monthFactor + catalog.busProductionMid,
        min: rate.min * monthFactor + catalog.busProductionMin,
        max: rate.max * monthFactor + catalog.busProductionMax,
        monthly: rate.mid,
        range: rate,
      };
    }
    const productionPending = !(Number.isFinite(actualArea) && actualArea > 0);
    const production = productionPending ? 0 : metroProductionFee(actualArea);
    return {
      actualArea: productionPending ? null : actualArea,
      productionPending,
      media: rate.mid * monthFactor,
      mediaMin: rate.min * monthFactor,
      mediaMax: rate.max * monthFactor,
      production,
      productionMin: production,
      productionMax: production,
      mid: rate.mid * monthFactor + production,
      min: rate.min * monthFactor + production,
      max: rate.max * monthFactor + production,
      monthly: rate.mid,
      range: rate,
    };
  }

  function routeZoneNames(route) {
    return (route.zoneIds || [])
      .map((id) => zoneById.get(id)?.name)
      .filter(Boolean)
      .join(" · ");
  }

  function routeReason(route, strategy, targetMap) {
    const zones = routeZoneNames(route);
    const weight = (route.zoneIds || []).reduce(
      (sum, id) => sum + (targetMap.get(id)?.weight || 0),
      0,
    );
    if (strategy === "commute") {
      return `位于${zones || "城市通勤带"}，以车身重复触达换取频次；策略圈权重 ${weight.toFixed(2)}。`;
    }
    if (strategy === "impact") {
      return `${route.level} 级车身覆盖${zones || "核心城市界面"}，用于建立高密度城市存在感。`;
    }
    return `连接${zones || "目标生活圈"}，补齐门店与商圈之间的路径覆盖；策略圈权重 ${weight.toFixed(2)}。`;
  }

  function metroReason(point, strategy, targetMap) {
    const zone = zoneById.get(point.zoneId);
    const weight = targetMap.get(point.zoneId)?.weight || 0;
    if (strategy === "commute") {
      return `${point.station} ${point.exit} 位于通勤换乘节点，补足公交走廊的轨道触点；圈权重 ${weight.toFixed(2)}。`;
    }
    if (strategy === "impact") {
      return `${point.level} 级核心出入口，选择${zone?.name || "目标商圈"}建立高势能品牌触点。`;
    }
    return `以${zone?.name || "目标商圈"}出入口承接最后一公里，让地铁点到门店形成连续路径。`;
  }

  function buildCandidates(kind, profile, strategy) {
    const targetMap = new Map(profile.targetZones.map((target) => [target.id, target]));
    if (kind === "bus") {
      return state.busRoutes
        .filter((route) => getRate("bus", route.level) && ["matched", "sample"].includes(inventoryState(route)))
        .map((entry) => {
          const route = { ...entry, zoneIds: coverageZones("bus", entry) };
          const weights = (route.zoneIds || []).map((id) => targetMap.get(id)?.weight || 0);
          const targetWeight = weights.reduce((sum, value) => sum + value, 0);
          const demand =
            (route.zoneIds || []).reduce(
              (sum, id) => sum + (zoneById.get(id)?.demandIndex || 0),
              0,
            ) / Math.max(route.zoneIds.length, 1);
          const level = LEVEL_RANK[route.level] || 1;
          const noise = stableNumber(route.id, 100) / 1000;
          const strategyScore =
            strategy === "commute"
              ? targetWeight * 3.1 + demand / 58 + level * 0.15 + noise
              : strategy === "impact"
                ? targetWeight * 2.9 + demand / 42 + level * 0.62 + noise
                : targetWeight * 3.8 + demand / 54 + level * 0.28 + noise;
          const economics = unitEconomics("bus", route.level);
          return {
            id: `bus:${route.id}`,
            kind: "bus",
            refId: route.id,
            name: `${route.route} 路`,
            route: route.route,
            operator: route.operator,
            level: route.level,
            mediaType: route.mediaType,
            zoneIds: route.zoneIds || [],
            maxUnits: Math.max(1, Number(route.available) || 0),
            available: Number(route.available) || 0,
            contracted: Number(route.contracted) || 0,
            reserved: Number(route.reserved) || 0,
            total: Number(route.total) || 0,
            asOf: route.asOf || state.inventoryAsOf,
            sourceState: route.sourceState || "snapshot",
            ...evidenceFor(route),
            score: strategyScore,
            reason: route.zoneIds.length ? routeReason(route, strategy, targetMap) : "商圈命中待核；当前仅有库存和刊例依据。",
            ...economics,
          };
        })
        .sort((first, second) => second.score - first.score || first.name.localeCompare(second.name));
    }

    return state.metroPoints
      .filter((point) => getRate("metro", point.level) && ["matched", "sample"].includes(inventoryState(point)))
      .map((entry) => {
        const zoneIds = coverageZones("metro", entry);
        const point = { ...entry, zoneId: zoneIds[0] };
        const targetWeight = zoneIds.reduce((sum, id) => sum + (targetMap.get(id)?.weight || 0), 0);
        const demand = point.demandIndex || zoneById.get(point.zoneId)?.demandIndex || 0;
        const level = LEVEL_RANK[point.level] || 1;
        const noise = stableNumber(point.id, 100) / 1000;
        const strategyScore =
          strategy === "commute"
            ? targetWeight * 2.8 + demand / 62 + level * 0.2 + noise
            : strategy === "impact"
              ? targetWeight * 2.8 + demand / 34 + level * 0.78 + noise
              : targetWeight * 4.1 + demand / 55 + level * 0.32 + noise;
        const economics = unitEconomics("metro", point.level, point.actualArea);
        return {
          id: `metro:${point.id}`,
          kind: "metro",
          refId: point.id,
          name: point.name,
          station: point.station,
          exit: point.exit,
          level: point.level,
          lines: point.lines || [],
          zoneId: point.zoneId,
          zoneIds,
          maxUnits: 1,
          available: Number(point.available) || 0,
          contracted: Number(point.contracted) || 0,
          reserved: Number(point.reserved) || 0,
          asOf: point.asOf || state.inventoryAsOf,
          sourceState: point.sourceState || "demo",
          ...evidenceFor(point),
          demandIndex: demand,
          score: strategyScore,
          reason: zoneIds.length ? metroReason(point, strategy, targetMap) : "商圈命中待核；当前仅有库存和刊例依据。",
          ...economics,
        };
      })
      .sort((first, second) => second.score - first.score || first.name.localeCompare(second.name));
  }

  function chooseUnits(candidates, targetSpend, hardCap) {
    const selected = [];
    let spend = 0;
    let spendMax = 0;
    const selectedCount = new Map();
    const effectiveTarget = Math.max(0, targetSpend);
    const effectiveCap = Math.max(0, hardCap);

    for (let pass = 0; pass < 2; pass += 1) {
      for (const candidate of candidates) {
        const count = selectedCount.get(candidate.id) || 0;
        const passLimit = pass === 0 ? 1 : Math.min(candidate.maxUnits, 2);
        if (count >= passLimit) continue;
        if (spendMax + candidate.max > effectiveCap + 0.01) continue;
        if (
          spend > 0 &&
          spend + candidate.mid > effectiveTarget * 1.025 + 0.01 &&
          spend >= effectiveTarget * 0.94
        ) {
          continue;
        }
        if (spend > 0 && spend + candidate.mid > effectiveTarget * 1.08 + 0.01) {
          continue;
        }
        selected.push(candidate);
        selectedCount.set(candidate.id, count + 1);
        spend += candidate.mid;
        spendMax += candidate.max;
        if (spend >= effectiveTarget * 0.985) break;
      }
      if (spend >= effectiveTarget * 0.94) break;
    }

    const grouped = [];
    for (const candidate of selected) {
      const existing = grouped.find((item) => item.id === candidate.id);
      if (existing) {
        existing.units += 1;
        existing.spend += candidate.mid;
        existing.spendMin += candidate.min;
        existing.spendMax += candidate.max;
        existing.mediaSpend += candidate.media;
        existing.productionSpend += candidate.production;
      } else {
        grouped.push({
          ...candidate,
          units: 1,
          spend: candidate.mid,
          spendMin: candidate.min,
          spendMax: candidate.max,
          mediaSpend: candidate.media,
          productionSpend: candidate.production,
        });
      }
    }
    return { items: grouped, spend, spendMax };
  }

  function calculateCoverage(busItems, metroItems, targetZones) {
    const covered = new Set();
    busItems.forEach((item) => item.zoneIds.forEach((id) => covered.add(id)));
    metroItems.forEach((item) => item.zoneIds.forEach((id) => covered.add(id)));
    const totalWeight = targetZones.reduce((sum, target) => sum + target.weight, 0) || 1;
    const coveredWeight = targetZones
      .filter((target) => covered.has(target.id))
      .reduce((sum, target) => sum + target.weight, 0);
    return {
      coveredZoneIds: Array.from(covered).filter((id) =>
        targetZones.some((target) => target.id === id),
      ),
      coverage: Math.round((coveredWeight / totalWeight) * 100),
    };
  }

  function buildPackage(strategy, profile) {
    const hasBus = state.media.has("bus");
    const hasMetro = state.media.has("metro");
    const busShare = hasBus ? strategy.busShare : 0;
    const metroShare = hasMetro ? strategy.metroShare : 0;
    const totalShare = busShare + metroShare || 1;
    const normalizedBusShare = busShare / totalShare;
    const normalizedMetroShare = metroShare / totalShare;
    const targetZones = getTargetZoneData(profile);
    const busCandidates = hasBus
      ? buildCandidates("bus", profile, strategy.id)
      : [];
    const metroCandidates = hasMetro
      ? buildCandidates("metro", profile, strategy.id)
      : [];
    const totalBudget = state.budget;
    const cap = budgetCap();
    const cheapestBus = Math.min(...busCandidates.map((row) => row.max));
    const cheapestMetro = Math.min(...metroCandidates.map((row) => row.max));
    const canMix = hasBus && hasMetro && cheapestBus + cheapestMetro <= cap;
    const busTarget = Math.min(totalBudget * normalizedBusShare, canMix ? cap - cheapestMetro : cap);
    const busSelection = hasBus
      ? chooseUnits(busCandidates, busTarget, canMix ? cap - cheapestMetro : cap)
      : { items: [], spend: 0 };
    const remainingAfterBus = cap - (busSelection.spendMax || 0);
    const metroTarget = Math.min(
      totalBudget * normalizedMetroShare,
      remainingAfterBus,
    );
    const metroSelection = hasMetro
      ? chooseUnits(metroCandidates, metroTarget, remainingAfterBus)
      : { items: [], spend: 0 };

    const busSpend = busSelection.items.reduce((sum, item) => sum + item.mediaSpend, 0);
    const busProduction = busSelection.items.reduce(
      (sum, item) => sum + item.productionSpend,
      0,
    );
    const metroSpend = metroSelection.items.reduce((sum, item) => sum + item.mediaSpend, 0);
    const metroProduction = metroSelection.items.reduce(
      (sum, item) => sum + item.productionSpend,
      0,
    );
    const totalMid =
      busSelection.spend + metroSelection.spend;
    const totalMin =
      busSelection.items.reduce((sum, item) => sum + item.spendMin, 0) +
      metroSelection.items.reduce((sum, item) => sum + item.spendMin, 0);
    const totalMax =
      busSelection.items.reduce((sum, item) => sum + item.spendMax, 0) +
      metroSelection.items.reduce((sum, item) => sum + item.spendMax, 0);
    const busCount = busSelection.items.reduce((sum, item) => sum + item.units, 0);
    const metroCount = metroSelection.items.reduce((sum, item) => sum + item.units, 0);
    const coverageData = calculateCoverage(
      busSelection.items,
      metroSelection.items,
      targetZones,
    );

    return {
      strategy,
      busItems: busSelection.items,
      metroItems: metroSelection.items,
      busCandidates,
      metroCandidates,
      busCount,
      metroCount,
      mixUnmet: hasBus && hasMetro && (!busCount || !metroCount),
      pendingProductionCount: metroSelection.items.filter((item) => item.productionPending).length,
      mediaCount: busCount + metroCount,
      busSpend,
      metroSpend,
      busProduction,
      metroProduction,
      productionSpend: busProduction + metroProduction,
      totalMid,
      totalMin,
      totalMax,
      budgetUsage: totalBudget ? Math.round((totalMid / totalBudget) * 100) : 0,
      savings: cap - totalMax,
      coverage: coverageData.coverage,
      coveredZoneIds: coverageData.coveredZoneIds,
      targetZones,
      requestedMix: {
        bus: Math.round(normalizedBusShare * 100),
        metro: Math.round(normalizedMetroShare * 100),
      },
    };
  }

  function currentPackage() {
    return (
      state.packages.find((candidate) => candidate.strategy.id === state.strategy) ||
      state.packages[0]
    );
  }

  function currentProfile() {
    return getBrandProfile();
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (!element) return;
    const next = String(value ?? "");
    if (element.textContent === next) return;
    element.textContent = next;
  }

  function setHTML(id, value) {
    const element = document.getElementById(id);
    if (element) element.innerHTML = value;
  }

  function flashValue(element) {
    if (!element) return;
    element.classList.remove("value-updated");
    void element.offsetWidth;
    element.classList.add("value-updated");
  }

  function renderControls() {
    const industrySelect = $("#industrySelect");
    if (industrySelect) industrySelect.value = state.industry;
    setValue("#brandInput", state.brand);
    const startDateInput = $("#startDateInput");
    if (startDateInput) {
      startDateInput.max = addDays("2027-12-31", -(Number(state.duration) || 30) + 1);
    }
    setValue("#startDateInput", state.startDate);
    setValue("#durationSelect", String(state.duration));
    $$("#budgetButtons button").forEach((button) => {
      const active = Number(button.dataset.budget) === state.budget;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $$("#mediaToggles button").forEach((button) => {
      const active = state.media.has(button.dataset.media);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setValue(selector, value) {
    const element = $(selector);
    if (element && element.value !== String(value)) element.value = value;
  }

  function renderHero() {
    const profile = currentProfile();
    const pack = currentPackage();
    if (!pack) return;
    const start = state.startDate;
    const end = addDays(start, state.duration - 1);
    setText("heroWindow", `${formatDate(start)} — ${formatDate(end)}`);
    setText("heroBrand", profile.brand + " · 投放提案（拟议）");
    setText("heroHeadline", ["food", "tea"].includes(state.industry) ? profile.campaign : profile.headline);
    setText("heroSubhead", `${profile.subhead} 目标人群：${profile.audience}`);
    setText("heroProposition", profile.proposition);
    setText("strategyBudgetLabel", `${state.budget / 10000} 万`);

    const confidence = getDataConfidence();
    const confidenceElement = $("#heroDataConfidence");
    if (confidenceElement) {
      confidenceElement.textContent = confidence.hero;
      confidenceElement.classList.toggle("is-verified", confidence.level === "verified");
    }
  }

  function renderPlanCards() {
    const container = $("#planCards");
    if (!container) return;
    container.innerHTML = state.packages
      .map((pack, index) => {
        const selected = pack.strategy.id === state.strategy;
        return `
          <article
            class="plan-card${selected ? " is-selected" : ""}"
            data-strategy="${escapeHTML(pack.strategy.id)}"
            role="button"
            tabindex="0"
            aria-selected="${selected}"
            aria-label="选择${escapeHTML(pack.strategy.name)}方案"
            style="--plan-accent:${escapeHTML(pack.strategy.accent)}"
          >
            <div class="plan-top">
              <span class="plan-index">0${index + 1} / PACKAGE</span>
              <span class="plan-selected">当前方案</span>
            </div>
            <span class="plan-eyebrow">${escapeHTML(pack.strategy.eyebrow)}</span>
            <h3>${escapeHTML(pack.strategy.name)}</h3>
            <p class="plan-description">${escapeHTML(pack.strategy.description)}</p>
            <div class="plan-mix">
              <div>
                <span>建议配比 · 公交</span>
                <strong>${pack.requestedMix.bus}%</strong>
              </div>
              <div>
                <span>建议配比 · 地铁</span>
                <strong>${pack.requestedMix.metro}%</strong>
              </div>
            </div>
            <div class="plan-metrics">
              <div>
                <small>刊例估算</small>
                <strong>${escapeHTML((pack.mediaCount ? formatMoney(pack.totalMid, { compact: true }) : "待核算"))}</strong>
              </div>
              <div>
                <small>媒体数量</small>
                <strong>${pack.busCount} 辆 / ${pack.metroCount} 点</strong>
              </div>
              <div>
                <small>目标圈覆盖</small>
                <strong>${pack.coverage}%</strong>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderMap() {
    const map = $("#cityMap");
    if (!map) return;
    const pack = currentPackage();
    const profile = currentProfile();
    if (!pack) return;
    const targetMap = new Map(pack.targetZones.map((target) => [target.id, target]));
    const covered = new Set(pack.coveredZoneIds);
    if (!state.selectedMediaId || !findMediaById(state.selectedMediaId)) {
      state.selectedMediaId = pack.busItems[0]?.id || pack.metroItems[0]?.id || null;
    }

    const zonesMarkup = DATA.zones
      .map((zone) => {
        const target = targetMap.get(zone.id);
        const isTarget = Boolean(target);
        const isCovered = covered.has(zone.id);
        const radius = isTarget ? 8 + target.weight * 5 : 4;
        const labelOffset = zone.x > 800 ? -10 : 10;
        const textAnchor = zone.x > 800 ? "end" : "start";
        return `
          <g
            class="map-target-zone${isCovered ? " is-covered" : ""}${isTarget ? "" : " is-secondary"}"
            data-zone-id="${escapeHTML(zone.id)}"
          >
            ${isTarget ? `<circle class="zone-halo" cx="${zone.x}" cy="${zone.y}" r="${radius + 9}"></circle>` : ""}
            <circle class="zone-core" cx="${zone.x}" cy="${zone.y}" r="${radius}"></circle>
            <text
              class="map-zone-label"
              x="${zone.x + labelOffset}"
              y="${zone.y + 4}"
              text-anchor="${textAnchor}"
              style="${isTarget ? "" : "opacity:.52;font-size:11px"}"
            >${escapeHTML(zone.name)}</text>
            ${isTarget ? `<text class="map-zone-index" x="${zone.x + labelOffset}" y="${zone.y + 19}" text-anchor="${textAnchor}">圈层 ${Math.round(target.weight * 100)}</text>` : ""}
          </g>
        `;
      })
      .join("");

    const displayedRoutes = pack.busItems.slice(0, 14);
    const mapLocations = [
      ...pack.targetZones.map((target) => target.zone),
      ...displayedRoutes.flatMap((item) => item.zoneIds.slice(0, 2).map((id) => zoneById.get(id))),
      ...pack.metroItems.map((item) => state.metroPoints.find((point) => point.id === item.refId)),
    ].filter((location) => Number.isFinite(location?.x) && Number.isFinite(location?.y));
    if (mapLocations.length) {
      const xs = mapLocations.map((location) => location.x);
      const ys = mapLocations.map((location) => location.y);
      const x = Math.min(...xs) - 53;
      const y = Math.min(...ys) - 55;
      map.setAttribute("viewBox", [x, y, Math.max(...xs) - x + 76, Math.max(...ys) - y + 45].join(" "));
    }

    const routeMarkup = displayedRoutes
      .map((item, index) => {
        const firstZone = zoneById.get(item.zoneIds[0]) || DATA.zones[0];
        const secondZone = zoneById.get(item.zoneIds[1]) || firstZone;
        if (!item.zoneIds.length || !firstZone || !secondZone) return "";
        const midX =
          (firstZone.x + secondZone.x) / 2 + Math.sin(index * 1.7) * 46;
        const midY =
          (firstZone.y + secondZone.y) / 2 - 35 - (index % 4) * 7;
        const path = `M ${firstZone.x} ${firstZone.y} Q ${midX} ${midY} ${secondZone.x} ${secondZone.y}`;
        const selected = item.id === state.selectedMediaId;
        const dimmed = Boolean(state.selectedMediaId) && !selected;
        return `
          <g
            class="map-route-group${selected ? " is-selected" : ""}${dimmed ? " is-dimmed" : ""}"
            data-map-media-id="${escapeHTML(item.id)}"
            role="button"
            tabindex="0"
            aria-label="${escapeHTML(`${item.name}，${item.level}级，查看选择理由`)}"
          >
            <title>${escapeHTML(`${item.name} · ${item.level} · 可用 ${item.available} 辆`)}</title>
            <path class="map-route-hit" d="${path}"></path>
            <path class="map-route" d="${path}"></path>
            <circle class="map-route-node" cx="${firstZone.x}" cy="${firstZone.y}" r="3.8"></circle>
            <circle class="map-route-node" cx="${secondZone.x}" cy="${secondZone.y}" r="3.8"></circle>
            <text class="map-route-label" x="${midX}" y="${midY - 5}" text-anchor="middle">${escapeHTML(item.route)}</text>
          </g>
        `;
      })
      .join("");

    const metroMarkup = pack.metroItems
      .map((item) => {
        const point = state.metroPoints.find((candidate) => candidate.id === item.refId);
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return "";
        const selected = item.id === state.selectedMediaId;
        const dimmed = Boolean(state.selectedMediaId) && !selected;
        const labelX = point.x + (point.x > 800 ? -15 : 15);
        const anchor = point.x > 800 ? "end" : "start";
        return `
          <g
            class="map-metro-group${selected ? " is-selected" : ""}${dimmed ? " is-dimmed" : ""}"
            data-map-media-id="${escapeHTML(item.id)}"
            role="button"
            tabindex="0"
            aria-label="${escapeHTML(`${item.name}，${item.level}级，查看选择理由`)}"
          >
            <title>${escapeHTML(`${item.name} · ${item.level} · ${item.status || "可售"}`)}</title>
            <circle class="map-metro-halo" cx="${point.x}" cy="${point.y}" r="13"></circle>
            <circle class="map-metro-core" cx="${point.x}" cy="${point.y}" r="5"></circle>
            <text class="map-metro-label" x="${labelX}" y="${point.y + 4}" text-anchor="${anchor}">${escapeHTML(point.exit || point.station)}</text>
          </g>
        `;
      })
      .join("");

    map.innerHTML = `
      <title id="cityMapTitle">${escapeHTML(profile.brand)} 上海户外媒体覆盖示意图</title>
      <desc id="cityMapDesc">显示目标门店圈、当前方案选择的公交线路与地铁出入口。地图为策略示意，不是真实地理底图。</desc>
      <defs>
        <pattern id="mapGridPattern" width="34" height="34" patternUnits="userSpaceOnUse">
          <path d="M34 0H0V34" fill="none" stroke="rgba(72,94,121,.07)" stroke-width="1"></path>
        </pattern>
        <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="8" result="blur"></feGaussianBlur>
          <feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge>
        </filter>
      </defs>
      <rect width="1000" height="720" fill="url(#mapGridPattern)"></rect>
      <path class="map-district" d="M35 105C110 31 250 30 342 81C387 106 403 167 360 210C302 268 165 255 72 219C24 200 3 151 35 105Z"></path>
      <path class="map-district" d="M342 80C429 29 585 35 635 102C672 152 643 220 569 246C479 279 384 251 359 207C335 166 312 115 342 80Z"></path>
      <path class="map-district" d="M635 81C731 50 874 64 944 132C994 181 979 259 917 300C836 352 692 322 640 253C601 202 590 128 635 81Z"></path>
      <path class="map-district" d="M60 230C149 207 285 236 339 313C379 371 355 430 277 466C187 507 74 478 35 399C7 344 15 257 60 230Z"></path>
      <path class="map-district" d="M344 248C430 216 549 238 606 302C652 353 646 427 577 477C489 541 379 515 337 451C291 383 290 290 344 248Z"></path>
      <path class="map-district" d="M640 305C733 273 852 300 907 370C960 438 920 526 828 566C726 611 637 576 603 495C571 418 579 333 640 305Z"></path>
      <path class="map-district" d="M280 475C370 439 495 473 537 548C576 618 530 692 430 708C325 725 225 685 211 605C200 545 230 493 280 475Z"></path>
      <path class="map-district" d="M604 493C696 466 815 500 856 570C894 636 848 700 755 716C655 733 580 693 571 620C563 564 565 514 604 493Z"></path>
      <path class="map-river" d="M665 -30C635 79 675 160 635 242C596 322 630 405 591 494C555 577 583 650 542 750"></path>
      <path class="map-river-highlight" d="M665 -30C635 79 675 160 635 242C596 322 630 405 591 494C555 577 583 650 542 750"></path>
      <path class="map-road" d="M30 604C178 551 295 515 436 500C591 484 718 445 966 304"></path>
      <path class="map-road" d="M125 40C203 160 278 243 445 331C591 408 726 444 866 458"></path>
      <path class="map-road" d="M84 352C250 343 393 375 531 428C688 490 805 536 954 642"></path>
      <path class="map-road" d="M268 722C318 631 407 555 525 501C681 430 784 334 835 211"></path>
      <g>${zonesMarkup}</g>
      <g>${routeMarkup}</g>
      <g>${metroMarkup}</g>
    `;

    setText(
      "mapTitle",
      `${profile.brand} · ${pack.strategy.name}沙盘`,
    );
    setText("mapCoverageChip", `${pack.coveredZoneIds.length} / ${pack.targetZones.length} 目标圈`);
    setText("coverageSummaryValue", `${pack.coverage}%`);
    const bar = $("#coverageSummaryBar");
    if (bar) bar.style.width = `${pack.coverage}%`;
    setText(
      "mapDataStamp",
      "线网示意 · 非精确地理位置" + (pack.busItems.length > 14 ? " · 仅绘前 14 条公交" : ""),
    );

    const chips = $("#zoneChips");
    if (chips) {
      chips.innerHTML = pack.targetZones
        .map(
          (target) => `
            <span class="zone-chip${covered.has(target.id) ? " is-covered" : ""}">
              ${escapeHTML(target.label)}
            </span>
          `,
        )
        .join("");
    }
    renderSelectedMedia();
  }

  function rawMedia(row, kind) {
    const bus = kind === "bus";
    const evidence = evidenceFor(row);
    return {
      ...row,
      id: kind + ":" + row.id,
      kind,
      name: bus ? row.route + " 路" : row.name,
      zoneIds: coverageZones(kind, row),
      ...unitEconomics(kind, row.level, row.actualArea),
      ...evidence,
      reason: evidence.availabilityState === "blocked" ? "空位为零或记录为已占用。"
        : "查询档期未匹配，核实红豆实际档期后重导。",
    };
  }

  function findMediaById(mediaId) {
    const pack = currentPackage();
    if (!pack) return null;
    const selected = [...pack.busItems, ...pack.metroItems].find(
      (item) => item.id === mediaId,
    );
    if (selected) return { ...selected, selected: true, item: selected };
    const candidate = [...pack.busCandidates, ...pack.metroCandidates].find(
      (item) => item.id === mediaId,
    );
    if (candidate) return { ...candidate, selected: false };
    const bus = mediaId.startsWith("bus:");
    const raw = (bus ? state.busRoutes : state.metroPoints).find((row) => (bus ? "bus:" : "metro:") + row.id === mediaId);
    if (raw) return rawMedia(raw, bus ? "bus" : "metro");
    return null;
  }

  function renderSelectedMedia() {
    const detail = $("#selectedMediaDetail");
    const empty = $("#selectedMediaEmpty");
    const status = $("#selectedMediaStatus");
    if (!detail || !empty || !status) return;
    const media = state.selectedMediaId ? findMediaById(state.selectedMediaId) : null;
    if (!media) {
      detail.hidden = true;
      empty.hidden = false;
      setText("selectedMediaName", "点击地图查看媒介");
      status.className = "status-chip status-chip-blue";
      status.textContent = "待核对";
      return;
    }
    empty.hidden = true;
    detail.hidden = false;
    setText("selectedMediaName", media.name);
    status.className = "status-chip";
    status.textContent = inventoryLabels[media.availabilityState] || "待核对";
    const zones = routeZoneNames(media) || "未匹配商圈";
    const sourceLabel =
      media.sourceState === "imported"
        ? "红豆导入"
        : media.sourceState === "snapshot"
          ? "公交台账快照"
          : "演示数据";
    const lineLabel = media.kind === "metro" && media.lines?.length
      ? `线路 ${media.lines.join(" / ")}`
      : media.operator || media.mediaType || "媒体资源";
    detail.innerHTML = `
      <div class="media-detail-title">${escapeHTML(media.kind === "bus" ? `${media.name} 公交车身` : media.name)}</div>
      <div class="media-detail-meta">
        <span>${escapeHTML(media.kind === "bus" ? "公交车身" : "地铁出入口")}</span>
        <span>${escapeHTML(media.level)} 级</span>
        <span>${escapeHTML(lineLabel)}</span>
        <span>${escapeHTML(sourceLabel)}</span>
      </div>
      <div class="media-reason">${escapeHTML(media.reason || "该媒体由当前策略候选池生成。")}</div>
      <div class="media-facts">
        <div>
          <span>当前选择</span>
          <strong>${media.selected ? `${media.units || 1} ${media.kind === "bus" ? "辆" : "个"}` : "未入方案"}</strong>
        </div>
        <div>
          <span>可售 / 合同 / 预定</span>
          <strong>${media.available || 0} / ${media.contracted || 0} / ${media.reserved || 0}</strong>
        </div>
        <div>
          <span>已计费用中位</span>
          <strong>${escapeHTML(formatMoney(media.mid, { compact: true }))}</strong>
        </div>
        <div>
          <span>数据时点</span>
          <strong>${escapeHTML(media.asOf || "--")}</strong>
        </div>
      </div>
      <div class="media-evidence">
        <svg class="icon" aria-hidden="true"><use href="#icon-info"></use></svg>
        <span>覆盖区域 ${escapeHTML(zones || "待匹配")}<br>查询档期 ${escapeHTML(queryLabel(media))}<br>方案档期 ${escapeHTML(planWindow().start)} 至 ${escapeHTML(planWindow().end)}<br>发布刊例 ${escapeHTML(formatPriceRange(media, media.kind))}${media.kind === "metro" ? "<br>制作费 " + escapeHTML(productionLabel(media)) : ""}</span>
      </div>
    `;
    updateMapSelectionStyles();
  }

  function updateMapSelectionStyles() {
    $$("[data-map-media-id]").forEach((element) => {
      const selected = element.dataset.mapMediaId === state.selectedMediaId;
      element.classList.toggle("is-selected", selected);
      element.classList.toggle("is-dimmed", Boolean(state.selectedMediaId) && !selected);
    });
  }

  function selectMedia(mediaId, scrollToMap = false) {
    state.selectedMediaId = mediaId;
    $("#evidenceDetail").open = true;
    renderSelectedMedia();
    if (scrollToMap) {
      $("#geo")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function renderInventory() {
    const pack = currentPackage();
    const head = $("#inventoryTableHead");
    const body = $("#inventoryTableBody");
    const meta = $("#tableMeta");
    const footnote = $("#inventoryFootnote");
    if (!pack || !head || !body) return;

    $$(".table-tab").forEach((button) => {
      const active = button.dataset.tableView === state.tableView;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    setText("selectedBusVehicles", pack.busCount);
    setText("selectedMetroPoints", pack.metroCount);
    setText("inventoryAsOf", state.inventoryAsOf || "--");
    const confidence = getDataConfidence();
    setText("inventoryConfidence", confidence.inventory);
    setText(
      "inventoryStateLabel",
      hasImportedData() ? "导入快照 · 非实时" : "静态快照 · 非实时",
    );

    const tableHead = `
      <tr>
        <th>媒体</th>
        <th>等级</th>
        <th>位置 / 运营</th>
        <th>选择</th>
        <th>可售</th>
        <th>数据时点</th>
        <th>刊例 / 制作</th>
        <th>策略理由</th>
        <th></th>
      </tr>
    `;
    head.innerHTML = tableHead;

    if (state.tableView === "selected") {
      const busRows = pack.busItems.map((item) => inventoryRow(item, true));
      const metroRows = pack.metroItems.map((item) => inventoryRow(item, true));
      const rows = [...busRows, ...metroRows];
      body.innerHTML = rows.length
        ? rows.join("")
        : '<tr><td class="table-empty" colspan="9">当前媒体类型下没有可售资源，请调整预算、档期或媒体组合。</td></tr>';
      setText("tableMeta", `${rows.length} 条媒介 · ${pack.busCount} 辆公交 + ${pack.metroCount} 个地铁点`);
      footnote.textContent =
        "发布费按脱敏刊例区间和刊期折算。已取得的制作费计入合计，待核费用单独列示。";
    } else {
      const selectedBusIds = new Set(pack.busItems.map((item) => item.id));
      const selectedMetroIds = new Set(pack.metroItems.map((item) => item.id));
      const busAlternatives = pack.busCandidates
        .filter((item) => !selectedBusIds.has(item.id))
        .slice(0, 8);
      const metroAlternatives = pack.metroCandidates
        .filter((item) => !selectedMetroIds.has(item.id))
        .slice(0, 6);
      const exceptions = [
        ...(state.media.has("bus") ? state.busRoutes.map((row) => rawMedia(row, "bus")) : []),
        ...(state.media.has("metro") ? state.metroPoints.map((row) => rawMedia(row, "metro")) : []),
      ].filter((item) => ["stale", "blocked"].includes(item.availabilityState));
      exceptions.sort((a, b) => Number(b.availabilityState === "blocked") - Number(a.availabilityState === "blocked"));
      const rows = [...busAlternatives, ...metroAlternatives, ...exceptions].map((item) => inventoryRow(item, false));
      body.innerHTML = rows.length
        ? rows.join("")
        : '<tr><td class="table-empty" colspan="9">当前媒体池没有其他备选资源。</td></tr>';
      setText("tableMeta", `${rows.length} 条备选 / 冲突资源`);
      footnote.textContent =
        "备选并不代表可售保留；冲突点位必须回到红豆查看占用明细。演示池点位仅用于交互验证。";
    }
  }

  function inventoryRow(item, selected) {
    const statusLabel = inventoryLabels[item.availabilityState] || "待核对";
    const statusClass = item.availabilityState === "matched" ? "" : " is-warning";
    const location =
      item.kind === "bus"
        ? `${item.operator || "运营单位待核"} · ${routeZoneNames(item) || "区域待匹配"}`
        : `${item.station || item.name} · ${(item.lines || []).join("/") || "线路待核"}`;
    const selectedText =
      item.kind === "bus"
        ? `${selected ? item.units : 0} / ${item.available} 辆`
        : `${selected ? item.units || 1 : 0} / ${item.available || 0} 个`;
    const position =
      item.kind === "bus"
        ? item.mediaType || "公交车身"
        : `${item.exit || "出入口"} · ${zoneById.get(item.zoneIds?.[0])?.name || "区域待核"}`;
    return `
      <tr>
        <td>
          <span class="table-primary">${escapeHTML(item.name)}</span>
          <span class="table-secondary">${escapeHTML(item.kind === "bus" ? "公交车身" : "地铁出入口")}</span>
        </td>
        <td><span class="level-badge${item.level === "S" ? " level-s" : ""}">${escapeHTML(item.level)}</span></td>
        <td>
          <span class="table-primary">${escapeHTML(location)}</span>
          <span class="table-secondary">${escapeHTML(position)}</span>
        </td>
        <td class="table-number">${escapeHTML(selectedText)}</td>
        <td>
          <span class="table-status${statusClass}">${escapeHTML(statusLabel)}</span>
          <span class="table-secondary">合同 ${item.contracted || 0} · 预定 ${item.reserved || 0}</span>
        </td>
        <td>
          <span class="table-primary table-number">${escapeHTML(item.asOf || "--")}</span>
          <span class="table-secondary">${escapeHTML(queryLabel(item))}</span>
        </td>
        <td>
          <span class="table-primary table-number">${escapeHTML(formatPriceRange(item, item.kind))}</span>
          <span class="table-secondary">制作 ${escapeHTML(productionLabel(item))}</span>
        </td>
        <td><span class="table-reason">${escapeHTML(item.reason || "由当前策略候选池生成。")}</span></td>
        <td>
          <button class="row-action" type="button" data-select-media="${escapeHTML(item.id)}">
            查看理由
          </button>
        </td>
      </tr>
    `;
  }

  function buildScheduleNodes() {
    const start = state.startDate;
    const end = addDays(start, state.duration - 1);
    const hasBus = state.media.has("bus");
    const hasMetro = state.media.has("metro");
    const nodes = [
      {
        name: "库存锁定 / 素材 Brief",
        start: addDays(start, -21),
        end: addDays(start, -18),
        phase: "prepare",
        owner: "销售 + 提案",
        deliverable: "锁定媒体清单、档期与制作规格；确认报价边界。",
        status: "锁定前",
        critical: true,
      },
      {
        name: "素材定稿",
        start: addDays(start, -15),
        end: addDays(start, -12),
        phase: "prepare",
        owner: "客户 + 创意",
        deliverable: "主视觉、尺寸、文案与品牌元素完成确认。",
        status: "待执行",
      },
      {
        name: "内容 / 法务审批",
        start: addDays(start, -11),
        end: addDays(start, -8),
        phase: "prepare",
        owner: "客户 + 新云",
        deliverable: "行业合规、品牌规范和上刊许可通过。",
        status: "卡点",
        critical: true,
      },
      {
        name: hasBus ? "公交物料制作" : "上刊物料制作",
        start: addDays(start, -7),
        end: addDays(start, -3),
        phase: "production",
        owner: "制作供应商",
        deliverable: "按媒体规格输出成品并完成抽检。",
        status: "待执行",
      },
      {
        name: hasMetro ? "地铁施工窗口确认" : "公交排班确认",
        start: addDays(start, -6),
        end: addDays(start, -2),
        phase: "production",
        owner: "媒体运营",
        deliverable: hasMetro
          ? "确认夜间施工、维保与商场物业窗口。"
          : "确认车辆排班、回场时间与施工班组。",
        status: "卡点",
        critical: true,
      },
      {
        name: "首轮上刊",
        start,
        end: addDays(start, 2),
        phase: "launch",
        owner: "媒体运营",
        deliverable: "按批次完成施工，异常点位即时回报。",
        status: "上刊",
        critical: true,
      },
      {
        name: "分批上刊 / 补位",
        start: addDays(start, 2),
        end: addDays(start, 5),
        phase: "launch",
        owner: "媒体运营",
        deliverable: "完成剩余批次、替换与补位。",
        status: "上刊",
      },
      {
        name: "上刊照片",
        start: addDays(start, 1),
        end: addDays(start, 2),
        phase: "monitor",
        owner: "运营 + 销售",
        deliverable: "上刊当日或次日回传可核验照片。",
        status: "交付",
      },
      {
        name: "上刊监测报告",
        start: addDays(start, 5),
        end: addDays(start, 7),
        phase: "monitor",
        owner: "运营",
        deliverable: "上刊后 5 个工作日内提交监测报告。",
        status: "交付",
      },
    ];
    if (state.duration > 30) {
      nodes.push({
        name: "月度监测 · 第 1 月",
        start: addDays(start, 30),
        end: addDays(start, 32),
        phase: "monitor",
        owner: "运营",
        deliverable: "在刊状态、异常与画面完整性月度回传。",
        status: "月度",
      });
    }
    if (state.duration > 60) {
      nodes.push({
        name: "月度监测 · 第 2 月",
        start: addDays(start, 60),
        end: addDays(start, 62),
        phase: "monitor",
        owner: "运营",
        deliverable: "第二月度在刊与画面完整性回传。",
        status: "月度",
      });
    }
    nodes.push(
      {
        name: "下刊执行",
        start: end,
        end: addDays(end, 1),
        phase: "live",
        owner: "媒体运营",
        deliverable: "按合同档期完成下刊或续刊确认。",
        status: "在刊末",
      },
      {
        name: "下刊照片",
        start: addDays(end, 2),
        end: addDays(end, 4),
        phase: "monitor",
        owner: "运营",
        deliverable: "下刊后 5 个工作日内提交照片。",
        status: "交付",
      },
      {
        name: "结案报告",
        start: addDays(end, 6),
        end: addDays(end, 8),
        phase: "monitor",
        owner: "提案 + 运营",
        deliverable: "投放清单、监测照片、异常与优化建议归档。",
        status: "结案",
      },
    );
    return nodes;
  }

  function schedulePhases() {
    const { start, end } = planWindow();
    return [
      ["库存复核与锁定", addDays(start, -14), addDays(start, -8)],
      ["画面制作与施工确认", addDays(start, -7), addDays(start, -1)],
      ["媒体发布", start, end],
      ["下刊记录与监测汇总", addDays(end, 1), addDays(end, 7)],
    ];
  }

  function renderSchedule() {
    setHTML("schedulePhases", schedulePhases().map(([label, start, end]) =>
      `<li><strong>${label}</strong><span>${formatDateRange(start, end)}</span></li>`).join(""));
    const pack = currentPackage();
    if (!pack) return;
    const nodes = buildScheduleNodes();
    const start = state.startDate;
    const end = addDays(start, state.duration - 1);
    const rangeStart = addDays(start, -23);
    const rangeEnd = addDays(end, 10);
    const totalDays = Math.max(1, differenceInDays(rangeStart, rangeEnd));
    const gantt = $("#gantt");
    const table = $("#scheduleTableBody");
    if (!gantt || !table) return;

    setText("timelineHeading", `${formatDate(start)} 上刊 · ${state.duration} 天`);
    setText("timelineChip", `${nodes.length} 个关键节点`);
    setText("recommendedStart", `不晚于 ${formatDate(addDays(start, -21))}`);
    gantt.innerHTML = nodes
      .map((node) => {
        const left = clamp(
          (differenceInDays(rangeStart, node.start) / totalDays) * 100,
          0,
          98,
        );
        const width = clamp(
          ((differenceInDays(node.start, node.end) + 1) / totalDays) * 100,
          1.8,
          100 - left,
        );
        return `
          <div class="gantt-row">
            <span class="gantt-label" title="${escapeHTML(node.name)}">${escapeHTML(node.name)}</span>
            <div class="gantt-track">
              <span
                class="gantt-bar phase-${escapeHTML(node.phase)}"
                style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"
                title="${escapeHTML(`${formatDateRange(node.start, node.end)} · ${node.deliverable}`)}"
              ></span>
              <span class="gantt-date-label">${escapeHTML(formatDateShort(node.start))}</span>
            </div>
          </div>
        `;
      })
      .join("");

    table.innerHTML = nodes
      .map(
        (node) => `
          <tr>
            <td><span class="table-primary">${escapeHTML(node.name)}</span></td>
            <td><span class="table-primary table-number">${escapeHTML(formatDateRange(node.start, node.end))}</span></td>
            <td>${escapeHTML(node.owner)}</td>
            <td><span class="table-reason">${escapeHTML(node.deliverable)}</span></td>
            <td><span class="status-tag${node.critical ? " is-critical" : ""}">${escapeHTML(node.status)}</span></td>
          </tr>
        `,
      )
      .join("");

    renderBudget(pack);
  }

  function renderBudget(pack) {
    const total = Math.max(1, pack.totalMid);
    const busPercent = (pack.busSpend / total) * 100;
    const metroPercent = (pack.metroSpend / total) * 100;
    const donut = $("#budgetDonut");
    if (donut) {
      donut.style.setProperty("--bus", `${busPercent.toFixed(2)}%`);
      donut.style.setProperty("--metro", `${metroPercent.toFixed(2)}%`);
    }
    setText("budgetDonutValue", pack.mediaCount ? formatMoney(pack.totalMid, { compact: true }) : "待核算");
    setText("budgetRangeMin", pack.mediaCount ? formatMoney(pack.totalMin, { compact: true }) : "—");
    setText("budgetRangeMax", pack.mediaCount ? formatMoney(pack.totalMax, { compact: true }) : "—");

    const breakdown = $("#budgetBreakdown");
    if (breakdown) {
      const lines = [];
      if (pack.busSpend > 0) {
        lines.push(`
          <div class="budget-line bus">
            <span>公交媒介费 · ${pack.busCount} 辆</span>
            <strong>${escapeHTML(formatMoney(pack.busSpend, { compact: true }))}</strong>
          </div>
        `);
      }
      if (pack.metroSpend > 0) {
        lines.push(`
          <div class="budget-line metro">
            <span>地铁媒介费 · ${pack.metroCount} 点</span>
            <strong>${escapeHTML(formatMoney(pack.metroSpend, { compact: true }))}</strong>
          </div>
        `);
      }
      lines.push(`
        <div class="budget-line production">
          <span>已核算制作费</span>
          <strong>${escapeHTML(formatMoney(pack.productionSpend, { compact: true }))}</strong>
        </div>
      `);
      breakdown.innerHTML = lines.join("");
    }

    const range = Math.max(1, pack.totalMax - pack.totalMin);
    const marker = clamp(((pack.totalMid - pack.totalMin) / range) * 100, 0, 100);
    const markerElement = $("#budgetRangeMarker");
    if (markerElement) markerElement.style.left = `${marker}%`;

    const status = $("#budgetStatusChip");
    if (status) {
      status.className = "status-chip status-chip-blue";
      status.textContent = !pack.mediaCount ? "待库存核对"
        : pack.pendingProductionCount ? "费用未齐 · 制作费待核"
        : "预算内 · 余量 " + formatMoney(pack.savings, { compact: true });
    }
    flashValue($("#budgetDonutValue"));
  }

  function yuan(value) {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value) + " 元";
  }

  function productionLabel(item) {
    if (item.productionPending) return "待核（未计入合计）";
    return item.kind === "metro" ? item.actualArea + "㎡ × " + metroRate() + " = " + yuan(item.production) : yuan(item.production);
  }

  function quoteRange(pack) {
    return pack.mediaCount ? formatMoney(pack.totalMin) + "–" + formatMoney(pack.totalMax) : "待核算";
  }

  function quoteNote(pack) {
    if (!pack.mediaCount) return "缺少符合方案档期及预算的资源，暂不形成报价。";
    if (pack.pendingProductionCount) return "已核算区间 · " + pack.pendingProductionCount + " 处地铁制作费待核，未计入合计。";
    return "发布费与制作费的区间估算。折扣、税费和特殊点位费用待复核。";
  }

  function quoteDiff(previous, next) {
    const before = new Map([...previous.busItems, ...previous.metroItems].map((item) => [item.id, item]));
    const after = new Map([...next.busItems, ...next.metroItems].map((item) => [item.id, item]));
    const kept = [], removed = [], added = [];
    for (const item of before.values()) {
      const afterUnits = after.get(item.id)?.units || 0;
      if (afterUnits) kept.push({ item, units: Math.min(afterUnits, item.units) });
      if (afterUnits >= item.units) continue;
      const lost = previous.targetZones.filter((zone) => item.zoneIds.includes(zone.id) && !next.coveredZoneIds.includes(zone.id));
      const weight = lost.reduce((sum, zone) => sum + zone.weight, 0);
      removed.push({ item, units: item.units - afterUnits, lost, marginal: weight / Math.max(1, item.max) });
    }
    for (const item of after.values()) {
      const beforeUnits = before.get(item.id)?.units || 0;
      if (beforeUnits < item.units) added.push({ item, units: item.units - beforeUnits });
    }
    removed.sort((a, b) => a.marginal - b.marginal || b.item.max - a.item.max);
    const lost = previous.targetZones.filter((zone) => previous.coveredZoneIds.includes(zone.id) && !next.coveredZoneIds.includes(zone.id));
    const gained = next.targetZones.filter((zone) => next.coveredZoneIds.includes(zone.id) && !previous.coveredZoneIds.includes(zone.id));
    const priority = next.targetZones.filter((zone) => zone.weight >= 0.95);
    const hit = (pack) => priority.filter((zone) => pack.coveredZoneIds.includes(zone.id)).length;
    const labels = (zones) => zones.map((zone) => zone.label).join("、") || "无";
    const groups = [["保留", kept], ["撤下", removed], ["新增", added]].map(([label, entries]) => {
      if (!entries.length) return "<p>" + label + " 0 项</p>";
      const entriesMarkup = entries.map(({ item, units, lost }) => {
        const reason = !lost ? "" : lost.length
          ? "。" + labels(lost) + "失去覆盖，单件上限 " + yuan(item.max)
          : (item.zoneIds.length ? "。该资源未造成目标圈覆盖损失，" : "。该资源暂无覆盖证据，") + "单件上限 " + yuan(item.max);
        return "<li>" + escapeHTML(item.name + " ×" + units + reason) + "</li>";
      }).join("");
      return "<details><summary>" + label + " " + entries.length + " 项</summary><ul>" + entriesMarkup + "</ul></details>";
    }).join("");
    return `<p>加权覆盖 ${previous.coverage}% → ${next.coverage}% · 重点目标圈 ${hit(previous)}/${priority.length} → ${hit(next)}/${priority.length}</p>
      <p>失去覆盖（${lost.length}） ${escapeHTML(labels(lost))}<br>新增覆盖（${gained.length}） ${escapeHTML(labels(gained))}</p>
      <p>已核算费用上限 ${escapeHTML(formatMoney(previous.totalMax))} → ${escapeHTML(formatMoney(next.totalMax))}</p>${groups}`;
  }

  function renderDesk() {
    const pack = currentPackage();
    if (!pack) return;
    const { start, end } = planWindow();
    const warnings = [];
    if (!pricing()) warnings.push("请在计价配置中录入确认过的刊例，保存后生成报价。");
    else if (!pack.mediaCount) warnings.push("暂无匹配档期且可纳入的资源。请检查可售空位、媒体等级及方案档期。");
    else if (isDemoWindow()) warnings.push("演示估算，2027 可售待核。");
    if (pack.mixUnmet) warnings.push("媒体组合未满足，当前档期和预算下未同时排入公交与地铁。");
    if (pack.mediaCount && pack.budgetUsage < 85) warnings.push("预算未用尽，组合须预留 5% 并按区间上限控制，再按策略择优纳入整辆或整点资源。");
    setText("reviewSummary", pack.strategy.name + " · " + pack.busCount + " 辆公交 / " + pack.metroCount + " 个地铁口");
    const before = pack.targetZones.length;
    if (state.coverageMatches && pack.mediaCount && !pack.coveredZoneIds.length && before) {
      warnings.push("所选资源暂无与当前目标圈匹配的覆盖记录。");
    }
    setText("reviewWarning", warnings.join(" "));
    setText("targetCount", pack.coveredZoneIds.length + " / " + pack.targetZones.length + " 个目标圈 · " + (state.coverageMatches ? "已导入覆盖" : "策略估算"));
    setText("deskRange", quoteRange(pack));
    setText("deskRangeNote", quoteNote(pack));
    setText("deskCap", formatMoney(budgetCap()));
    setText("deskRoom", pack.mediaCount ? formatMoney(pack.savings) : "—");
    setText("deskUsage", pack.mediaCount ? pack.budgetUsage + "%（中位）" : "—");
    $("#deskMediaBar").style.width = (pack.busSpend + pack.metroSpend) * 100 / state.budget + "%";
    $("#deskBuildBar").style.width = pack.productionSpend * 100 / state.budget + "%";

    const previous = state.diffBase;
    if (previous?.pack) {
      const label = previous.budget > state.budget ? "预算降档" : "预算升档";
      setText("diffLabel", label + " · " + previous.budget / 10000 + " → " + state.budget / 10000 + " 万元");
      setHTML("diffBody", quoteDiff(previous.pack, pack));
    } else {
      setText("diffLabel", "切换预算可查看增减");
      setText("diffBody", "");
    }
    const pending = pack.metroItems.filter((item) => item.productionPending);
    const stale = [...(state.media.has("bus") ? state.busRoutes : []), ...(state.media.has("metro") ? state.metroPoints : [])]
      .filter((row) => inventoryState(row) === "stale").length;
    const dateNote = isDemoWindow() ? "演示档期待核" : stale + " 条档期待重查";
    setText("checkLabel", dateNote + " · " + pending.length + " 处面积待核");
    const pendingList = pending.map((item) => `<li>${escapeHTML(item.name)} · 制作费待核
      <button type="button" class="resource-action" data-area-id="${escapeHTML(item.refId)}">补录面积</button></li>`).join("");
    setHTML("checkBody", `<p>方案 ${start} 至 ${end} · ${state.duration} 天</p>
      <p>按方案起止日期在红豆重查。旧档期和零空位资源不进入重算后的组合。</p>
      ${pending.length ? "<ul>" + pendingList + "</ul>" : "<p>当前组合没有待补录的面积。</p>"}`);
  }

  function openAreaEditor(id) {
    const point = state.metroPoints.find((item) => item.id === id);
    if (!point) return;
    state.editingArea = point;
    setText("areaResource", point.name);
    setValue("#areaInput", point.actualArea ?? "");
    setText("areaEstimate", "制作费按每平方米 " + metroRate() + " 元估算。");
    $("#areaDialog").showModal();
    $("#areaInput").focus();
  }

  function renderRisks() {
    const container = $("#riskList");
    if (!container) return;
    const risks = [];
    if (!hasImportedData()) {
      risks.push({
        level: "high",
        title: "2027 可售档期尚未实时核验",
        body: "公开版的公交、地铁、空位和价格均为合成样例。正式提案请导入获授权的红豆数据并逐条复核。",
      });
    } else if (state.importedKinds.size < 2) {
      risks.push({
        level: "high",
        title: "只导入了部分媒体库存",
        body: "另一类媒体等待匹配档期的导入快照，当前方案只纳入日期匹配且有空位的已导入资源。",
      });
    } else {
      risks.push({
        level: "medium",
        title: "导入库存仍需销售抽检",
        body: `已载入 ${state.lastImportName || "库存文件"}，但字段映射与占用明细仍需与红豆页面抽样核对。`,
      });
    }
    risks.push({
      level: "medium",
      title: "报价尚未进入折扣与税费流程",
      body: "当前使用区间化刊例中位值与制作费，不含最终折扣、税费、特殊点位溢价和临时制作。",
    });
    if (state.media.has("metro")) {
      risks.push({
        level: "medium",
        title: "地铁施工受物业与维保窗口约束",
        body: "夜间施工、商场审批和线路维保可能改变实际上刊批次，不能承诺所有点位同一天完成。",
      });
    }
    risks.push({
      level: "low",
      title: "覆盖指数是策略权重，不是实到人次",
      body: "目标圈覆盖由门店权重与媒体所在商圈估算，正式提案应接入可视化平台覆盖分析与 2023 人流基准。",
    });
    risks.push({
      level: "low",
      title: "天气与城市事件可能影响公交上刊",
      body: "强降雨、临时交通管制会影响车辆回场和施工；需预留补位窗口并记录异常。",
    });
    container.innerHTML = risks
      .map(
        (risk, index) => `
          <div class="risk-item${risk.level === "high" ? " is-high" : ""}">
            <span>0${index + 1}</span>
            <div>
              <h4>${escapeHTML(risk.title)}</h4>
              <p>${escapeHTML(risk.body)}</p>
            </div>
          </div>
        `,
      )
      .join("");
  }

  function hasImportedData() {
    return state.importedKinds.size > 0;
  }

  function getDataConfidence() {
    if (!isDemoWindow() && !currentPackage()?.mediaCount) {
      return { level: "stale", hero: "目标档期待核", inventory: "待重查", sidebar: "待重查", pill: "档期待重查" };
    }
    if (state.importedKinds.size >= 2) {
      return {
        level: "imported",
        hero: "已导入 · 待抽检",
        inventory: "已导入 · 待抽检",
        sidebar: "导入快照 · 待抽检",
        pill: "已导入 · 待抽检",
      };
    }
    if (state.importedKinds.size === 1) {
      return {
        level: "partial",
        hero: "部分导入 · 待抽检",
        inventory: "部分导入",
        sidebar: "部分导入 · 待抽检",
        pill: "部分导入 · 待抽检",
      };
    }
    return {
      level: "demo",
      hero: "演示数据 · 待核验",
      inventory: "演示级",
      sidebar: "载入脱敏样本",
      pill: "演示库存",
    };
  }

  function renderDataState() {
    const confidence = getDataConfidence();
    setText("sidebarDataState", confidence.sidebar);
    const pill = $("#dataPill");
    if (pill) {
      const dot = pill.querySelector(".status-dot");
      const label = pill.querySelector("span:last-child");
      if (dot) {
        dot.classList.toggle("is-warning", confidence.level !== "imported");
        dot.classList.toggle("is-ok", confidence.level === "imported");
      }
      if (label) label.textContent = confidence.pill;
    }
    renderSources();
  }

  function renderSources() {
    const container = $("#sourceGrid");
    if (!container) return;
    container.innerHTML = state.sources
      .map((source) => {
        const sourceClass =
          source.state === "imported"
            ? "is-imported"
            : source.state === "demo"
              ? "is-demo"
              : "is-reference";
        return `
          <div class="source-card ${sourceClass}">
            <div>
              <strong>${escapeHTML(source.name)}</strong>
              <p>${escapeHTML(source.detail || source.kind || "")}</p>
            </div>
            <small>${escapeHTML(source.asOf || "")}</small>
          </div>
        `;
      })
      .join("");
  }

  function renderAll(options = {}) {
    const { announce = false, reason = "" } = options;
    const profile = currentProfile();
    state.packages = DATA.strategies.map((strategy) => buildPackage(strategy, profile));
    if (!state.packages.some((pack) => pack.strategy.id === state.strategy)) {
      state.strategy = state.packages[0]?.strategy.id || "coverage";
    }
    if (!state.selectedMediaId || !findMediaById(state.selectedMediaId)) {
      const pack = currentPackage();
      state.selectedMediaId = pack?.busItems[0]?.id || pack?.metroItems[0]?.id || null;
    }
    renderControls();
    renderHero();
    renderPlanCards();
    renderMap();
    renderInventory();
    renderSchedule();
    renderRisks();
    renderDataState();
    renderDesk();
    updateWorkflowActive();
    if (announce) {
      const live = $("#recalcStatus");
      if (live) {
        live.textContent = reason || "三套方案已刷新";
        const wrapper = live.closest(".brief-live");
        wrapper?.classList.add("is-calculating");
        clearTimeout(state.polishTimer);
        state.polishTimer = setTimeout(() => {
          if (live) live.textContent = "实时联动";
          wrapper?.classList.remove("is-calculating");
        }, 900);
      }
    }
  }

  function setIndustry(industry) {
    if (!DATA.brands[industry]) return;
    state.diffBase = null;
    const resetDates = industry === "tea" || state.industry === "tea";
    if (state.industry !== industry) {
      state.coverageMatches = null;
      state.coverageEvidence = "";
      state.sources = state.sources.filter((source) => source.id !== "coverage-import");
    }
    state.industry = industry;
    if (resetDates) {
      const demo = defaultDemoWindow();
      state.startDate = demo.start;
      state.duration = demo.duration;
    }
    state.brand = DATA.brands[industry].brand;
    state.selectedMediaId = null;
    renderAll({ announce: true, reason: "行业 Brief 已切换" });
    showToast(`已切换为${DATA.brands[industry].industry}，客户预设为 ${DATA.brands[industry].brand}`);
  }

  function setBudget(budget) {
    const nextBudget = Number(budget);
    if (nextBudget === state.budget) return;
    state.diffBase = { budget: state.budget, pack: currentPackage() };
    state.budget = nextBudget;
    $("#diffDetail").open = true;
    renderAll({ announce: true, reason: `${state.budget / 10000} 万预算已重算` });
  }

  function toggleMedia(kind) {
    state.diffBase = null;
    if (state.media.has(kind)) {
      if (state.media.size === 1) {
        showToast("至少保留一种投放媒体，才能生成可执行方案。");
        return;
      }
      state.media.delete(kind);
    } else {
      state.media.add(kind);
    }
    state.selectedMediaId = null;
    renderAll({ announce: true, reason: "媒体组合已重算" });
  }

  function setStrategy(strategyId) {
    if (!state.packages.some((pack) => pack.strategy.id === strategyId)) return;
    state.diffBase = null;
    state.strategy = strategyId;
    state.selectedMediaId = null;
    renderAll({ announce: true, reason: "已切换投放打法" });
    const pack = currentPackage();
    showToast(`已切换为「${pack.strategy.name}」：${pack.coverage}% 目标圈覆盖`);
  }

  function updateWorkflowActive() {
    const sections = ["brief", "overview", "strategy", "geo", "inventory", "schedule", "delivery"];
    const scrollPosition = window.scrollY + window.innerHeight * 0.34;
    let active = "brief";
    sections.forEach((id) => {
      const section = document.getElementById(id);
      if (section && section.offsetTop <= scrollPosition) active = id;
    });
    $$(".workflow-link").forEach((button) => {
      const isActive = button.dataset.target === active;
      button.classList.toggle("is-active", isActive);
      if (isActive) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
  }

  function scrollToSection(id) {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
  }

  function getPresentationSections() {
    return ["overview", "strategy", "geo", "inventory", "schedule", "delivery"];
  }

  function setPresentationSection(id) {
    if (!getPresentationSections().includes(id)) return;
    [...getPresentationSections(), "brief"].forEach((sectionId) => {
      const section = document.getElementById(sectionId);
      if (section) section.classList.toggle("is-presentation-active", sectionId === id);
    });
    $$("#presentationNav [data-target]").forEach((button) => {
      const active = button.dataset.target === id;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const workspace = $(".workspace");
    if (workspace) workspace.scrollTop = 0;
  }

  function enterPresentation(target = "overview") {
    document.body.classList.add("presenting");
    document.querySelector('[data-action="present"]')?.setAttribute("aria-pressed", "true");
    setPresentationSection(target);
  }

  function exitPresentation() {
    document.body.classList.remove("presenting");
    document.querySelector('[data-action="present"]')?.setAttribute("aria-pressed", "false");
    document.getElementById(state.strategy === "coverage" ? "overview" : "overview")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function movePresentation(direction) {
    const sections = getPresentationSections();
    const active =
      sections.find((id) =>
        document.getElementById(id)?.classList.contains("is-presentation-active"),
      ) || "overview";
    const index = sections.indexOf(active);
    const next = sections[clamp(index + direction, 0, sections.length - 1)];
    setPresentationSection(next);
  }

  function openImportDialog() {
    const dialog = $("#importDialog");
    if (!dialog) return;
    renderSources();
    setValue("#inventoryAsOfInput", "");
    setValue("#queryStartInput", "");
    setValue("#queryEndInput", "");
    setImportFeedback(
      "导入数据会标记为“已导入”，但仍需销售抽检后才可作为正式报价依据。",
    );
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeImportDialog() {
    const dialog = $("#importDialog");
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function setImportFeedback(message, type = "info") {
    const feedback = $("#importFeedback");
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle("is-error", type === "error");
    feedback.classList.toggle("is-success", type === "success");
  }

  function downloadBlob(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  }

  function toCSV(rows) {
    return `\uFEFF${rows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}`;
  }

  function exportCurrentCSV() {
    const pack = currentPackage();
    const profile = currentProfile();
    if (!pack) return;
    const start = state.startDate;
    const end = addDays(start, state.duration - 1);
    const rows = [
      [
        "方案",
        "行业",
        "目标客户",
        "预算",
        "投放打法",
        "上刊日期",
        "下刊日期",
        "刊期天数",
        "媒体类型",
        "媒体名称",
        "等级",
        "选择数量",
        "可售数量",
        "合同数量",
        "预定数量",
        "30 天发布刊例",
        "制作费状态",
        "查询档期",
        "库存状态",
        "选择理由",
        "数据来源",
        "数据时点",
      ],
    ];
    [...pack.busItems, ...pack.metroItems].forEach((item) => {
      rows.push([
        `${profile.brand} 2027 户外投放方案`,
        profile.industry,
        profile.brand,
        state.budget,
        pack.strategy.name,
        start,
        end,
        state.duration,
        item.kind === "bus" ? "公交车身" : "地铁出入口",
        item.name,
        item.level,
        item.units || 1,
        item.available,
        item.contracted,
        item.reserved,
        formatPriceRange(item, item.kind),
        productionLabel(item),
        queryLabel(item),
        inventoryLabels[item.availabilityState],
        item.reason,
        item.sourceState === "demo" ? "演示数据" : item.sourceState === "imported" ? "红豆导入" : "公交台账快照",
        item.asOf,
      ]);
    });
    downloadBlob(
      `新云提案_${safeFilename(profile.brand)}_${pack.strategy.name}_${start}.csv`,
      toCSV(rows),
      "text/csv;charset=utf-8",
    );
    showToast("当前方案清单已导出为 CSV。");
  }

  function exportTemplate() {
    if ($("#importDialog")?.open && $("#importType")?.value === "coverage") {
      const fields = ["媒体类型", "线路/点位名称", "媒体形式", "目标圈", "查询半径(米)"];
      downloadBlob("新云_覆盖分析导入模板.csv", toCSV([fields]), "text/csv;charset=utf-8");
      return;
    }
    const rows = [
      [
        "媒体类型",
        "线路/点位名称",
        "媒体形式",
        "等级",
        "可售数量",
        "合同车数",
        "预定车数",
        "状态",
        "运营公司",
        "查询日期",
        "查询起日",
        "查询止日",
        "画面面积",
      ],
    ];
    downloadBlob(
      "新云_红豆库存导入模板.csv",
      toCSV(rows),
      "text/csv;charset=utf-8",
    );
    showToast("导入模板已下载。按红豆查询结果填写。");
  }

  function exportClientHTML() {
    const profile = currentProfile();
    const active = currentPackage();
    if (!active) return;
    const activeBudget = state.budget;
    const { start, end } = planWindow();
    const budgets = [1000000, 2000000, 5000000];
    const confidence = getDataConfidence();
    const schedule = schedulePhases().map(([label, from, to]) =>
      `<li>${label} · ${formatDateRange(from, to)}</li>`).join("");
    const sourceNote = "数据依据：红豆目标档期导入或合成演示样例 · 刊例口径以项目配置为准 · " +
      (state.coverageMatches ? state.coverageEvidence : "商圈覆盖为策略估算") + "。以现场空位、施工和商务复核为准。";
    let sections;
    try {
      sections = budgets.map((budget) => {
        state.budget = budget;
        const pack = budget === activeBudget ? active : buildPackage(active.strategy, profile);
        const items = [...pack.busItems, ...pack.metroItems];
        const lines = items.map((item) =>
          `<details><summary>${escapeHTML(item.name)} · ${item.kind === "bus" ? "公交" : "地铁"} · ${item.units} ${item.kind === "bus" ? "辆" : "处"}</summary>
          <p>${escapeHTML(item.reason)}<br>${escapeHTML(inventoryLabels[item.availabilityState])} · 空位 ${item.available}<br>
          查询档期 ${escapeHTML(queryLabel(item))} · 数据时点 ${escapeHTML(item.asOf || "待核")}<br>
          发布刊例 ${escapeHTML(formatPriceRange(item, item.kind))} / 30天参考 · 制作费 ${escapeHTML(productionLabel(item))}</p></details>`).join("");
        return `<section data-budget="${budget}"${budget === activeBudget ? "" : " hidden"}>
          <h2>${escapeHTML(pack.strategy.name)} · ${budget / 10000} 万元</h2>
          <p>${pack.busCount} 辆公交 · ${pack.metroCount} 个地铁口 · ${pack.coveredZoneIds.length}/${pack.targetZones.length} 个目标圈（加权 ${pack.coverage}%）</p>
          ${pack.mixUnmet ? "<p>当前档期和预算下，未同时排入公交与地铁。</p>" : ""}
          <p class="quote">${escapeHTML(quoteRange(pack))}</p><p>${escapeHTML(quoteNote(pack))}</p>
          <p>可投放上限 ${escapeHTML(formatMoney(budgetCap()))} · 执行缓冲 5%${pack.mediaCount ? " · 已核算上限余量 " + escapeHTML(formatMoney(pack.savings)) : ""}</p>
          <h3>资源与证据</h3>${lines || "<p>当期无符合条件的资源，须按目标档期重查。</p>"}
          </section>`;
      });
    } finally {
      state.budget = activeBudget;
    }
    const title = profile.brand + " · " + profile.campaign;
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${escapeHTML(title)}</title><style>
      :root{color-scheme:light}body{margin:0;padding:38px max(20px,calc((100% - 860px)/2));background:#f5f1e8;color:#15342d;font:15px/1.7 system-ui,sans-serif}h1,h2,.quote{font-family:Georgia,"Songti SC",SimSun,serif}h1{font-size:clamp(27px,5vw,48px);line-height:1.2;margin:12px 0}h2{margin-top:12px}header,section,footer{padding:18px 0;border-bottom:1px solid #d8d2c4}summary{cursor:pointer;padding:7px 0}details{border-top:1px solid #e4decf}details p{padding-left:12px}.quote{font-weight:700;font-size:27px;margin-bottom:0}button{font:inherit;border:1px solid #a8aa9c;background:#faf7f0;color:#15342d;border-radius:5px;padding:5px 9px;margin:4px;cursor:pointer}button[aria-pressed=true]{background:#15342d;color:#fff8e9}.notice{color:#93432f}footer{font-size:12px}[hidden]{display:none}</style>
      <header><strong>户外媒体提案台 · FLAIR PROPOSAL</strong><h1>${escapeHTML(title)}</h1>
      <p>${escapeHTML(start)} 至 ${escapeHTML(end)} · ${state.duration} 天 · 拟议活动</p>
      <p>${escapeHTML(profile.subhead)} 目标人群：${escapeHTML(profile.audience)}。</p><p>${escapeHTML(profile.proposition)}</p>
      <p class="notice">${escapeHTML(confidence.hero)} · 库存和金额需复核</p></header>
      <nav aria-label="切换预算">${budgets.map((budget) => `<button type="button" data-tab="${budget}" aria-pressed="${budget === activeBudget}">${budget / 10000} 万</button>`).join("")}</nav>
      ${sections.join("")}<section><h2>执行排期</h2><ul>${schedule}</ul></section>
      <section><h2>监测与结案</h2><p>留存上刊与下刊照片，记录异常及补位情况。回图时点、施工窗口和验收口径由合同及执行团队确认。</p></section>
      <footer>${escapeHTML(sourceNote)}</footer>
      <script>for(const button of document.querySelectorAll('[data-tab]')) button.onclick=()=>{for(const node of document.querySelectorAll('[data-tab]')) node.setAttribute('aria-pressed',String(node===button));for(const section of document.querySelectorAll('[data-budget]')) section.hidden=section.dataset.budget!==button.dataset.tab;};</script></html>`;
    downloadBlob(safeFilename(title) + "_客户版.html", html, "text/html;charset=utf-8");
    showToast(active.mediaCount ? "客户版 HTML 已导出。" : "已导出待核草案，暂未形成报价。");
  }

  function exportJSON() {
    const pack = currentPackage();
    const profile = currentProfile();
    if (!pack) return;
    const snapshot = {
      generatedAt: new Date().toISOString(),
      app: "户外媒体提案台",
      brief: {
        industry: profile.industry,
        brand: profile.brand,
        budget: state.budget,
        media: Array.from(state.media),
        startDate: state.startDate,
        endDate: addDays(state.startDate, state.duration - 1),
        duration: state.duration,
      },
      strategy: pack.strategy,
      summary: {
        mediaCount: pack.mediaCount,
        busCount: pack.busCount,
        metroCount: pack.metroCount,
        coverage: pack.coverage,
        budgetUsage: pack.budgetUsage,
        budgetCap: budgetCap(),
        pendingProductionCount: pack.pendingProductionCount,
        totalMid: pack.totalMid,
        totalMin: pack.totalMin,
        totalMax: pack.totalMax,
      },
      media: [...pack.busItems, ...pack.metroItems].map((item) => ({
        id: item.id,
        kind: item.kind,
        name: item.name,
        level: item.level,
        units: item.units || 1,
        available: item.available,
        contracted: item.contracted,
        reserved: item.reserved,
        asOf: item.asOf,
        sourceState: item.sourceState,
        queryStart: item.queryStart,
        queryEnd: item.queryEnd,
        availabilityState: item.availabilityState,
        productionFee: item.productionPending ? null : item.productionSpend,
        reason: item.reason,
      })),
      dataState: getDataConfidence().hero,
      disclaimer: DATA.meta.disclaimer,
    };
    downloadBlob(
      `新云提案快照_${safeFilename(profile.brand)}_${state.startDate}.json`,
      JSON.stringify(snapshot, null, 2),
      "application/json;charset=utf-8",
    );
    showToast("方案数据快照已导出。");
  }

  function safeFilename(value) {
    return String(value || "方案").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "_");
  }

  function resetSampleData() {
    state.busRoutes = state.sample === false ? [] : clone(DATA.busRoutes);
    state.metroPoints = state.sample === false ? [] : clone(DATA.subwayPoints);
    state.areaOverrides = {};
    state.sources = clone(DATA.meta.sources);
    state.importedKinds.clear();
    state.coverageMatches = null;
    state.coverageEvidence = "";
    state.diffBase = null;
    state.lastImportName = "";
    state.inventoryAsOf =
      DATA.meta.sources.find((source) => source.id === "bus-ledger")?.asOf || "";
    state.selectedMediaId = null;
    renderAll({ announce: true, reason: "已清除导入库存与覆盖" });
    setImportFeedback("已清除当前项目的导入库存与覆盖。", "success");
  }

  function parseDelimited(text) {
    const cleanText = String(text || "").replace(/^\uFEFF/, "");
    const firstLine = cleanText.split(/\r?\n/, 1)[0] || "";
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const delimiter =
      tabCount >= commaCount && tabCount >= semicolonCount
        ? "\t"
        : semicolonCount > commaCount
          ? ";"
          : ",";
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let index = 0; index < cleanText.length; index += 1) {
      const character = cleanText[index];
      if (character === '"') {
        if (inQuotes && cleanText[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (character === delimiter && !inQuotes) {
        row.push(field);
        field = "";
      } else if ((character === "\n" || character === "\r") && !inQuotes) {
        if (character === "\r" && cleanText[index + 1] === "\n") index += 1;
        row.push(field);
        if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
        row = [];
        field = "";
      } else {
        field += character;
      }
    }
    row.push(field);
    if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
    return rows;
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("文件读取失败"));
      reader.readAsText(file, "utf-8");
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("文件读取失败"));
      reader.readAsArrayBuffer(file);
    });
  }

  async function readXlsxRows(file) {
    if (!window.JSZip) throw new Error("XLSX 解析组件未载入。");
    const buffer = await readFileAsArrayBuffer(file);
    const zip = await window.JSZip.loadAsync(buffer);
    const sharedStrings = [];
    const sharedFile = zip.file("xl/sharedStrings.xml");
    if (sharedFile) {
      const xml = new DOMParser().parseFromString(await sharedFile.async("text"), "text/xml");
      Array.from(xml.getElementsByTagName("si")).forEach((item) => {
        sharedStrings.push(
          Array.from(item.getElementsByTagName("t"))
            .map((text) => text.textContent || "")
            .join(""),
        );
      });
    }
    const sheetFiles = Object.keys(zip.files)
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
      .sort((first, second) => {
        const firstNumber = Number((first.match(/sheet(\d+)/) || [])[1] || 0);
        const secondNumber = Number((second.match(/sheet(\d+)/) || [])[1] || 0);
        return firstNumber - secondNumber;
      });
    if (!sheetFiles.length) throw new Error("XLSX 中没有找到工作表。");
    const parsedSheets = [];
    for (const sheetName of sheetFiles) {
      const xml = new DOMParser().parseFromString(
        await zip.file(sheetName).async("text"),
        "text/xml",
      );
      const rows = Array.from(xml.getElementsByTagName("row")).map((row) => {
        const values = [];
        Array.from(row.getElementsByTagName("c")).forEach((cell) => {
          const reference = cell.getAttribute("r") || "";
          const columnLetters = reference.replace(/\d+/g, "").toUpperCase();
          let columnIndex = 0;
          for (const letter of columnLetters) {
            columnIndex = columnIndex * 26 + letter.charCodeAt(0) - 64;
          }
          columnIndex = Math.max(0, columnIndex - 1);
          const type = cell.getAttribute("t");
          let value = "";
          if (type === "inlineStr") {
            value = Array.from(cell.getElementsByTagName("t"))
              .map((text) => text.textContent || "")
              .join("");
          } else {
            const valueNode = cell.getElementsByTagName("v")[0];
            value = valueNode?.textContent || "";
            if (type === "s") value = sharedStrings[Number(value)] || "";
          }
          values[columnIndex] = value;
        });
        return Array.from(values, (value) => (value == null ? "" : value));
      });
      parsedSheets.push(rows);
    }
    parsedSheets.sort((first, second) => rowsHeaderScore(second) - rowsHeaderScore(first));
    return parsedSheets[0];
  }

  function rowsHeaderScore(rows) {
    if (!Array.isArray(rows) || !rows.length) return 0;
    const sampleRows = rows.slice(0, 10);
    const knownTokens = Object.values(FIELD_ALIASES)
      .flat()
      .map(normalizeText)
      .filter(Boolean);
    let best = 0;
    sampleRows.forEach((row) => {
      let score = 0;
      row.forEach((cell) => {
        const normalized = normalizeText(cell);
        if (knownTokens.some((token) => normalized === token)) score += 2;
        else if (knownTokens.some((token) => token.length > 1 && normalized.includes(token))) score += 1;
      });
      best = Math.max(best, score);
    });
    return best;
  }

  function findHeaderIndex(rows) {
    let bestIndex = 0;
    let bestScore = -1;
    rows.slice(0, 15).forEach((row, index) => {
      const score = rowsHeaderScore([row]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function buildFieldMap(headers) {
    const normalizedHeaders = headers.map(normalizeText);
    const findColumn = (aliases, excludes = []) => {
      const normalizedAliases = aliases.map(normalizeText);
      const excluded = excludes.map(normalizeText);
      for (const alias of normalizedAliases) {
        const exactIndex = normalizedHeaders.findIndex(
          (header) => header === alias && !excluded.some((word) => header.includes(word)),
        );
        if (exactIndex >= 0) return exactIndex;
      }
      for (const alias of normalizedAliases) {
        const partialIndex = normalizedHeaders.findIndex(
          (header) =>
            header.includes(alias) &&
            alias.length > 1 &&
            !excluded.some((word) => header.includes(word)),
        );
        if (partialIndex >= 0) return partialIndex;
      }
      return -1;
    };
    return {
      mediaType: findColumn(FIELD_ALIASES.mediaType),
      mediaFormat: findColumn(FIELD_ALIASES.mediaFormat),
      routeName: findColumn(FIELD_ALIASES.routeName, ["等级", "空车", "合同", "预定", "总数", "运营", "媒体类型"]),
      pointName: normalizedHeaders.includes("线路点位名称") ? normalizedHeaders.indexOf("线路点位名称")
        : findColumn(FIELD_ALIASES.pointName, ["等级", "空车", "合同", "预定", "总数", "运营", "线路"]),
      station: findColumn(FIELD_ALIASES.station, ["等级", "出口"]),
      exitName: findColumn(FIELD_ALIASES.exitName),
      level: findColumn(FIELD_ALIASES.level),
      total: findColumn(FIELD_ALIASES.total),
      available: findColumn(FIELD_ALIASES.available),
      contracted: findColumn(FIELD_ALIASES.contracted),
      reserved: findColumn(FIELD_ALIASES.reserved),
      status: findColumn(FIELD_ALIASES.status),
      operator: findColumn(FIELD_ALIASES.operator),
      sourceDate: findColumn(FIELD_ALIASES.sourceDate),
      queryStart: findColumn(FIELD_ALIASES.queryStart),
      queryEnd: findColumn(FIELD_ALIASES.queryEnd),
      area: findColumn(FIELD_ALIASES.area),
      lines: findColumn(FIELD_ALIASES.lines, ["名称", "点位", "站"]),
      normalizedHeaders,
    };
  }

  function normalizeQueryDate(value) {
    const match = String(value ?? "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[ T])/);
    if (match) {
      const value = match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0");
      const date = parseISODate(value);
      return date && toISODate(date) === value ? value : "";
    }
    const serial = Number(value);
    if (Number.isInteger(serial) && serial >= 36526 && serial <= 73050) {
      return new Date(Date.UTC(1899, 11, 30 + serial)).toISOString().slice(0, 10);
    }
    return "";
  }

  function coverageKey(kind, name, format) {
    const cleanName = normalizeText(name);
    return kind + ":" + (kind === "bus" ? cleanName.replace(/路$/u, "") + "|" + normalizeText(format) : cleanName);
  }

  function coverageZones(kind, row) {
    if (!state.coverageMatches) return kind === "bus" ? (row.zoneIds || []) : [row.zoneId].filter(Boolean);
    return [...(state.coverageMatches.get(coverageKey(kind, row.route || row.name, row.mediaType)) || [])];
  }

  function importCoverage(rows, filename) {
    const headers = rows[0]?.map(normalizeText) || [];
    const fields = ["媒体类型", "线路点位名称", "媒体形式", "目标圈", "查询半径米"];
    const columns = fields.map((field) => headers.indexOf(field));
    if (columns.some((column) => column < 0)) throw new Error("覆盖分析表头请使用本页的覆盖模板。");
    const zones = new Map();
    for (const target of getTargetZoneData(currentProfile())) {
      [target.id, target.label, target.zone.name].forEach((label) => zones.set(normalizeText(label), target.id));
    }
    const matches = new Map();
    const radii = new Set();
    for (const row of rows.slice(1)) {
      if (!row.some((cell) => String(cell ?? "").trim())) continue;
      const [type, name, format, label, size] = columns.map((column) => String(row[column] ?? "").trim());
      const kind = /^(公交|bus)$/i.test(type) ? "bus" : /^(地铁|metro)$/i.test(type) ? "metro" : "";
      const zone = zones.get(normalizeText(label));
      const radius = Number(size);
      if (!kind || !name || !zone || !Number.isFinite(radius) || radius <= 0 || (kind === "bus" && !format)) {
        throw new Error("覆盖分析行缺少有效的媒体名称、公交形式、当前 Brief 的目标圈或查询半径。");
      }
      const key = coverageKey(kind, name, format);
      if (!matches.has(key)) matches.set(key, new Set());
      matches.get(key).add(zone);
      radii.add(radius);
    }
    if (!matches.size) throw new Error("覆盖分析没有有效的命中行。");
    state.coverageMatches = matches;
    state.coverageEvidence = "覆盖分析：" + filename + "，半径 " + [...radii].sort((a, b) => a - b).join("/") + " 米";
    state.diffBase = null;
    state.sources = state.sources.filter((source) => source.id !== "coverage-import");
    state.sources.unshift({ id: "coverage-import", name: filename, kind: "覆盖分析导入（待抽检）", state: "imported", asOf: "", detail: state.coverageEvidence });
    renderAll({ announce: true, reason: "覆盖证据已重算" });
    const matched = state.busRoutes.filter((row) => coverageZones("bus", row).length).length + state.metroPoints.filter((row) => coverageZones("metro", row).length).length;
    setImportFeedback("导入 " + matches.size + " 条媒体的覆盖证据，匹配当前库存 " + matched + " 条。", matched ? "success" : "info");
  }

  function importRows(rows, requestedType) {
    if (!Array.isArray(rows) || rows.length < 2) {
      throw new Error("文件至少需要一行字段名和一行数据。");
    }
    const headerIndex = findHeaderIndex(rows);
    const headers = rows[headerIndex] || [];
    const fieldMap = buildFieldMap(headers);
    const dataRows = rows.slice(headerIndex + 1);
    if (fieldMap.available < 0) {
      throw new Error("没有识别到“空车数 / 可售数量”字段。");
    }
    const getCell = (row, index) => (index >= 0 ? row[index] : "");
    const availableValues = dataRows
      .map((row) => getCell(row, fieldMap.available))
      .filter((value) => String(value).trim() !== "");
    if (!availableValues.length) {
      throw new Error("可售数量列为空，无法生成库存池。");
    }
    const mediaValues = dataRows
      .map((row) => normalizeText(getCell(row, fieldMap.mediaType)))
      .filter(Boolean);
    const hasMixedMedia =
      mediaValues.some((value) => value.includes("公交") || value.includes("bus")) &&
      mediaValues.some((value) => value.includes("地铁") || value.includes("metro"));
    const detectType = () => {
      if (requestedType === "bus" || requestedType === "metro") return requestedType;
      if (hasMixedMedia) return "mixed";
      const headerText = fieldMap.normalizedHeaders.join("|");
      if (
        headerText.includes("空车数") ||
        headerText.includes("线路等级") ||
        headerText.includes("合同车数") ||
        mediaValues.some((value) => value.includes("公交") || value.includes("bus"))
      ) {
        return "bus";
      }
      if (
        headerText.includes("点位") ||
        headerText.includes("站点") ||
        headerText.includes("出口") ||
        mediaValues.some((value) => value.includes("地铁") || value.includes("metro"))
      ) {
        return "metro";
      }
      return fieldMap.routeName >= 0 && fieldMap.pointName < 0 ? "bus" : "metro";
    };
    const type = detectType();
    const importedAt = $("#inventoryAsOfInput")?.value || "";
    const busRows = [];
    const metroRows = [];
    const seen = new Set();
    const fallbackStart = $("#queryStartInput")?.value;
    const fallbackEnd = $("#queryEndInput")?.value;
    if (Boolean(fallbackStart) !== Boolean(fallbackEnd) || (fallbackStart && fallbackStart > fallbackEnd)) {
      throw new Error("手填查询区间时，请提供顺序正确的起止日期。");
    }
    const metroAvailable = fieldMap.normalizedHeaders.indexOf("可售数量");

    dataRows.forEach((row, index) => {
      if (!row.some((cell) => String(cell).trim() !== "")) return;
      const mediaValue = normalizeText(getCell(row, fieldMap.mediaType));
      const rowType =
        type === "mixed"
          ? mediaValue.includes("地铁") || mediaValue.includes("metro")
            ? "metro"
            : "bus"
          : type;
      const rawAvailable = getCell(row, rowType === "metro" && metroAvailable >= 0 ? metroAvailable : fieldMap.available);
      const available = /^(?:0|[1-9]\d*)(?:\.0+)?$/.test(String(rawAvailable).trim()) ? Number(rawAvailable) : 0;
      const contracted = Math.max(
        0,
        Math.round(parseNumber(getCell(row, fieldMap.contracted))),
      );
      const reserved = Math.max(
        0,
        Math.round(parseNumber(getCell(row, fieldMap.reserved))),
      );
      const statusRaw = normalizeText(getCell(row, fieldMap.status));
      const status =
        statusRaw.includes("预定") ||
        statusRaw.includes("暂占") ||
        statusRaw.includes("reserved")
          ? "reserved"
          : statusRaw.includes("已售") ||
              statusRaw.includes("合同") ||
              statusRaw.includes("sold") ||
              statusRaw.includes("contracted")
            ? "sold"
            : /不可售|下架|暂停|unavailable|blocked/.test(statusRaw) ? "unavailable"
            : available > 0
              ? "available"
              : contracted > 0
                ? "sold"
                : reserved > 0
                  ? "reserved"
                  : "unavailable";
      const sourceDate = normalizeQueryDate(getCell(row, fieldMap.sourceDate) || importedAt);
      const fileStart = getCell(row, fieldMap.queryStart);
      const fileEnd = getCell(row, fieldMap.queryEnd);
      const hasFileWindow = Boolean(String(fileStart).trim() || String(fileEnd).trim());
      const queryStart = normalizeQueryDate(hasFileWindow ? fileStart : fallbackStart);
      const queryEnd = normalizeQueryDate(hasFileWindow ? fileEnd : fallbackEnd);
      if (rowType === "bus") {
        const routeName = String(
          getCell(row, fieldMap.routeName) ||
            getCell(row, fieldMap.pointName) ||
            `导入线路 ${index + 1}`,
        ).trim();
        const operator = String(getCell(row, fieldMap.operator) || "导入数据").trim();
        const total = Math.max(
          available + contracted + reserved,
          Math.round(parseNumber(getCell(row, fieldMap.total))),
          available,
        );
        const normalizedRoute = routeName.replace(/路$/u, "") || routeName;
        const rawMediaType = String(getCell(row, fieldMap.mediaFormat) || getCell(row, fieldMap.mediaType) || "").trim();
        const mediaType = /^(?:公交|bus)$/i.test(rawMediaType) || !rawMediaType ? "公交车身（形式待核）" : rawMediaType;
        const key = "bus:" + normalizeText(normalizedRoute + "|" + operator + "|" + mediaType);
        if (seen.has(key)) throw new Error("重复公交资源：" + routeName + " / " + mediaType + "。");
        seen.add(key);
        const referenceRoute = DATA.busRoutes.find((route) => normalizeText(route.route) === normalizeText(normalizedRoute) && route.mediaType === mediaType);
        const zoneIds = referenceRoute?.zoneIds || DATA.zones.filter((zone) =>
          (ZONE_KEYWORDS[zone.id] || []).some((keyword) => routeName.includes(keyword))).map((zone) => zone.id);
        busRows.push({
          id: `bus-import-${index + 1}-${stableNumber(`${routeName}-${index}`, 9999)}`,
          route: normalizedRoute,
          operator,
          level: normalizeLevel(getCell(row, fieldMap.level)),
          mediaType,
          total,
          maintenance: Math.max(0, total - available - contracted - reserved),
          contracted,
          reserved,
          available,
          renewal: 0,
          zoneIds,
          status,
          queryStart,
          queryEnd,
          sourceState: "imported",
          asOf: sourceDate,
        });
      } else {
        const pointName = String(
          getCell(row, fieldMap.pointName) ||
            [
              getCell(row, fieldMap.station),
              getCell(row, fieldMap.exitName),
            ]
              .filter(Boolean)
              .join(" ") ||
            `导入点位 ${index + 1}`,
        ).trim();
        const exitName = String(getCell(row, fieldMap.exitName) || "").trim();
        const pointLabel = exitName && !pointName.includes(exitName) ? pointName + " " + exitName : pointName;
        const key = "metro:" + normalizeText(pointLabel);
        if (seen.has(key)) throw new Error("重复地铁点位：" + pointLabel + "。");
        seen.add(key);
        const zone = DATA.zones.map((candidate) => ({
          zone: candidate,
          matchLength: Math.max(0, ...(ZONE_KEYWORDS[candidate.id] || [])
            .filter((keyword) => pointLabel.includes(keyword)).map((keyword) => keyword.length)),
        })).sort((a, b) => b.matchLength - a.matchLength).find((candidate) => candidate.matchLength)?.zone;
        const area = String(getCell(row, fieldMap.area) ?? "").trim();
        const actualArea = /^(?:\d+(?:\.\d+)?)\s*(?:㎡|平方米|m²|m2)?$/i.test(area) ? parseNumber(area) : null;
        const linesRaw = String(getCell(row, fieldMap.lines) || "");
        metroRows.push({
          id: `metro-import-${index + 1}-${stableNumber(`${pointName}-${index}`, 9999)}`,
          name: pointLabel,
          station: String(getCell(row, fieldMap.station) || pointName).trim(),
          exit: String(getCell(row, fieldMap.exitName) || "").trim(),
          level: normalizeLevel(getCell(row, fieldMap.level)),
          lines: linesRaw ? linesRaw.split(/[\/,，、\s]+/).filter(Boolean) : [],
          zoneId: zone?.id,
          x: zone ? zone.x + 12 * ((index % 3) - 1) : null,
          y: zone ? zone.y + 9 * ((index % 2) + 1) : null,
          demandIndex: zone?.demandIndex,
          queryStart,
          queryEnd,
          actualArea,
          status,
          available,
          contracted,
          reserved,
          sourceState: "imported",
          asOf: sourceDate,
        });
      }
    });

    if (!busRows.length && !metroRows.length) {
      throw new Error("没有可导入的数据行，请检查字段名和媒体类型。");
    }
    return { busRows, metroRows, type };
  }

  async function handleImportFile(file) {
    if (!file) return;
    const extension = (file.name.split(".").pop() || "").toLowerCase();
    const requestedType = $("#importType")?.value || "auto";
    setImportFeedback(`正在解析 ${file.name}…`);
    try {
      const rows =
        extension === "xlsx"
          ? await readXlsxRows(file)
          : parseDelimited(await readFileAsText(file));
      if (requestedType === "coverage") {
        importCoverage(rows, file.name);
        return;
      }
      const result = importRows(rows, requestedType);
      if (result.busRows.length) {
        state.busRoutes = result.busRows;
        state.importedKinds.add("bus");
      }
      if (result.metroRows.length) {
        state.metroPoints = result.metroRows;
        state.importedKinds.add("metro");
      }
      state.lastImportName = file.name;
      state.inventoryAsOf =
        $("#inventoryAsOfInput")?.value ||
        result.busRows[0]?.asOf ||
        result.metroRows[0]?.asOf ||
        "";
      const replaced = new Set([result.busRows.length && "import-bus", result.metroRows.length && "import-metro"]);
      state.sources = state.sources.filter((source) => !replaced.has(source.id));
      state.diffBase = null;
      if (result.busRows.length) {
        state.sources.unshift({
          id: "import-bus",
          name: file.name,
          kind: "红豆导入 · 公交",
          state: "imported",
          asOf: state.inventoryAsOf,
          detail: `${result.busRows.length} 条线路，${result.busRows.reduce((sum, row) => sum + row.available, 0)} 辆可售`,
        });
      }
      if (result.metroRows.length) {
        state.sources.unshift({
          id: "import-metro",
          name: file.name,
          kind: "红豆导入 · 地铁",
          state: "imported",
          asOf: state.inventoryAsOf,
          detail: `${result.metroRows.length} 个点位，${result.metroRows.filter((row) => row.available > 0).length} 个显示可售`,
        });
      }
      state.selectedMediaId = null;
      renderAll({ announce: true, reason: "库存导入已重算" });
      const counts = [
        result.busRows.length ? `${result.busRows.length} 条公交线路` : "",
        result.metroRows.length ? `${result.metroRows.length} 个地铁点位` : "",
      ]
        .filter(Boolean)
        .join("、");
      const matched = [...result.busRows, ...result.metroRows].filter((row) => inventoryState(row) === "matched").length;
      setImportFeedback(`已导入 ${counts}。其中 ${matched} 条有余量且查询档期匹配，仍需抽检占用明细。`, matched ? "success" : "info");
      showToast(`已导入 ${counts}，三套方案已重新生成。`);
    } catch (error) {
      setImportFeedback(
        `导入失败：${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    } finally {
      const input = $("#fileInput");
      if (input) input.value = "";
    }
  }

  function handleGlobalAction(action) {
    switch (action) {
      case "open-import":
        openImportDialog();
        break;
      case "close-import":
        closeImportDialog();
        break;
      case "export-csv":
        exportCurrentCSV();
        break;
      case "download-template":
        exportTemplate();
        break;
      case "export-json":
        exportJSON();
        break;
      case "export-html":
        exportClientHTML();
        break;
      case "cancel-area":
        $("#areaDialog").close();
        break;
      case "present":
        enterPresentation("overview");
        break;
      case "exit-present":
        exitPresentation();
        break;
      case "regenerate":
        renderAll({ announce: true, reason: "三套方案已重新生成" });
        showToast("已按当前 Brief 重算三套方案。");
        break;
      case "goto-strategy":
        scrollToSection("strategy");
        break;
      case "toggle-map":
        state.mapExpanded = !state.mapExpanded;
        document.body.classList.toggle("map-expanded", state.mapExpanded);
        document
          .querySelector('[data-action="toggle-map"]')
          ?.setAttribute("aria-pressed", String(state.mapExpanded));
        setTimeout(renderMap, 30);
        break;
      case "print":
        if (document.body.classList.contains("presenting")) exitPresentation();
        setTimeout(() => window.print(), 250);
        break;
      case "reset-data":
        resetSampleData();
        break;
      default:
        break;
    }
  }

  function attachEvents() {
    document.addEventListener("click", (event) => {
      const actionTrigger = event.target.closest("[data-action]");
      if (actionTrigger) {
        handleGlobalAction(actionTrigger.dataset.action);
      }
      const areaTrigger = event.target.closest("[data-area-id]");
      if (areaTrigger) openAreaEditor(areaTrigger.dataset.areaId);

      const budgetButton = event.target.closest("#budgetButtons button");
      if (budgetButton) setBudget(budgetButton.dataset.budget);

      const mediaButton = event.target.closest("#mediaToggles button");
      if (mediaButton) toggleMedia(mediaButton.dataset.media);

      const planCard = event.target.closest("[data-strategy]");
      if (planCard) setStrategy(planCard.dataset.strategy);

      const tableTab = event.target.closest("[data-table-view]");
      if (tableTab) {
        state.tableView = tableTab.dataset.tableView;
        renderInventory();
      }

      const selectMediaButton = event.target.closest("[data-select-media]");
      if (selectMediaButton) {
        selectMedia(selectMediaButton.dataset.selectMedia, true);
      }

      const workflow = event.target.closest(".workflow-link");
      if (workflow) scrollToSection(workflow.dataset.target);

      const presentationButton = event.target.closest("#presentationNav [data-target]");
      if (presentationButton) setPresentationSection(presentationButton.dataset.target);
    });

    $("#areaInput").addEventListener("input", (event) => {
      const area = event.target.valueAsNumber;
      setText("areaEstimate", area > 0 ? area + "㎡ × " + metroRate() + " 元/㎡ = " + yuan(metroProductionFee(area)) : "制作费按每平方米 " + metroRate() + " 元估算。");
    });
    $("#areaForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const area = $("#areaInput").valueAsNumber;
      const point = state.editingArea;
      if (!point || !Number.isFinite(area) || area <= 0) return;
      point.actualArea = area;
      state.areaOverrides = { ...state.areaOverrides, [point.id]: area };
      state.diffBase = null;
      $("#areaDialog").close();
      renderAll({ announce: true, reason: "制作费已重算" });
      const included = currentPackage().metroItems.some((item) => item.refId === point.id);
      showToast(point.name + " · " + area + "㎡ · " + yuan(metroProductionFee(area)) + (included ? "，已纳入当前合计。" : "，重算后未入当前组合。"));
    });

    document.addEventListener("keydown", (event) => {
      const planCard = event.target.closest("[data-strategy]");
      if (planCard && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        setStrategy(planCard.dataset.strategy);
      }
      if (document.body.classList.contains("presenting")) {
        if (event.key === "ArrowRight" || event.key === "PageDown") {
          event.preventDefault();
          movePresentation(1);
        } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
          event.preventDefault();
          movePresentation(-1);
        } else if (event.key === "Escape") {
          exitPresentation();
        }
      }
    });

    $("#industrySelect")?.addEventListener("change", (event) => {
      setIndustry(event.target.value);
    });

    $("#brandInput")?.addEventListener("input", (event) => {
      state.brand = event.target.value;
      setText("topbarBrand", `${state.brand || DATA.brands[state.industry].brand} · ${DATA.brands[state.industry].industry}`);
      clearTimeout(state.brandTimer);
      state.brandTimer = setTimeout(() => {
        renderAll({ announce: true, reason: "客户 Brief 已更新" });
      }, 260);
    });

    $("#startDateInput")?.addEventListener("change", (event) => {
      const value = event.target.value;
      if (!value || value < "2027-01-01" || value > "2027-12-31") {
        showToast("投放档期须在 2027 年内。");
        event.target.value = state.startDate;
        return;
      }
      const latestStart = addDays(
        "2027-12-31",
        -(Number(state.duration) || 30) + 1,
      );
      if (value > latestStart) {
        state.startDate = latestStart;
        event.target.value = latestStart;
        showToast(
          `刊期 ${state.duration} 天须完整落在 2027 年内，上刊日已调整至 ${latestStart}。`,
        );
      } else {
        state.startDate = value;
      }
      state.diffBase = null;
      renderAll({ announce: true, reason: "上刊日期已重算" });
    });

    $("#durationSelect")?.addEventListener("change", (event) => {
      state.duration = Number(event.target.value) || 30;
      const latestStart = addDays(
        "2027-12-31",
        -state.duration + 1,
      );
      if (state.startDate > latestStart) {
        state.startDate = latestStart;
        showToast(
          `刊期 ${state.duration} 天须完整落在 2027 年内，上刊日已调整至 ${latestStart}。`,
        );
      }
      state.diffBase = null;
      renderAll({ announce: true, reason: "刊期已重算" });
    });

    $("#cityMap")?.addEventListener("click", (event) => {
      const media = event.target.closest("[data-map-media-id]");
      if (media) selectMedia(media.dataset.mapMediaId);
    });
    $("#cityMap")?.addEventListener("keydown", (event) => {
      const media = event.target.closest("[data-map-media-id]");
      if (media && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        selectMedia(media.dataset.mapMediaId);
      }
    });

    const dropZone = $("#dropZone");
    if (dropZone) {
      ["dragenter", "dragover"].forEach((eventName) => {
        dropZone.addEventListener(eventName, (event) => {
          event.preventDefault();
          event.stopPropagation();
          dropZone.classList.add("is-dragging");
        });
      });
      ["dragleave", "drop"].forEach((eventName) => {
        dropZone.addEventListener(eventName, (event) => {
          event.preventDefault();
          event.stopPropagation();
          dropZone.classList.remove("is-dragging");
        });
      });
      dropZone.addEventListener("drop", (event) => {
        const file = event.dataTransfer?.files?.[0];
        if (file) handleImportFile(file);
      });
    }

    $("#fileInput")?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) handleImportFile(file);
    });

    $("#importDialog")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeImportDialog();
    });

    window.addEventListener("scroll", updateWorkflowActive, { passive: true });
    window.addEventListener("resize", () => {
      if (document.body.classList.contains("presenting")) {
        const active =
          getPresentationSections().find((id) =>
            document.getElementById(id)?.classList.contains("is-presentation-active"),
          ) || "overview";
        setPresentationSection(active);
      }
    });
  }

  function initialize() {
    attachEvents();
    renderAll();
    const today = new Date();
    const buildDate = DATA.meta.buildDate || toISODate(today);
    setValue("#inventoryAsOfInput", state.inventoryAsOf || buildDate);
    setText("recalcStatus", "实时联动");
    updateWorkflowActive();
  }

  const defaultProject = {
    industry: state.industry, brand: state.brand, budget: state.budget,
    media: [...state.media], startDate: state.startDate, duration: state.duration,
    strategy: state.strategy, campaign: "", assumptions: {}, targets: [], sample: true, rateCard: null, execution: null,
    data: { bus: [], metro: [], coverage: null, sources: [], asOf: "" }, areaOverrides: {},
  };

  function projectSnapshot() {
    return clone({
      industry: state.industry, brand: state.brand, budget: state.budget,
      media: [...state.media], startDate: state.startDate, duration: state.duration,
      strategy: state.strategy, campaign: state.campaign || "", assumptions: state.assumptions || {},
      targets: state.targets || [], areaOverrides: state.areaOverrides || {}, sample: state.sample !== false, rateCard: state.rateCard || null, execution: state.execution || null,
      data: {
        bus: state.importedKinds.has("bus") ? state.busRoutes : [],
        metro: state.importedKinds.has("metro") ? state.metroPoints : [],
        coverage: state.coverageMatches ? [...state.coverageMatches].map(([key, ids]) => [key, [...ids]]) : null,
        sources: state.sources.filter((source) => source.state === "imported"),
        asOf: state.importedKinds.size ? state.inventoryAsOf : "",
        coverageEvidence: state.coverageEvidence,
      },
    });
  }

  function applyProject(project, render = true) {
    clearTimeout(state.brandTimer);
    const { data, media, ...fields } = clone({ ...defaultProject, ...project });
    Object.assign(state, fields);
    state.media = new Set(media);
    state.importedKinds = new Set([data.bus.length ? "bus" : null, data.metro.length ? "metro" : null].filter(Boolean));
    state.busRoutes = data.bus.length ? data.bus : state.sample ? clone(DATA.busRoutes) : [];
    state.metroPoints = (data.metro.length ? data.metro : state.sample ? clone(DATA.subwayPoints) : []).map((point) =>
      Object.hasOwn(state.areaOverrides, point.id) ? { ...point, actualArea: state.areaOverrides[point.id] } : point);
    state.sources = [...data.sources, ...clone(DATA.meta.sources)];
    state.inventoryAsOf = data.asOf || DATA.meta.buildDate;
    state.lastImportName = data.sources[0]?.name || "";
    state.coverageMatches = data.coverage ? new Map(data.coverage.map(([key, ids]) => [key, new Set(ids)])) : null;
    state.coverageEvidence = data.coverageEvidence || "";
    state.selectedMediaId = null;
    state.diffBase = null;
    state.tableView = "selected";
    if (render) renderAll();
  }

  function buildCustomerProposal(project) {
    applyProject(project, false);
    const profile = currentProfile();
    const strategy = DATA.strategies.find((option) => option.id === state.strategy);
    const active = state.budget;
    const plans = [1000000, 2000000, 5000000].map((budget) => {
      state.budget = budget;
      const pack = buildPackage(strategy, profile);
      return {
        budget, cap: budgetCap(), total: [pack.totalMin, pack.totalMax],
        bus: pack.busCount, metro: pack.metroCount, pending: pack.pendingProductionCount,
        mediaCount: pack.mediaCount, mixUnmet: pack.mixUnmet, coverage: pack.coverage,
        targets: pack.targetZones.map((target) => ({ name: target.label, covered: pack.coveredZoneIds.includes(target.id) })),
        items: [...pack.busItems, ...pack.metroItems].map((item) => ({
          name: item.name, kind: item.kind, units: item.units, reason: item.reason, grade: item.level,
          query: queryLabel(item), status: inventoryLabels[item.availabilityState], state: item.availabilityState,
          production: productionLabel(item), rate: formatPriceRange(item, item.kind),
        })),
        published: pack.busSpend + pack.metroSpend, production: pack.productionSpend,
      };
    });
    state.budget = active;
    return clone({
      title: profile.campaign, brand: profile.brand, industry: profile.industry,
      budget: active, media: [...state.media], start: planWindow().start, end: planWindow().end,
      assumptions: state.assumptions, schedule: schedulePhases(), plans,
      strategy: strategy.name, sample: state.sample !== false, coverageImported: Boolean(state.coverageMatches),
      priceSource: state.rateCard?.source || "", discount: state.rateCard?.discount || 1, execution: state.execution || null,
    });
  }

  window.flairPlanner = {
    getProject: projectSnapshot, applyProject, buildCustomerProposal, defaults: () => clone(defaultProject),
    getZones: () => clone(DATA.zones), getIndustries: () => clone(DATA.brands),
  };
  if (typeof document !== "undefined") initialize();
})();


