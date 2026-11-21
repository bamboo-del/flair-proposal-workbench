const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const fromRoot = (filename) => fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
const template = fromRoot("index.html");
const nodes = new Map();
const noOp = () => {};
for (const [, id] of template.matchAll(/\bid="([^"]+)"/g)) {
  assert(!nodes.has(id), "Duplicate ID: " + id);
  nodes.set(id, {
    textContent: "", innerHTML: "", value: "", style: { setProperty: noOp },
    classList: { add: noOp, remove: noOp, toggle: noOp, contains: () => false },
    querySelector: () => null, closest: () => null, setAttribute: noOp, addEventListener: noOp,
    scrollIntoView: noOp,
  });
}
const downloads = [];
const window = { addEventListener: noOp };
const document = {
  getElementById: (id) => nodes.get(id),
  querySelector: (selector) => nodes.get(selector.slice(1)),
  querySelectorAll: () => [],
  addEventListener: noOp,
  body: { appendChild: noOp },
  createElement: () => ({ click: noOp, remove: noOp }),
};
const context = vm.createContext({
  window, document, setTimeout: noOp, clearTimeout: noOp, Blob, console,
  URL: { createObjectURL: (blob) => (downloads.push(blob), "blob:test"), revokeObjectURL: noOp },
});
vm.runInContext(fromRoot("assets/data.js"), context);
const source = fromRoot("assets/app.js").replace('  if (typeof document !== "undefined") initialize();', `  initialize();
  window.test = {state, currentPackage, currentProfile, setIndustry, setBudget, renderAll,
    importRows, importCoverage, inventoryState, schedulePhases, exportClientHTML};`);
vm.runInContext(source, context);
const app = window.test;
const text = (id) => nodes.get(id).textContent;
const html = (id) => nodes.get(id).innerHTML;
const yearDate = (start) => {
  app.state.startDate = start;
  app.state.diffBase = null;
  app.renderAll();
};
const report = [];
const snapshot = () => {
  const pack = app.currentPackage();
  return { low: pack.totalMin, mid: pack.totalMid, high: pack.totalMax, bus: pack.busCount, metro: pack.metroCount, pending: pack.pendingProductionCount };
};

