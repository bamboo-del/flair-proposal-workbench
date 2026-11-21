const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { openStore } = require("../store.cjs");
const { createApplication } = require("../server.cjs");
const { FIELDS } = require("../proposal.cjs");

test("在线项目：团队权限、镜像导入、版本与分享、证据、SQLite 重启恢复", async () => {
  const directory = mkdtempSync(join(tmpdir(), "flair-api-test-"));
  const filename = join(directory, "application.sqlite");
  let store = openStore(filename);
  let handler = createApplication(store, { PUBLIC_ORIGIN: "https://flair.example.test" });
  async function call(method, url, body, token, origin = "https://flair.example.test") {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(request, {
      method, url, socket: { remoteAddress: "127.0.0.1" },
      headers: { origin, host: "flair.example.test", "x-flair-client": "1", "content-type": "application/json", cookie: token },
    });
    const result = { status: 0, headers: {} };
    await handler(request, {
      setHeader(k, v) { result.headers[k.toLowerCase()] = v; },
      writeHead(status, headers) { result.status = status; Object.assign(result.headers, headers); return this; },
      end(payload) {
        const bytes = typeof payload === "string" ? payload : payload && Buffer.from(payload).toString();
        result.body = result.headers["Content-Type"]?.startsWith("application/json") && bytes ? JSON.parse(bytes) : bytes;
      },
    });
    return result;
  }
  async function login(user, password) {
    const response = await call("POST", "/api/session", { name: user, password });
    assert.equal(response.status, 200);
    assert.match(response.headers["set-cookie"], /HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/);
    return response.headers["set-cookie"].split(";")[0];
  }
  try {
    await store.bootstrap("admin", "test-only admin 2027");
    assert.equal((await call("GET", "/healthz")).status, 200);
    assert.match((await call("GET", "/")).body, /登录提案工作台/);
    assert.match((await call("GET", "/assets/portal.js")).body, /function setupFields/);
    assert.equal((await call("GET", "/api/projects")).status, 401);
    assert.equal((await call("POST", "/api/session", { name: "admin", password: "invalid" })).status, 401);
    assert.equal((await call("POST", "/api/session", {}, undefined, "https://elsewhere.example.test")).status, 403);
    const token = await login("admin", "test-only admin 2027");
    const newSpec = { name: "上海茶饮案", industry: "food", brand: "某茶饮品牌", campaign: "上海春季", sample: false };
    const created = await call("POST", "/api/projects", newSpec, token);
    assert.equal(created.status, 201);
    const project = created.body;
    const route = "/api/projects/" + project.id;
    assert.equal(project.state.sample, false);
    assert.equal(project.state.data.bus.length, 0);
    const second = await call("POST", "/api/projects", { ...newSpec, name: "独立的练习案", industry: "bank", sample: true }, token);
    assert.equal(second.status, 201);
    assert.notEqual(second.body.id, project.id);
    assert.equal((await call("POST", route + "/versions", { revision: project.revision }, token)).status, 422);

    const draft = {
      ...project.state, budget: 1000000, brand: "Brand <script>", campaign: "盈余春季",
      assumptions: Object.fromEntries(Object.keys(FIELDS).map((key) => [key, "可复核的匿名假设： " + key])),
      rateCard: { source: "测试刊例 v2", discount: 0.8, bus: { S: { min: 50000, max: 70000 } }, metro: { "A++": { min: 100000, max: 150000 } }, busProductionMin: 4000, busProductionMax: 6000, metroProductionPerSqm: 100 },
      execution: { busPerNight: 1, metroPerNight: 1, buffer: 4, blackout: ["2027-05-10"], fallback: "运营复核同商圈备用线路", monitoring: "照片和结案表", reachSource: "合成测试口径", contactsBus: 120, contactsMetro: 300 },
      data: {
        ...project.state.data,
        bus: [
          { id: "blocked", route: "零库存路", level: "S", mediaType: "大三侧", available: 0, queryStart: "2027-05-10", queryEnd: "2027-06-08" },
          { id: "match", route: "S999", level: "S", mediaType: "大三侧", available: 2, queryStart: "2027-05-10", queryEnd: "2027-06-08" },
          { id: "old", route: "过期路", level: "S", mediaType: "大三侧", available: 2, queryStart: "2027-03-01", queryEnd: "2027-03-30" },
        ],
        metro: [{ id: "metro", name: "静安样例出口", level: "A++", available: 1, queryStart: "2027-05-10", queryEnd: "2027-06-08", actualArea: 18 }],
        coverage: [["bus:s999|大三侧", ["jingan", "jingan"]], ["metro:静安样例出口", ["jingan"]]],
      },
    };
    const saved = await call("PUT", route, { revision: project.revision, name: project.name, state: draft }, token);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.revision, 2);
    assert.deepEqual(saved.body.state.data.coverage[0][1], ["jingan"]);
    assert.equal((await call("PUT", route, { revision: 1, name: project.name, state: draft }, token)).status, 409);
    assert.equal((await call("GET", route + "/mirrors", undefined, token)).body.length, 1);

    const history = await call("POST", route + "/versions", { revision: 2 }, token);
    assert.equal(history.status, 201, JSON.stringify(history.body));
    const version = route + "/versions/" + history.body.id;
    const snapshot = (await call("GET", version, undefined, token)).body.proposal;
    assert.equal((await call("GET", version + "/preview")).status, 401);
    assert.match((await call("GET", version + "/preview", undefined, token)).body, /preview\?budget=1000000/);
    const plan = snapshot.plans[0];
    assert(plan.items.some((item) => item.name.includes("S999") && item.state === "matched"));
    assert(!plan.items.some((item) => /过期路|零库存路/.test(item.name)));
    assert.equal(plan.items.find((item) => item.kind === "metro").production, "18㎡ × 100 = 1,800 元");
    assert(plan.total[1] <= 950000);
    assert.equal(snapshot.priceSource, "测试刊例 v2");
    assert.equal(snapshot.discount, 0.8);
    assert.equal((await call("POST", version + "/share", { days: 7, approved: false }, token)).status, 422);
    const share = (await call("POST", version + "/share", { days: 7, approved: true }, token)).body.path;
    const customer = await call("GET", share + "?budget=1000000");
    assert.equal(customer.status, 200);
    assert.match(customer.body, /Brand &lt;script&gt;/);
    assert.equal((customer.body.match(/方案回应/g) || []).length, 7);
    assert.match(customer.body, /测试刊例 v2/);
    assert.match(customer.body, /2027-05-11 夜间 · 公交 1 辆 · 地铁 1 处/);
    assert.match(customer.body, /估算累计接触机会.*合成测试口径/);
    assert.doesNotMatch(customer.body, /<script>/);

    assert.equal((await call("POST", "/api/team", { name: "viewer", password: "test-only viewer 2027", role: "viewer" }, token)).status, 201);
    const reader = await login("viewer", "test-only viewer 2027");
    assert.equal((await call("GET", route, undefined, reader)).status, 200);
    assert.equal((await call("PUT", route, { revision: 2, name: "unauthorized", state: draft }, reader)).status, 403);
    assert.equal((await call("POST", version + "/share", { approved: true }, reader)).status, 403);
    const evidence = await call("POST", route + "/evidence", { label: "脱敏监测回执", kind: "上刊", type: "text/plain", base64: "dHJhY2U=" }, token);
    assert.equal(evidence.status, 201);
    assert.equal((await call("GET", route + "/evidence/" + evidence.body.id, undefined, token)).body, "trace");

    const edited = await call("PUT", route, { revision: 2, name: "修订案", state: { ...draft, campaign: "第二版" } }, token);
    assert.equal(edited.status, 200);
    assert.match((await call("GET", share)).body, /盈余春季/);
    assert.doesNotMatch((await call("GET", share)).body, /第二版/);
    assert.equal((await call("GET", "/api/projects/" + second.body.id, undefined, token)).body.name, "独立的练习案");

    store.db.close();
    store = openStore(filename);
    handler = createApplication(store, { PUBLIC_ORIGIN: "https://flair.example.test" });
    assert.equal((await call("GET", route, undefined, token)).body.name, "修订案");
    assert.equal((await call("GET", share)).status, 200);
    const retiring = (await call("POST", version + "/share", { approved: true }, token)).body.path;
    assert.equal((await call("POST", route + "/archive", { archived: true }, token)).status, 200);
    assert.equal((await call("GET", retiring)).status, 404);
    assert.equal((await call("POST", route + "/archive", { archived: false }, token)).status, 200);
    assert.equal((await call("GET", retiring)).status, 404);
    assert.equal((await call("DELETE", version + "/share", undefined, token)).status, 200);
    assert.equal((await call("GET", share)).status, 404);
    assert.equal((await call("DELETE", "/api/team/viewer", undefined, token)).status, 200);
    assert.equal((await call("GET", route, undefined, reader)).status, 401);
  } finally {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
