const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const programs = ["assets/data.js", "assets/app.js"].map((name) => new vm.Script(fs.readFileSync(path.join(__dirname, name), "utf8"), { filename: name }));
const context = vm.createContext({ window: {}, clearTimeout: () => {} });
for (const program of programs) program.runInContext(context);
const engine = context.window.flairPlanner;
const STRATEGIES = ["coverage", "commute", "impact"];
const FIELDS = {
  customer: "客户与品牌", business: "生意目标", goal: "Campaign 主目标", audience: "目标人群",
  budget: "时间与预算", media: "媒体范围", success: "成功衡量",
};
const NUMBERS = [1000000, 2000000, 5000000];
const ISO = /^2027-\d{2}-\d{2}$/;
const pad = (value, limit = 1400) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const isoDate = (value) => ISO.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const range = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const zoneIds = new Set(engine.getZones().map((zone) => zone.id));
const industries = Object.keys(engine.getIndustries());
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const won = (amount) => (amount / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 3 }) + " 万元";

function inventory(input, kind) {
  const limit = 3000;
  if (!Array.isArray(input) || input.length > limit) throw new Error("库存记录数超限或格式有误。");
  const ids = new Set();
  return input.map((row) => {
    const id = pad(row?.id, 140);
    const name = pad(kind === "bus" ? row?.route : row?.name, 140);
    if (!id || !name || ids.has(id) || !Number.isSafeInteger(row.available) || !range(row.available, 0, 10000)) throw new Error("库存存在重复或无效行。");
    ids.add(id);
    const level = ["S", "A++", "A+", "AA", "A"].includes(row.level) ? row.level : "待核";
    const count = (value) => Number.isSafeInteger(value) && range(value, 0, 10000) ? value : 0;
    const common = {
      id, level, available: row.available, contracted: count(row.contracted), reserved: count(row.reserved),
      queryStart: isoDate(row.queryStart) ? row.queryStart : "", queryEnd: isoDate(row.queryEnd) ? row.queryEnd : "",
      asOf: /^\d{4}-\d{2}-\d{2}$/.test(row.asOf) ? row.asOf : "",
      sourceState: "imported", status: ["reserved", "sold", "unavailable"].includes(row.status) ? row.status : "available",
    };
    if (kind === "bus") return {
      ...common, route: name, operator: pad(row.operator, 140), mediaType: pad(row.mediaType, 80),
      total: count(row.total), zoneIds: Array.isArray(row.zoneIds) ? [...new Set(row.zoneIds.filter((id) => zoneIds.has(id)))] : [],
    };
    return {
      ...common, name, station: pad(row.station, 140), exit: pad(row.exit, 80), zoneId: zoneIds.has(row.zoneId) ? row.zoneId : null,
      x: range(row.x, 0, 1000) ? row.x : null, y: range(row.y, 0, 720) ? row.y : null, demandIndex: 75,
      lines: Array.isArray(row.lines) ? row.lines.slice(0, 12).map((line) => pad(line, 25)) : [],
      actualArea: range(row.actualArea, 0.01, 100000) ? row.actualArea : null,
    };
  });
}

function priceQuote(input) {
  if (input == null) return null;
  const valid = (amount) => range(amount, 0, 20000000);
  const band = (min, max) => {
    if (!valid(min) || !valid(max) || min > max) throw new Error("刊例区间无效。");
    return { min, max, mid: (min + max) / 2 };
  };
  const catalog = (kind, grades) => Object.fromEntries(grades
    .filter((grade) => input[kind]?.[grade] != null)
    .map((grade) => {
      const entry = input[kind][grade];
      if (!range(entry.min, 1, 20000000)) throw new Error("发布刊例须大于零。");
      return [grade, band(entry.min, entry.max)];
    }));
  const bus = catalog("bus", ["S", "A++", "A+", "AA", "A"]);
  const metro = catalog("metro", ["A++", "A+", "AA", "A"]);
  const production = band(input.busProductionMin, input.busProductionMax);
  const source = pad(input.source, 100);
  if (!source || !range(input.discount, 0.01, 1) || !range(input.metroProductionPerSqm, 0.01, 20000)
      || !Object.keys(bus).length && !Object.keys(metro).length) throw new Error("填写刊例来源、有效区间、制作费与发布折扣。");
  return { bus, metro, source, discount: input.discount, metroProductionPerSqm: input.metroProductionPerSqm,
    busProductionMin: production.min, busProductionMid: production.mid, busProductionMax: production.max };
}

