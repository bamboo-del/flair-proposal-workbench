"use strict";
/*
 * 车级调度与变更单。输入：一条线路的合同配置 + 车级台账（或明确标记的合成车辆）。
 * 先按硬约束过滤车辆，再排序候选；按夜间施工窗口与单夜容量排夜次；
 * 变更单在同一入口录入，重算后输出前后差异、任务先后、责任方与客户通知草稿，由团队确认后应用。
 */
const { addDays, overlaps } = require("./ledger.cjs");

const TYPES = {
  maintenance: "已排车辆临时进保",
  route_swap: "车辆换线",
  city_control: "城市管制（停工）",
  weather: "雨天占用施工窗口",
  client_revision: "客户改稿",
  rework: "外包返工",
  monitoring_delay: "监拍延迟",
};
const OWNERS = { ops: "媒体运营", print: "制作供应商", crew: "施工外包", photo: "监拍", account: "客户经理", sales: "销售" };
const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z"));
const text = (value, limit = 200) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const minutes = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return (h < 12 ? h + 24 : h) * 60 + m; };

function syntheticFleet(route = "S9DEMO", count = 12) {
  return Array.from({ length: count }, (_, index) => {
    const n = String(index + 1).padStart(2, "0");
    return {
      id: "SYN-" + n, plate: "合成车辆 " + n, route, model: index === count - 1 ? "10.5米 B型" : "12米 A型", format: "车身三侧",
      status: "ready", depotReturn: index % 4 === 3 ? "23:40" : "22:30", idleDays: 30 - index, unavailable: [], synthetic: true,
    };
  });
}

function defaultConfig() {
  return {
    route: "S9DEMO", startDate: "2027-05-10", duration: 30, minUnits: 10, perNight: 5, constructionNights: 3, buffer: 1,
    window: { from: "23:00", to: "04:30", minHours: 4 }, format: "车身三侧", artworkModel: "12米 A型", stoppages: [],
    makeGood: { miss: 1, compensate: 2 }, ruleSource: "合成合同 DEMO-2027-01 第 4.2 条：每误 1 天补 2 天（示例口径）", synthetic: true,
  };
}

