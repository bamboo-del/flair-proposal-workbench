/* 演示数据：一个合成样例项目、一个客户账号、一个编辑账号和 12 台合成车辆的执行计划。
 * 只写入本地 DATABASE_PATH；密码来自环境变量或随机生成并打印一次。 */
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { openStore } = require("../store.cjs");
const { createApplication } = require("../server.cjs");
const { normalize, engine } = require("../proposal.cjs");
const D = require("../lib/dispatch.cjs");

(async () => {
  const env = process.env;
  const store = openStore(path.resolve(env.DATABASE_PATH || "private-data/flair.sqlite"));
  await store.bootstrap(env.ADMIN_USER, env.ADMIN_PASSWORD);
  createApplication(store, env); // 建表
  const pass = (key) => env[key] || randomBytes(9).toString("base64url") + "-demo";
  const clientPassword = pass("DEMO_CLIENT_PASSWORD"), editorPassword = pass("DEMO_EDITOR_PASSWORD");
  const created = [];
  if (await store.addUser("demo.client", clientPassword, "client")) created.push(["demo.client", clientPassword]);
  if (await store.addUser("demo.editor", editorPassword, "editor")) created.push(["demo.editor", editorPassword]);
  let project = store.get("SELECT id FROM projects WHERE name=?", "合成演示 · 咖啡新品公交地铁案");
  if (!project) {
    const id = store.secret();
    const state = normalize({ ...engine.defaults(), industry: "food", brand: "某连锁咖啡品牌", campaign: "夏季新品上市" }, true);
    store.run("INSERT INTO projects (id,name,state,revision,updated,updated_by) VALUES (?,?,?,?,?,?)", id, "合成演示 · 咖啡新品公交地铁案", JSON.stringify(state), 1, store.date(), "seed");
    project = { id };
  }
  store.run("INSERT OR IGNORE INTO client_access VALUES (?,?,?)", "demo.client", project.id, store.date());
  if (!store.get("SELECT 1 FROM dispatch WHERE project_id=?", project.id)) {
    const config = D.defaultConfig(), fleet = D.syntheticFleet(config.route, 12);
    store.run("INSERT INTO dispatch VALUES (?,?,?,?,?,?,?)", project.id, JSON.stringify(config), JSON.stringify(fleet), JSON.stringify(D.schedule(config, fleet)), 1, store.date(), "seed");
  }
  console.log("演示项目：" + project.id);
  for (const [name, password] of created) console.log("新建账号 " + name + " / " + password);
  if (!created.length) console.log("演示账号已存在，密码未改变。");
  store.db.close();
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
