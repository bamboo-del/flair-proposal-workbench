# 部署

以下配置供项目组验收后发布。镜像应从最终验收的 Git 提交构建。

## Sealos

1. 构建本仓库 Dockerfile，推送到团队可从部署区拉取的镜像仓库，并记录与 Git 提交对应的不可变标签。
2. 在 App Launchpad 使用该镜像，固定 **1 个实例**，容器端口 **3000**，挂载持久卷到 **/var/lib/flair**。确认容器的 node 用户（UID 1000）可写该目录。
3. 设置 ADMIN_USER、ADMIN_PASSWORD、实际外部 HTTPS 地址 PUBLIC_ORIGIN。PUBLIC_ORIGIN 只填协议与主机名，无路径。可选填 DEEPSEEK_API_KEY 和 DEEPSEEK_MODEL。
4. 开通外部访问后验证 /healthz、登录、角色限制、真实数据导入、固定版链接。重启和重新部署都需要验证已保存项目还在。
5. SQLite 单实例使用 WAL。备份使用 SQLite 在线备份流程或在应用停止写入后做完整副本，恢复演练应涵盖项目、附件、账号、版本和分享。

参考 [Sealos 应用发布](https://sealos.io/docs/guides/app-deploy/first-deploy/) 和 [Sealos 持久存储](https://sealos.io/docs/guides/app-deploy/persistent-volume/)。

## 阿里云

使用 compose.yaml 构建和启动。容器只映射到宿主机 127.0.0.1:3000，由反向代理提供 HTTPS，浏览器只访问对外地址。设置 PUBLIC_ORIGIN 为反代的真实 HTTPS 地址，保留 Host 与请求来源。Docker 命名卷 flair-data 保存 SQLite 数据和证据。迁移前先备份，迁移后用两份项目和一个固定版本链接复查。

## 已有与待查

代码和部署声明随仓库提供。正式云环境要对实际镜像构建、数据卷权限、服务公网地址、证书、模型连通性和恢复流程单独验收。