function normalizeConfig(input = {}) {
  const base = defaultConfig();
  const out = { ...base };
  const errors = [];
  const int = (key, lo, hi) => { if (input[key] === undefined) return; Number.isInteger(input[key]) && input[key] >= lo && input[key] <= hi ? out[key] = input[key] : errors.push(key); };
  if (input.route !== undefined) text(input.route, 40) ? out.route = text(input.route, 40) : errors.push("route");
  if (input.startDate !== undefined) isDay(input.startDate) ? out.startDate = input.startDate : errors.push("startDate");
  int("duration", 7, 180); int("minUnits", 1, 200); int("perNight", 1, 50); int("constructionNights", 1, 14); int("buffer", 0, 20);
  if (input.window) {
    const ok = (v) => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
    ok(input.window.from) && ok(input.window.to) && Number.isFinite(input.window.minHours) && input.window.minHours > 0 && input.window.minHours <= 10
      ? out.window = { from: input.window.from, to: input.window.to, minHours: input.window.minHours } : errors.push("window");
  }
  if (input.format !== undefined) out.format = text(input.format, 40) || base.format;
  if (input.artworkModel !== undefined) out.artworkModel = text(input.artworkModel, 40) || base.artworkModel;
  if (input.stoppages !== undefined) {
    const rows = Array.isArray(input.stoppages) ? input.stoppages : [];
    if (!Array.isArray(input.stoppages) || rows.some((row) => !isDay(row?.date))) errors.push("stoppages");
    out.stoppages = [...new Map(rows.filter((row) => isDay(row?.date)).map((row) => [row.date, { date: row.date, reason: text(row.reason, 60) || "停工" }])).values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  if (input.makeGood) {
    const { miss, compensate } = input.makeGood;
    Number.isInteger(miss) && miss > 0 && Number.isInteger(compensate) && compensate >= 0 ? out.makeGood = { miss, compensate } : errors.push("makeGood");
  }
  if (input.ruleSource !== undefined) out.ruleSource = text(input.ruleSource, 160);
  out.synthetic = input.synthetic !== false;
  return { config: out, errors };
}

function normalizeFleet(input) {
  if (!Array.isArray(input) || input.length > 400) throw new Error("车级台账格式有误或超过 400 台。");
  const ids = new Set();
  return input.map((row) => {
    const id = text(row?.id, 40);
    if (!id || ids.has(id)) throw new Error("车辆编号缺失或重复。");
    ids.add(id);
    const unavailable = Array.isArray(row.unavailable) ? row.unavailable.filter((u) => isDay(u?.from) && isDay(u?.to) && u.from <= u.to)
      .map((u) => ({ from: u.from, to: u.to, reason: text(u.reason, 60) || "占用" })) : [];
    return {
      id, plate: text(row.plate, 40), route: text(row.route, 40), model: text(row.model, 40), format: text(row.format, 40),
      status: ["ready", "maintenance", "retired"].includes(row.status) ? row.status : "ready",
      depotReturn: /^\d{2}:\d{2}$/.test(row.depotReturn) ? row.depotReturn : "22:30",
      idleDays: Number.isInteger(row.idleDays) ? row.idleDays : 0, unavailable, synthetic: row.synthetic === true,
    };
  });
}

function campaign(config) { return { start: config.startDate, end: addDays(config.startDate, config.duration - 1) }; }

function nightsFor(config, from, count) {
  const stop = new Map(config.stoppages.map((row) => [row.date, row.reason]));
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(from, i);
    return { date, capacity: stop.has(date) ? 0 : config.perNight, stopped: stop.get(date) || null, vehicles: [] };
  });
}

/** 硬约束：路线、状态、档期占用、画面形式、回场时间与夜间施工窗口。 */
function eligibility(vehicle, config, range) {
  const reasons = [];
  if (vehicle.route && vehicle.route !== config.route) reasons.push("不属于 " + config.route + " 线");
  if (vehicle.status !== "ready") reasons.push(vehicle.status === "maintenance" ? "台账状态为进保" : "台账状态为停用");
  for (const u of vehicle.unavailable) if (overlaps(range.from, range.to, u.from, u.to)) reasons.push(u.reason + " " + u.from + " 至 " + u.to);
  if (vehicle.format && vehicle.format !== config.format) reasons.push("画面形式 " + vehicle.format + " 与 " + config.format + " 不适配");
  const start = Math.max(minutes(config.window.from), minutes(vehicle.depotReturn));
  const hours = (minutes(config.window.to) - start) / 60;
  if (hours < config.window.minHours) reasons.push("回场 " + vehicle.depotReturn + " 后施工窗口仅 " + hours.toFixed(1) + " 小时，少于 " + config.window.minHours + " 小时");
  return reasons;
}

function rank(vehicle, config) {
  return (vehicle.model === config.artworkModel ? 100 : 0) + vehicle.idleDays + (minutes(vehicle.depotReturn) <= minutes(config.window.from) ? 5 : 0);
}

/**
 * 排车。previous 存在时尽量保留原分配（同车同夜），只为失效车位找替补。
 * changeDay：变更生效日；早于该日已施工的车视为已上刊。
 */