async function run() {
  assert.match(text("heroHeadline"), /早高峰咖啡补给计划/);
  assert.equal(text("deskCap"), "¥190万");
  assert.match(text("deskRangeNote"), /制作费待核/);
  const initial = snapshot();
  app.setBudget(1000000);
  const reduced = snapshot();
  assert(reduced.high <= 950000 && reduced.high < initial.high && reduced.bus && reduced.metro);
  assert.match(text("diffLabel"), /200 → 100/);
  assert.match(html("diffBody"), /保留[\s\S]+撤下[\s\S]+新增/);
  assert.match(html("diffBody"), /重点目标圈/);
  report.push({ check: "预算降档", initial, reduced });

  yearDate("2027-03-01");
  app.state.duration = 31;
  app.renderAll();
  assert.equal(app.currentPackage().mediaCount, 0);
  assert.match(text("heroDataConfidence"), /档期待核/);
  assert.equal(text("deskRange"), "待核算");
  assert.equal(app.schedulePhases()[2].join(":"), "媒体发布:2027-03-01:2027-03-31");
  assert.match(html("schedulePhases"), /2027\.02\.15[\s\S]+2027\.04\.07/);
  report.push({ check: "换档期清空旧库存并重排四段时间", schedule: app.schedulePhases() });

  const headers = ["媒体类型", "线路/点位名称", "等级", "可售数量", "查询日期", "查询起日", "查询止日", "画面面积"];
  const data = [
    headers,
    ["公交", "S100路", "S", "0", "2026-11-21", "2027-03-01", "2027-03-31", ""],
    ["公交", "S926路", "S", "4", "2026-11-21", "2027-03-01", "2027-03-31", ""],
    ["地铁", "静安寺 5号口", "A++", "1", "2026-11-21", "2027-03-01", "2027-03-31", ""],
    ["地铁", "徐家汇 10号口", "A++", "1", "2026-01-13", "2026-01-13", "2026-01-13", "20"],
  ];
  const imported = app.importRows(data, "auto");
  app.state.busRoutes = imported.busRows;
  app.state.metroPoints = imported.metroRows;
  app.state.importedKinds.add("bus").add("metro");
  app.renderAll();
  assert.equal(app.inventoryState(imported.busRows[0]), "blocked");
  assert.equal(app.inventoryState(imported.metroRows[1]), "stale");
  assert.equal(app.currentPackage().metroItems[0].name, "静安寺 5号口");
  const incomplete = snapshot();
  assert.equal(incomplete.pending, 1);
  assert.match(html("checkBody"), /制作费待核[\s\S]+补录面积/);
  const areaPoint = imported.metroRows[0];
  areaPoint.actualArea = 18;
  app.renderAll();
  const filled = snapshot();
  assert.equal(filled.high - incomplete.high, 1800);
  assert.equal(filled.mid - incomplete.mid, 1800);
  assert.equal(filled.pending, 0);
  report.push({ check: "正确档期复算，零空位拦截，18㎡增加制作费 1,800 元", incomplete, filled });

  app.exportClientHTML();
  const payload = await downloads[0].text();
  assert.match(payload, /data-budget="1000000">/);
  assert.match(payload, /data-budget="2000000" hidden/);
  assert.match(payload, /18㎡ × 100 = 1,800 元/);
  assert.match(payload, /2027-03-01[\s\S]+2027-03-31/);
  assert(!payload.includes("徐家汇 10号口") && !payload.includes("S100 路"));
  assert.equal(app.state.budget, 1000000);
  report.push({ check: "客户版包含三档、已核对区间以及制作费证据", bytes: downloads[0].size });

  const coverage = [
    ["媒体类型", "线路/点位名称", "媒体形式", "目标圈", "查询半径(米)"],
    ["地铁", "静安寺 5号口", "", "静安核心门店", "100"],
    ["地铁", "静安寺 5号口", "", "静安核心门店", "100"],
  ];
  app.importCoverage(coverage, "coverage-fixture.csv");
  assert.equal(app.currentPackage().coveredZoneIds.join(","), "jingan");
  assert.match(text("targetCount"), /已导入覆盖/);
  app.exportClientHTML();
  assert.match(await downloads[1].text(), /coverage-fixture.csv，半径 100 米/);
  report.push({ check: "覆盖证据按目标圈去重并随客户版导出" });
  
  const distinctBus = app.importRows([
    ["媒体类型", "线路", "媒体形式", "等级", "空车数", "查询起日", "查询止日"],
    ["公交", "S955路", "大三侧", "A+", "4", "2027-03-01", "2027-03-31"],
    ["公交", "S955路", "车身三侧", "A+", "9", "2027-03-01", "2027-03-31"],
  ], "bus");
  assert.equal(distinctBus.busRows.map((row) => row.mediaType).join(","), "大三侧,车身三侧");
  report.push({ check: "S955 同线路两种车身形式独立入库" });

  app.state.coverageMatches = null;
  app.state.importedKinds.clear();
  app.state.busRoutes = window.NEWCLOUD_DATA.busRoutes;
  app.state.metroPoints = window.NEWCLOUD_DATA.subwayPoints;
  app.state.duration = 30;
  yearDate("2027-05-10");
  let combinations = 0;
  for (const industry of Object.keys(window.NEWCLOUD_DATA.brands)) {
    app.setIndustry(industry);
    for (const budget of [1000000, 2000000, 5000000]) {
      for (const media of [["bus"], ["metro"], ["bus", "metro"]]) {
        app.state.budget = budget;
        app.state.media = new Set(media);
        app.renderAll();
        for (const pack of app.state.packages) {
          assert(pack.mediaCount > 0);
          assert(pack.totalMax <= budget * 0.95 + 0.000001);
          for (const item of [...pack.busItems, ...pack.metroItems]) assert(item.units <= item.available);
          if (media.length === 2) assert(pack.busCount && pack.metroCount);
          combinations++;
        }
      }
    }
  }
  report.push({ check: "方案矩阵", combinations });
  console.log(JSON.stringify(report, null, 2));
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