function executionConfig(input) {
  if (input == null) return null;
  const whole = (value, low, high) => Number.isInteger(value) && range(value, low, high);
  const blackout = Array.isArray(input.blackout) ? [...new Set(input.blackout)].sort() : [];
  if (!whole(input.busPerNight, 1, 250) || !whole(input.metroPerNight, 1, 120) || !whole(input.buffer, 0, 14)
    || blackout.length > 120 || blackout.some((day) => !isoDate(day))) throw new Error("检查夜间施工容量、缓冲天数与 2027 年停工日期。");
  return {
    busPerNight: input.busPerNight, metroPerNight: input.metroPerNight, buffer: input.buffer, blackout,
    fallback: pad(input.fallback, 420), monitoring: pad(input.monitoring, 420), reachSource: pad(input.reachSource, 140),
    contactsBus: whole(input.contactsBus, 1, 1000000) ? input.contactsBus : 0,
    contactsMetro: whole(input.contactsMetro, 1, 1000000) ? input.contactsMetro : 0,
  };
}

function executionPlan(proposal, plan) {
  const config = proposal.execution;
  if (!config || !plan.mediaCount) return null;
  const start = Date.parse(proposal.start);
  const end = Date.parse(proposal.end);
  const stop = new Set(config.blackout);
  const nights = [];
  let bus = plan.bus, metro = plan.metro;
  let gross = 0;
  for (let date = start; date <= end && (bus || metro); date += 86400000) {
    const day = new Date(date).toISOString().slice(0, 10);
    if (stop.has(day)) continue;
    const busUnits = Math.min(bus, config.busPerNight);
    const metroUnits = Math.min(metro, config.metroPerNight);
    const remainingDays = Math.max(0, Math.floor((end - date) / 86400000));
    gross += (busUnits * config.contactsBus + metroUnits * config.contactsMetro) * remainingDays;
    nights.push({ day, bus: busUnits, metro: metroUnits });
    bus -= busUnits;
    metro -= metroUnits;
  }
  const unplaced = bus + metro;
  const contingency = nights.length && (end - Date.parse(nights.at(-1).day)) / 86400000 >= config.buffer;
  return { nights, unplaced, contingency: Boolean(contingency),
    grossContacts: !unplaced && config.reachSource && (!plan.bus || config.contactsBus) && (!plan.metro || config.contactsMetro) ? gross : null };
}

function normalize(input, allowSample) {
  if (!input || !industries.includes(input.industry) || !NUMBERS.includes(input.budget) || !STRATEGIES.includes(input.strategy)
    || !Array.isArray(input.media) || !input.media.length || input.media.some((item) => !["bus", "metro"].includes(item))
    || !isoDate(input.startDate) || ![30, 31, 45, 60, 90].includes(input.duration)
    || Date.parse(input.startDate) + (input.duration - 1) * 86400000 > Date.parse("2027-12-31")) {
    throw new Error("检查行业、预算、策略、媒体和 2027 年完整档期。");
  }
  const data = input.data || {};
  const sources = Array.isArray(data.sources) ? data.sources.slice(0, 8).map((item) => ({
    id: pad(item?.id, 70), name: pad(item?.name, 140), kind: pad(item?.kind, 100),
    detail: pad(item?.detail, 280), state: "imported", asOf: pad(item?.asOf, 25),
  })) : [];
  const coverage = data.coverage == null ? null : data.coverage;
  if (coverage !== null && (!Array.isArray(coverage) || coverage.length > 6000 ||
    coverage.some((entry) => !Array.isArray(entry) || !pad(entry[0], 200) || !Array.isArray(entry[1])))) {
    throw new Error("覆盖分析格式有误或记录超限。");
  }
  const validTargets = new Map();
  for (const target of Array.isArray(input.targets) ? input.targets.slice(0, 14) : []) {
    const label = pad(target?.label, 80);
    if (label && zoneIds.has(target.id)) validTargets.set(target.id, { id: target.id, label, priority: Boolean(target.priority) });
  }
  const overrides = Object.entries(input.areaOverrides || {}).slice(0, 3000).filter(([id, area]) => id.length <= 140 && range(area, 0.01, 100000));
  return {
    industry: input.industry, budget: input.budget, strategy: input.strategy, startDate: input.startDate, duration: input.duration,
    brand: pad(input.brand, 100), campaign: pad(input.campaign, 120), sample: allowSample === true,
    media: [...new Set(input.media)], assumptions: Object.fromEntries(Object.keys(FIELDS).map((key) => [key, pad(input.assumptions?.[key])])),
    targets: [...validTargets.values()], areaOverrides: Object.fromEntries(overrides), rateCard: priceQuote(input.rateCard), execution: executionConfig(input.execution),
    data: {
      bus: inventory(data.bus || [], "bus"), metro: inventory(data.metro || [], "metro"),
      coverage: coverage && coverage.map(([key, ids]) => [pad(key, 200), [...new Set(ids.filter((id) => zoneIds.has(id)))]]),
      sources, coverageEvidence: pad(data.coverageEvidence, 250), asOf: pad(data.asOf, 25),
    },
  };
}