function schedule(config, fleet, previous = null, changeDay = null) {
  const { start, end } = campaign(config);
  const leadFrom = addDays(start, -config.constructionNights);
  const range = { from: leadFrom, to: end };
  const rows = fleet.map((vehicle) => ({ vehicle, reasons: eligibility(vehicle, config, range), score: rank(vehicle, config) }));
  const excluded = rows.filter((row) => row.reasons.length).map((row) => ({ id: row.vehicle.id, reasons: row.reasons }));
  const eligible = rows.filter((row) => !row.reasons.length).sort((a, b) => b.score - a.score || a.vehicle.id.localeCompare(b.vehicle.id));
  const nights = nightsFor(config, leadFrom, config.constructionNights);
  const find = (date) => nights.find((night) => night.date === date);
  const assignments = [];
  const used = new Set();
  const replacements = [];

  const displaced = [];
  if (previous) {
    for (const a of previous.assignments) {
      const ok = eligible.find((row) => row.vehicle.id === a.vehicle);
      const night = find(a.night);
      const launched = a.night >= start;
      if (ok && (launched || (night && night.vehicles.length < night.capacity))) { night?.vehicles.push(a.vehicle); assignments.push({ ...a }); used.add(a.vehicle); }
      else if (ok) { displaced.push(a); used.add(a.vehicle); }
      else replacements.push(a);
    }
    // 同一辆车仍可用、只是原夜次停工：顺延到有容量的夜次，不换车。
    for (const a of displaced) {
      const open = nights.find((n) => n.vehicles.length < n.capacity);
      if (!open) { used.delete(a.vehicle); continue; }
      open.vehicles.push(a.vehicle);
      assignments.push({ ...a, night: open.date, movedFrom: a.night });
    }
  }
  const pool = eligible.filter((row) => !used.has(row.vehicle.id));
  const need = config.minUnits - assignments.length;
  // 变更后只补足失效车位；初排按起投量排满。
  const slots = previous ? [...replacements, ...displaced.filter((a) => !assignments.some((x) => x.vehicle === a.vehicle))].slice(0, Math.max(0, need))
    : Array.from({ length: Math.max(0, need) }, () => null);
  for (const slot of slots) {
    const row = pool.shift();
    if (!row) break;
    const wrapped = Boolean(slot && changeDay && slot.night < changeDay);
    let night = null;
    if (wrapped) {
      // 原车已施工：在变更日起的首个可施工夜补做（在刊期内夜间补位），产生误刊天数。
      for (let d = changeDay; d <= end; d = addDays(d, 1)) {
        if (config.stoppages.some((stop) => stop.date === d)) continue;
        if (assignments.filter((x) => x.night === d).length < config.perNight) { night = d; break; }
      }
    } else {
      const preferred = slot && find(slot.night);
      const open = preferred && preferred.vehicles.length < preferred.capacity ? preferred : nights.find((n) => n.vehicles.length < n.capacity);
      night = open?.date || null;
    }
    if (!night) { pool.unshift(row); break; }
    find(night)?.vehicles.push(row.vehicle.id);
    const missed = wrapped && night >= start ? Math.round((Date.parse(night) - Date.parse(changeDay < start ? start : changeDay)) / 86400000) + 1 : 0;
    assignments.push({ vehicle: row.vehicle.id, night, model: row.vehicle.model, replaces: slot?.vehicle || null, missedDays: missed,
      makeGoodDays: Math.ceil(missed / config.makeGood.miss) * config.makeGood.compensate, launch: night < start ? start : addDays(night, 1) });
    used.add(row.vehicle.id);
  }
  for (const a of assignments) a.model = a.model || fleet.find((v) => v.id === a.vehicle)?.model || "";
  const standby = pool.slice(0, config.buffer).map((row) => row.vehicle.id);
  assignments.sort((x, y) => x.night.localeCompare(y.night) || x.vehicle.localeCompare(y.vehicle));

  const placed = assignments.length;
  const missingVehicles = Math.max(0, config.minUnits - eligible.length);
  const unplaced = Math.max(0, config.minUnits - placed - missingVehicles);
  const missingNights = Math.ceil(unplaced / config.perNight);
  const shortfall = placed < config.minUnits ? shortfallOptions(config, fleet, { missingVehicles, missingNights, placed, nights, excluded }) : null;
  return {
    status: shortfall ? "review" : "ready", campaign: { start, end }, nights, assignments, standby, excluded, eligibleCount: eligible.length, shortfall,
    rules: { minUnits: config.minUnits, perNight: config.perNight, constructionNights: config.constructionNights, buffer: config.buffer,
      window: config.window, makeGood: config.makeGood, source: config.ruleSource },
    production: assignments.map((a) => ({ vehicle: a.vehicle, item: config.format + " 画面 · " + a.model, reuse: a.model === config.artworkModel, due: addDays(a.night, -1) })),
    synthetic: config.synthetic || fleet.some((v) => v.synthetic),
  };
}

