/* Synthetic fixtures. All names, inventory counts, coverage and prices are invented. */
(() => {
  const zones = [
    ["hongqiao", "虹桥", 155, 325], ["zhongshan", "中山公园", 235, 285],
    ["xujiahui", "徐家汇", 320, 440], ["jingan", "静安寺", 375, 270],
    ["nanjing_west", "南京西路", 440, 305], ["huaihai", "淮海中路", 465, 370],
    ["xintiandi", "新天地", 535, 425], ["renmin", "人民广场", 520, 325],
    ["nanjing_east", "南京东路", 605, 300], ["lujiazui", "陆家嘴", 735, 325],
    ["wujiaochang", "五角场", 655, 155], ["qiantan", "前滩", 555, 575],
    ["longyang", "龙阳路", 710, 490], ["haichang", "滨海区域", 870, 600],
  ].map(([id, name, x, y], index) => ({ id, name, x, y, district: name, role: "commerce", demandIndex: 68 + (index * 7) % 25 }));

  const briefs = [
    ["food", "食品饮料", "某连锁咖啡品牌", "早高峰咖啡补给计划", "核心商圈的办公与通勤人群", "从经过商圈到到店，缩短消费者发现新品的路径。", ["jingan", "nanjing_west", "xujiahui", "huaihai", "lujiazui", "wujiaochang"]],
    ["bank", "银行保险", "某区域银行上海分行", "城市网点认知计划", "网点周边的通勤客流", "提升网点服务认知，以门店访问和咨询为后续验证。", ["renmin", "lujiazui", "nanjing_west", "hongqiao"]],
    ["health", "保健品", "某营养品连锁品牌", "社区品牌认知计划", "商圈与社区的家庭消费者", "增加线下门店曝光，创意文案侧重品牌和门店信息。", ["zhongshan", "huaihai", "qiantan", "xujiahui"]],
    ["hospital", "私立医院", "某上海民营医院", "体检服务到店计划", "院区附近有体检需求的家庭", "介绍服务入口，结合独立预约链接衡量咨询。", ["hongqiao", "zhongshan", "xujiahui", "jingan"]],
    ["park", "乐园", "某上海亲子主题乐园", "周末亲子到园计划", "周末计划亲子出游的家庭", "在出发与换乘地标覆盖客群，并用活动页衡量访问。", ["haichang", "longyang", "lujiazui", "xujiahui", "qiantan"]],
  ];
  const labels = new Map(zones.map((zone) => [zone.id, zone.name]));
  const brands = Object.fromEntries(briefs.map(([id, industry, brand, campaign, audience, objective, targets]) => [
    id, {
      id, industry, brand, campaign, headline: campaign, subhead: objective, audience,
      insight: "该场景为合成示例，需结合项目调研验证目标人群和投放动线。",
      objective, proposition: objective, creative: "突出活动信息与线下入口。",
      kpis: ["目标圈覆盖", "活动页访问", "上刊监测记录"], storeLabel: "目标商圈",
      targetZones: targets.map((zoneId, index) => ({
        id: zoneId, label: zoneId === "jingan" ? "静安核心门店" : labels.get(zoneId),
        weight: index < 2 ? 1 : 0.85,
      })),
    },
  ]));
  const asOf = "2026-01-13";
  const busRoutes = Array.from({ length: 52 }, (_, index) => {
    const available = index === 0 ? 0 : 2 + index % 4;
    const route = index === 0 ? "S100" : "S" + (910 + index);
    return {
      id: "fixture-bus-" + index, route, operator: "样例公交运营方",
      level: ["S", "A++", "A+"][index % 3], mediaType: index % 2 ? "大三侧" : "车身三侧",
      total: available + 3, available, contracted: 2, reserved: 1, maintenance: 0, renewal: 0,
      zoneIds: [zones[index % zones.length].id, zones[(index + 3) % zones.length].id],
      sourceState: "demo", asOf,
    };
  });
  const subwayPoints = zones.flatMap((zone, index) => [1, 2].map((exit) => ({
    id: "fixture-metro-" + zone.id + "-" + exit,
    name: zone.name + " · 样例" + exit + "号口", station: zone.name, exit: "样例" + exit + "号口",
    level: index % 2 ? "A+" : "A++", lines: [],
    zoneId: zone.id, x: zone.x + 13 * exit, y: zone.y + 9 * exit,
    demandIndex: zone.demandIndex, status: "available", available: 1, contracted: 0, reserved: 0,
    sourceState: "demo", asOf,
  })));
  const price = (min, max) => ({ min, mid: (min + max) / 2, max });
  const rates = {
    bus: { S: price(47000, 69000), "A++": price(35000, 56000), "A+": price(26000, 42000) },
    metro: { "A++": price(180000, 280000), "A+": price(115000, 183000) },
    busProductionMid: 6900, busProductionMin: 4800, busProductionMax: 9000,
    metroProductionPerSqm: 100,
  };
  const strategies = [
    { id: "coverage", name: "均衡覆盖", eyebrow: "COVERAGE", description: "分散媒体触点，兼顾公交与地铁覆盖。", busShare: 0.52, metroShare: 0.48, accent: "#31556a" },
    { id: "commute", name: "通勤渗透", eyebrow: "FREQUENCY", description: "优先增加通勤走廊公交露出。", busShare: 0.72, metroShare: 0.28, accent: "#486755" },
    { id: "impact", name: "地标引爆", eyebrow: "IMPACT", description: "用核心商圈地铁出入口建立高可见度。", busShare: 0.3, metroShare: 0.7, accent: "#a64531" },
  ];
  window.NEWCLOUD_DATA = {
    meta: {
      appName: "户外媒体提案台", buildDate: asOf, defaultIndustry: "food", defaultBudget: 2000000,
      defaultMedia: ["bus", "metro"], defaultStartDate: "2027-05-10", defaultDuration: 30,
      defaultStrategy: "impact",
      disclaimer: "公开版使用合成数据。档期、库存、覆盖与费用仅用于测试。",
      sources: [
        { id: "bus-ledger", name: "合成公交库存", kind: "测试样例", state: "demo", asOf, detail: "线路编号、可售数量和覆盖均为构造数据。" },
        { id: "subway-demo", name: "合成地铁点位", kind: "测试样例", state: "demo", asOf, detail: "点位名称、空位及面积缺口仅用于测试。" },
        { id: "rate-card", name: "合成刊例区间", kind: "测试样例", state: "demo", asOf, detail: "发布和制作费仅用于验证计算，不代表商业报价。" },
      ],
    },
    zones, brands, rates, strategies, busRoutes, subwayPoints,
  };
})();