function customerHtml(proposal, basePath, budget) {
  const plan = proposal.plans.find((choice) => choice.budget === Number(budget)) || proposal.plans.find((choice) => choice.budget === proposal.budget);
  const work = executionPlan(proposal, plan);
  const execution = work ? '<ul>' + work.nights.map(({day, bus, metro}) => '<li>' + day + ' 夜间 · 公交 ' + bus + ' 辆 · 地铁 ' + metro + ' 处</li>').join("") + '</ul>' +
    (work.unplaced ? '<p>尚有 ' + work.unplaced + ' 个资源超过夜间施工能力，须和运营重排。</p>' : !work.contingency ? '<p>排期未留足所设的天气缓冲。</p>' : '') +
    (proposal.execution.fallback ? '<p>异常替换预案：' + escape(proposal.execution.fallback) + '</p>' : '') +
    (proposal.execution.monitoring ? '<p>监测口径：' + escape(proposal.execution.monitoring) + '</p>' : '') +
    (work.grossContacts !== null ? '<p>估算累计接触机会 ' + work.grossContacts.toLocaleString("zh-CN") + ' 次。按实际计划上刊后的天数乘每日每单位系数，未做人群去重，来源：' + escape(proposal.execution.reachSource) + '。</p>' : '')
    : '<p>夜间施工批次、停工日期与缓冲等待运营配置。</p>';
  const traffic = plan.coverage === 0 ? "未形成已知覆盖" : "目标圈加权覆盖 " + plan.coverage + "%";
  const response = {
    customer: proposal.brand + " · " + proposal.industry,
    business: "组合策略为「" + proposal.strategy + "」，按投放目标配置公交和地铁资源。",
    goal: "主目标通过所选媒体触点承接，实际结果使用下述 KPI 和监测交付复核。",
    audience: traffic + "。地标：" + plan.targets.filter((target) => target.covered).map((target) => target.name).join("、"),
    budget: proposal.start + " 至 " + proposal.end + "，本档预算 " + won(plan.budget) + "，执行缓冲 5%。",
    media: "公交 " + plan.bus + " 辆，地铁 " + plan.metro + " 处。" + (plan.mixUnmet ? "当前资源不足以同时满足两类媒体。" : ""),
    success: "以上下刊照片、实际监测记录及结案报告复核执行。到店、扫码等指标按独立数据口径验收。",
  };
  const items = plan.items.map((item) => `<details><summary>${escape(item.name)} · ${item.units} · ${escape(item.grade)}</summary><p>${escape(item.reason)}<br>${escape(item.status)} · 查询档期 ${escape(item.query)}<br>发布刊例 ${escape(item.rate)} · 制作 ${escape(item.production)}</p></details>`).join("");
  const mode = proposal.sample ? "合成样例" : "镜像草案 · 库存与价格需业务复核";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(proposal.title)}</title><link rel="stylesheet" href="/assets/portal.css"></head><body class="customer"><main><p>${mode}</p><h1>${escape(proposal.title)}</h1><p>${escape(proposal.brand)} · ${proposal.start} 至 ${proposal.end}</p>
  <nav aria-label="切换预算">${proposal.plans.map((entry) => '<a href="' + escape(basePath) + '?budget=' + entry.budget + '"' + (entry === plan ? ' aria-current="page"' : '') + '>' + won(entry.budget) + '</a>').join(" ")}</nav>
  <section><h2>组合与报价</h2><p>${plan.mediaCount ? plan.total.map(won).join(" – ") : "当前档期暂无匹配资源"}</p><p>公交 ${plan.bus} 辆 · 地铁 ${plan.metro} 处 · ${traffic}</p>
  <p>${plan.mediaCount ? '发布费中位 ' + won(plan.published) + '，已核制作费中位 ' + won(plan.production) + '。' : ''}${plan.pending ? "有 " + plan.pending + " 处制作费待核，未计入当前区间。" : ""} 以项目计价口径复核。${proposal.priceSource ? " 刊例版本：" + escape(proposal.priceSource) + "，发布折扣：" + Math.round(proposal.discount * 100) + "%。" : ""}</p></section>
  <section><h2>Campaign 假设书与提案回应</h2><dl>${Object.entries(FIELDS).map(([key,label]) => '<dt>' + label + '</dt><dd>' + escape(proposal.assumptions[key]) + '<br><strong>方案回应：</strong>' + escape(response[key]) + '</dd>').join("")}</dl></section>
  <section><h2>点位清单与证据</h2>${items || "<p>待导入或复核目标档期资源。</p>"}</section>
  <section><h2>建议执行排期</h2><ul>${proposal.schedule.map(([label,a,b]) => '<li>' + escape(label) + ' · ' + a + ' 至 ' + b + '</li>').join("")}</ul><p>以运营确认的夜间施工批次、单夜容量及天气窗口为准。上刊、下刊照片与结案报告作为执行证据。异常补位和违约处理以项目合同为准。</p>${execution}</section></main></body></html>`;
}

module.exports = { engine, normalize, FIELDS, customerHtml, executionPlan, pad, escape };