function shortfallOptions(config, fleet, info) {
  const { start } = campaign(config);
  const options = [];
  const stoppedNights = info.nights.filter((night) => night.stopped);
  if (info.missingVehicles) {
    const nextFree = fleet.flatMap((v) => v.unavailable.map((u) => u.to)).sort().find((day) => day >= addDays(start, -config.constructionNights));
    options.push("从同线路组或备用车队调入 " + info.missingVehicles + " 台（需正式车级台账核对）");
    options.push("起投量由 " + config.minUnits + " 台降为 " + (config.minUnits - info.missingVehicles) + " 台（须按合同条款由客户确认）");
    if (nextFree) options.push("上刊推迟到 " + addDays(nextFree, 1) + " 之后，待进保／占用车辆释放");
  }
  if (info.missingNights) {
    options.push("施工提前 " + info.missingNights + " 晚开工（自 " + addDays(info.nights[0].date, -info.missingNights) + " 晚起）");
    options.push("单夜容量由 " + config.perNight + " 台提高到 " + Math.ceil(config.minUnits / Math.max(1, info.nights.filter((n) => !n.stopped).length)) + " 台（需施工外包加派班组）");
    options.push("上刊日推迟 " + info.missingNights + " 天");
  }
  const summary = [info.missingVehicles ? "可用车辆缺 " + info.missingVehicles + " 台" : "", info.missingNights ? "施工夜次缺 " + info.missingNights + " 晚" : ""].filter(Boolean).join("，");
  return {
    summary, missingVehicles: info.missingVehicles, missingNights: info.missingNights, placed: info.placed, required: config.minUnits,
    stopped: stoppedNights.map((night) => night.date + " " + night.stopped),
    message: summary + "。当前只能排 " + info.placed + "／" + config.minUnits + " 台，排期保留待复核，不发布。",
    options,
  };
}

/** 变更单入口：把不同类型统一转换为对台账或配置的修改。 */
function normalizeChange(input, fleet) {
  const type = Object.hasOwn(TYPES, input?.type) ? input.type : null;
  if (!type) throw new Error("请选择变更类型。");
  const from = isDay(input.from) ? input.from : null;
  const to = isDay(input.to) ? input.to : from;
  const vehicle = text(input.vehicle, 40);
  const note = text(input.note, 300);
  const needsVehicle = ["maintenance", "route_swap", "rework"].includes(type);
  if (needsVehicle && !fleet.some((v) => v.id === vehicle)) throw new Error("请选择台账中的车辆。");
  if (!from || to < from) throw new Error("请填写有效的起止日期。");
  const dates = Array.isArray(input.dates) ? input.dates.filter(isDay).slice(0, 14) : [];
  return { type, label: TYPES[type], vehicle: needsVehicle ? vehicle : "", from, to, dates: dates.length ? dates : [from], note, days: Number.isInteger(input.days) ? Math.min(Math.max(input.days, 1), 14) : 1 };
}

function applyChange(config, fleet, change) {
  const nextConfig = JSON.parse(JSON.stringify(config));
  const nextFleet = JSON.parse(JSON.stringify(fleet));
  const car = nextFleet.find((v) => v.id === change.vehicle);
  if (change.type === "maintenance") car.unavailable.push({ from: change.from, to: change.to, reason: "临时进保" });
  if (change.type === "route_swap") car.unavailable.push({ from: change.from, to: "2027-12-31", reason: "换线调出" });
  if (change.type === "city_control" || change.type === "weather") {
    const reason = change.type === "weather" ? "雨天停工" : "城市管制";
    nextConfig.stoppages = [...nextConfig.stoppages, ...change.dates.map((date) => ({ date, reason }))]
      .filter((row, i, all) => all.findIndex((r) => r.date === row.date) === i).sort((a, b) => a.date.localeCompare(b.date));
  }
  return { config: nextConfig, fleet: nextFleet };
}

function compare(before, after) {
  const a = new Map(before.assignments.map((row) => [row.vehicle, row]));
  const b = new Map(after.assignments.map((row) => [row.vehicle, row]));
  const removed = [...a.values()].filter((row) => !b.has(row.vehicle));
  const added = [...b.values()].filter((row) => !a.has(row.vehicle));
  const moved = [...b.values()].filter((row) => a.has(row.vehicle) && a.get(row.vehicle).night !== row.night)
    .map((row) => ({ vehicle: row.vehicle, from: a.get(row.vehicle).night, to: row.night }));
  const kept = [...b.values()].filter((row) => a.has(row.vehicle) && a.get(row.vehicle).night === row.night).map((row) => row.vehicle);
  const pairs = added.map((row) => ({ out: row.replaces, in: row.vehicle, night: row.night, missedDays: row.missedDays, makeGoodDays: row.makeGoodDays, model: row.model }));
  const nights = after.nights.map((night) => {
    const old = before.nights.find((n) => n.date === night.date);
    return { date: night.date, before: old?.vehicles || [], after: night.vehicles, stopped: night.stopped, changed: JSON.stringify(old?.vehicles) !== JSON.stringify(night.vehicles) || (old?.stopped || null) !== night.stopped };
  });
  const extra = after.assignments.filter((row) => row.night >= after.campaign.start).map((row) => ({ date: row.night, before: [], after: [row.vehicle], stopped: null, changed: true, inCampaign: true }));
  return { kept, removed: removed.map((r) => r.vehicle), added: added.map((r) => r.vehicle), moved, pairs, nights: [...nights, ...extra] };
}

function tasksFor(change, config, before, after, delta) {
  const tasks = [];
  const push = (owner, title, detail, after_ = []) => { const id = "T" + (tasks.length + 1); tasks.push({ id, owner: OWNERS[owner], title, detail, dependsOn: after_ }); return id; };
  if (after.status !== "ready") {
    const t1 = push("ops", "补齐车辆或施工夜次缺口", after.shortfall.message);
    push("sales", "与客户确认可选调整", after.shortfall.options.join("；"), [t1]);
    push("account", "审阅客户通知草稿（暂不发送）", "待缺口方案确定后再更新通知。", [t1]);
    return tasks;
  }
  if (["maintenance", "route_swap"].includes(change.type)) {
    const pair = delta.pairs[0];
    const confirm = push("ops", "确认 " + change.vehicle + " " + change.label + "并锁定替补 " + (pair?.in || "—"),
      change.vehicle + " " + change.from + " 至 " + change.to + " 不可用；替补车在台账中改绑 " + config.route + " 线并占用档期。");
    const wrapped = before.assignments.find((a) => a.vehicle === change.vehicle)?.night < change.from;
    const same = pair?.model === config.artworkModel;
    const print = push("print",
      same && !wrapped ? "将 " + change.vehicle + " 的制作单改绑 " + pair.in : "为 " + pair?.in + " 补印 1 套 " + config.format + "画面（" + pair?.model + "）",
      same ? (wrapped ? change.vehicle + " 画面已上车，需撤除；同型号按原版补印 1 套。" : "同型号，原画面直接转用，无需补印。") : "车型不同，按 " + pair?.model + " 尺寸出图并抽检。", [confirm]);
    if (wrapped) push("crew", "撤除 " + change.vehicle + " 车身画面", "进保前在场站撤除或保护画面，避免违规在刊。", [confirm]);
    const crew = push("crew", pair?.night + " 晚施工 " + pair?.in, "单夜容量 " + config.perNight + " 台，施工窗口 " + config.window.from + "–" + config.window.to + "。", [print]);
    push("photo", "监拍 " + pair?.in + " 上刊照片", "施工次日回传照片，替换监测清单中的 " + change.vehicle + "。", [crew]);
    if (pair?.missedDays) push("sales", "登记误刊补偿 " + pair.makeGoodDays + " 天", "误 " + pair.missedDays + " 天，按「" + config.ruleSource + "」补 " + pair.makeGoodDays + " 天。", [crew]);
    push("account", "审阅客户通知草稿", "负责人审阅后由团队发送；本系统不自动发送。", [confirm]);
  } else if (["city_control", "weather"].includes(change.type)) {
    const t = push("ops", "确认 " + change.dates.join("、") + " 停工并通知施工外包", change.label);
    push("crew", "按新夜次施工", delta.moved.map((m) => m.vehicle + " " + m.from + "→" + m.to).join("；") || "夜次未变化。", [t]);
    push("account", "审阅客户通知草稿", "负责人审阅后发送。", [t]);
  } else {
    const t = push(change.type === "client_revision" ? "print" : change.type === "rework" ? "crew" : "photo", change.label + "：登记并评估影响", change.note || "该类型复用变更单入口，影响需人工评估。");
    push("ops", "确认是否需要重排夜次", "当前版本只对进保、换线、停工自动重算。", [t]);
    push("account", "审阅客户通知草稿", "负责人审阅后发送。", [t]);
  }
  return tasks;
}

function noticeTemplate(change, config, after, delta) {
  const { start, end } = after.campaign;
  if (after.status !== "ready") {
    return { subject: config.route + " 线车身投放排期调整（待确认）",
      body: "您好：\n受「" + change.label + "」影响，" + config.route + " 线 " + start + " 至 " + end + " 的投放计划需调整。" + after.shortfall.summary + "。" + "\n可选方案：\n- " + after.shortfall.options.join("\n- ") + "\n我们将在确认方案后另行通知。\n（草稿，待负责人审阅）" };
  }
  const lines = delta.pairs.map((p) => "车辆 " + p.out + " 由同线路车辆 " + p.in + " 替补，" + p.night + " 晚施工" + (p.missedDays ? "，在刊受影响 " + p.missedDays + " 天，将按合同约定补足 " + p.makeGoodDays + " 天" : "，上刊日期与在刊天数不变") + "。");
  const moved = delta.moved.map((m) => m.vehicle + " 施工由 " + m.from + " 晚调整到 " + m.to + " 晚");
  return {
    subject: config.route + " 线车身投放执行调整说明",
    body: "您好：\n" + config.route + " 线投放（" + start + " 至 " + end + "）出现「" + change.label + "」：" + (change.vehicle ? change.vehicle + " " : "") + change.from + (change.to !== change.from ? " 至 " + change.to : "") + "。\n"
      + [...lines, ...moved].map((line) => "- " + line).join("\n") + (lines.length || moved.length ? "\n" : "- 投放车辆与夜次不受影响。\n")
      + "上刊照片将在施工次日更新至监测清单。\n（草稿，待负责人审阅后发送）",
  };
}

/** 生成变更预览：不修改当前计划，团队确认后才应用。 */
function preview(state, input) {
  const change = normalizeChange(input, state.fleet);
  const next = applyChange(state.config, state.fleet, change);
  const changeDay = ["maintenance", "route_swap", "rework"].includes(change.type) ? change.from : null;
  const after = schedule(next.config, next.fleet, state.plan, changeDay);
  const delta = compare(state.plan, after);
  return { change, config: next.config, fleet: next.fleet, plan: after, delta, tasks: tasksFor(change, next.config, state.plan, after, delta), notice: noticeTemplate(change, next.config, after, delta), applicable: after.status === "ready" };
}

module.exports = { TYPES, OWNERS, syntheticFleet, defaultConfig, normalizeConfig, normalizeFleet, schedule, preview, normalizeChange };
