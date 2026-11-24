# grist-core 环境变量清单（自部署视角）

扫描对象：`~/workshop/vibe/xx/grist-core`，版本 1.7.22。
扫描日期：2026-11-24。只读扫描，未提交。

## 统计

| 口径 | 数量 |
|---|---|
| `grep -rhoE "GRIST_[A-Z0-9_]+" --include=*.ts --include=*.js --include=*.md`（原始命中，含文档与测试） | **275** |
| 其中在代码里出现（`app/` `apps/` `ext/` `docker/` `sandbox/` `bin/` 的 .ts/.sh/.py/.js） | 255 |
| 通过 `envVar: "X"` 或 `process.env.X` 读取（权威读取点） | 186 |
| 另有其它读取方式（`env.X`、shell 脚本、python） | +7 |
| 仅在文档/测试文本中出现、代码不读取 | 82 |

主表实际读取项：**217** = `GRIST_*` 193 + `APP_*` 8 + `TYPEORM_*` 11 + `GVISOR_*` 4 + `REDIS_URL` 1。
（193 = 186 通过 `envVar`/`process.env` + 7 通过其它写法：4 个 `GRIST_OIDC_*`、`GRIST_PROXY_AUTH_HEADER`、`GRIST_DOCKER_USER`、`GRIST_DOCKER_GROUP`。）
状态含义：**已设** = 在 `grist-auth/grist.env` 中；**默认** = 代码有默认值，不设即可；**仅测试** = 测试专用；**不建议** = 云版/SaaS/企业遗留，自部署不要设。

读取位置给一个即可，格式 `文件:行`。

---

## ① 实例与 URL

| 变量 | 用途 | 状态 | 位置 |
|---|---|---|---|
| `APP_HOME_URL` | 用户与集成访问本站的外部根 URL（OAuth 回调、邮件链接都用它） | 已设 | app/server/lib/BootProbes.ts:334 |
| `APP_HOME_INTERNAL_URL` | home worker 的内部根 URL，多服务器部署用 | 已设 | app/common/gristUrls.ts:303 |
| `APP_DOC_URL` | doc worker 对外根 URL | 默认（单机自动推导） | app/server/lib/FlexServer.ts:2493 |
| `APP_DOC_INTERNAL_URL` | doc worker 内部根 URL | 默认 | app/common/gristUrls.ts:306 |
| `APP_UNTRUSTED_URL` | 用户内容（自定义 widget）的独立来源根 URL | 默认 | app/server/MergedServer.ts:43 |
| `APP_STATIC_URL` | 静态资源根 URL | 默认 | app/server/devServerMain.ts:115 |
| `APP_STATIC_INCLUDE_CUSTOM_CSS` | 是否注入自定义 CSS | 默认 | app/server/lib/ICreate.ts:223 |
| `APP_ROOT_PATH` | 服务挂在子路径时的前缀 | 默认（空） | app/server/lib/places.ts:26 |
| `GRIST_HOST` | 绑定的主机名；参与 home/doc URL 推导 | 已设 | app/server/lib/BrowserSession.ts:202 |
| `GRIST_PORT` | 监听端口；无默认值 | 默认（镜像内 8484） | app/server/MergedServer.ts:281 |
| `GRIST_BOUND_ADDRESS` | 显式绑定地址覆盖 | 默认 | app/server/lib/FlexServer.ts:409 |
| `GRIST_SINGLE_PORT` | 开发用：所有服务挤一个端口 | 默认 | app/server/devServerMain.ts:83 |
| `GRIST_UNTRUSTED_PORT` | 用户内容的独立端口 | 默认 | app/server/MergedServer.ts:38 |
| `GRIST_ORG_IN_PATH` | 是否把 org 放进 URL 路径（`/o/<org>/…`） | 已设 | app/common/gristUrls.ts:1227 |
| `GRIST_SINGLE_ORG` | 只服务一个 org，其它 org 隐藏 | 默认（关闭） | app/gen-server/lib/ActivationsManager.ts:77 |
| `GRIST_ADAPT_DOMAIN` | 开发用：按域名适配 | 默认 | app/server/devServerMain.ts:46 |
| `GRIST_DOMAIN` | cookie/URL 推导用的主域名 | 默认 | app/server/lib/gristSessions.ts:182 |
| `GRIST_SERVE_SAME_ORIGIN` | 同源提供 home 与 doc（反代单域名场景） | 已设 | app/server/lib/requestUtils.ts:63 |
| `GRIST_PROXY_FOR_UNTRUSTED_URLS` | 用户内容是否走代理 | 默认 | app/server/lib/ProxyAgent.ts:31 |
| `GRIST_HTTPS_PROXY` | 出站 HTTPS 代理 | 默认 | app/server/lib/ProxyAgent.ts:44 |
| `GRIST_EXT_DIR` | 扩展目录 | 默认 | app/server/lib/places.ts:64 |
| `GRIST_STATIC_EXT_DIR` | 额外的静态扩展目录 | 默认 | app/server/lib/FlexServer.ts:904 |
| `GRIST_PLUGIN_PATH` | 插件目录 | 默认 | app/plugin/grist-plugin-api.ts:559 |
| `GRIST_USER_ROOT` | 每用户根目录（插件/用户态文件） | 默认 | app/server/lib/FlexServer.ts:2715 |
| `GRIST_WIDGET_LIST_URL` | 自定义 widget 清单 URL | 默认 | app/server/lib/WidgetRepository.ts:18 |
| `GRIST_WIDGET_LIST_URL_OPTIONAL` | 清单 URL 可否缺省 | 默认 | app/server/lib/WidgetRepository.ts:191 |
| `GRIST_INCLUDE_CUSTOM_SCRIPT_URL` | 页面里额外加载的脚本 URL | 默认 | app/server/lib/sendAppPage.ts:206 |
| `GRIST_CUSTOM_COMMON_URLS` | 页面公共 URL 覆盖 | 默认 | app/server/lib/sendAppPage.ts:168 |
| `GRIST_PAGE_TITLE_SUFFIX` | 页面标题后缀（品牌） | 默认 | app/server/lib/sendAppPage.ts:318 |
| `GRIST_OPEN_GRAPH_PREVIEW_IMAGE` | 分享预览图 | 默认 | app/server/lib/sendAppPage.ts:361 |
| `GRIST_API_BASE` | MCP bridge 调 Grist API 的基址 | 已设 | apps/mcp-bridge/src/server.ts:13 |
| `GRIST_HOSTED` | 云托管模式标记 | 不建议 | app/server/devServerMain.ts:45 |
| `GRIST_FLEET` | 多机集群标记 | 不建议 | app/server/lib/FlexServer.ts:1513 |
| `GRIST_ID_PREFIX` | 生成的资源 id 前缀 | 默认 | app/server/lib/FlexServer.ts:1011 |

## ② 认证与会话

| 变量 | 用途 | 状态 | 位置 |
|---|---|---|---|
| `GRIST_SESSION_SECRET` | 会话 cookie 签名密钥 | 已设 | app/server/lib/BootProbes.ts:317 |
| `GRIST_SESSION_COOKIE` | 会话 cookie 名 | 已设 | app/server/lib/gristSessions.ts:18 |
| `GRIST_SESSION_DOMAIN` | 会话 cookie 域 | 默认 | app/server/lib/gristSessions.ts:182 |
| `GRIST_IGNORE_SESSION` | 每个请求都信反代头，不用会话 | 默认（关闭） | app/server/lib/FlexServer.ts:1035 |
| `GRIST_FORWARD_AUTH_HEADER` | 反代传入的用户邮箱头名 | 已设 | app/server/lib/ForwardAuthLogin.ts:97 |
| `GRIST_FORWARD_AUTH_LOGIN_PATH` | forward-auth 登录路径（Grist 在此建会话） | 默认（`/auth/login`） | app/server/lib/ForwardAuthLogin.ts:113 |
| `GRIST_FORWARD_AUTH_LOGOUT_PATH` | forward-auth 登出路径 | 已设 | app/server/lib/ForwardAuthLogin.ts:108 |
| `GRIST_PROXY_AUTH_HEADER` | 上面那项的弃用别名 | 不建议（已弃用） | app/server/lib/ForwardAuthLogin.ts:97 |
| `GRIST_LOGIN_SYSTEM_TYPE` | 显式指定登录系统 | 默认（自动探测） | app/server/lib/loginSystemHelpers.ts:13 |
| `GRIST_DEFAULT_EMAIL` | 首个管理员的邮箱（安装用） | 已设 | app/server/lib/InstallAdmin.ts:116 |
| `GRIST_ADMIN_EMAIL` | 指定安装管理员（可多个） | 默认 | app/server/lib/gristSettings.ts:332 |
| `GRIST_BOOT_KEY` | 启动密钥（应急登录） | 默认（自动生成） | app/server/lib/gristSettings.ts:342 |
| `GRIST_ANON_PLAYGROUND` | 匿名 playground 开关 | 默认 | app/client/ui/PermissionsToggleModel.ts:260 |
| `GRIST_FORCE_LOGIN` | 强制登录后才能用 | 默认 | app/client/ui/PermissionsToggleModel.ts:252 |
| `GRIST_ORG_CREATION_ANYONE` | 任何登录用户可建团队站 | 默认 | app/client/ui/PermissionsToggleModel.ts:236 |
| `GRIST_PERSONAL_ORGS` | 允许个人站点 | 默认 | app/client/ui/PermissionsToggleModel.ts:244 |
| `GRIST_LIST_PUBLIC_SITES` | 首页列公开站点 | 默认 | app/gen-server/lib/homedb/HomeDBManager.ts:173 |
| `GRIST_SUPPORT_EMAIL` | 支持邮箱（UI 展示） | 默认 | app/gen-server/lib/homedb/UsersManager.ts:43 |
| `GRIST_ACCOUNT_CLOSE` | 是否允许用户注销账号 | 默认 | app/server/lib/FlexServer.ts:1833 |
| `GRIST_SINGLE_USER` | 单用户模式 | 默认 | app/server/lib/Authorizer.ts:121 |
| `GRIST_OIDC_IDP_ISSUER` | OIDC IdP issuer | 默认 | app/server/lib/OIDCConfig.ts:158 |
| `GRIST_OIDC_IDP_CLIENT_ID` | OIDC client id | 默认 | app/server/lib/OIDCConfig.ts:170 |
| `GRIST_OIDC_IDP_CLIENT_SECRET` | OIDC client secret | 默认 | app/server/lib/OIDCConfig.ts:174 |
| `GRIST_OIDC_SP_HOST` | OIDC 回调用的本站 URL | 默认 | app/server/lib/OIDCConfig.ts:165 |
| `GRIST_OIDC_IDP_SCOPES` | 请求的 scope | 默认 | app/server/lib/OIDCConfig.ts:217 |
| `GRIST_OIDC_IDP_ACR_VALUES` | 传给 IdP 的 acr_values | 默认 | app/server/lib/OIDCConfig.ts:203 |
| `GRIST_OIDC_IDP_END_SESSION_ENDPOINT` | IdP 登出端点 | 默认 | app/server/lib/OIDCConfig.ts:193 |
| `GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT` | 跳过 IdP 登出 | 默认 | app/server/lib/OIDCConfig.ts:198 |
| `GRIST_OIDC_IDP_ENABLED_PROTECTIONS` | 启用的 OIDC 防护项 | 默认 | app/server/lib/OIDCConfig.ts:239 |
| `GRIST_OIDC_IDP_EXTRA_CLIENT_METADATA` | 额外的 client 元数据 | 默认 | app/server/lib/OIDCConfig.ts:212 |
| `GRIST_OIDC_SP_HTTP_TIMEOUT` | 访问 IdP 的超时 | 默认 | app/server/lib/OIDCConfig.ts:179 |
| `GRIST_OIDC_SP_IGNORE_EMAIL_VERIFIED` | 忽略 email_verified | 默认 | app/server/lib/OIDCConfig.ts:207 |
| `GRIST_OIDC_SP_PROFILE_EMAIL_ATTR` | 邮箱字段名 | 默认 | app/server/lib/OIDCConfig.ts:188 |
| `GRIST_OIDC_SP_PROFILE_NAME_ATTR` | 姓名字段名 | 默认 | app/server/lib/OIDCConfig.ts:184 |
| `GRIST_OIDC_JWKS_URL` | 校验外部 JWT 的 JWKS 地址 | 已设 | app/server/lib/OidcValidator.ts:51 |
| `GRIST_OIDC_ISSUER` | 校验外部 JWT 的 issuer | 已设 | app/server/lib/OidcValidator.ts:52 |
| `GRIST_OIDC_AUDIENCE` | 校验外部 JWT 的 audience | 已设 | app/server/lib/OidcValidator.ts:53 |
| `GRIST_OIDC_EMAIL_CLAIM` | JWT 里表示邮箱的 claim | 已设 | app/server/lib/OidcValidator.ts:59 |
| `GRIST_IDP_EXTRA_PROPS` | 额外要保存的 IdP 字段 | 默认 | app/server/lib/OIDCConfig.ts:468 |
| `GRIST_SAML_SP_HOST` | SAML SP 的本站 URL | 默认 | app/server/lib/SamlConfig.ts:107 |
| `GRIST_SAML_SP_KEY` | SAML SP 私钥 | 默认 | app/server/lib/SamlConfig.ts:114 |
| `GRIST_SAML_SP_CERT` | SAML SP 证书 | 默认 | app/server/lib/SamlConfig.ts:118 |
| `GRIST_SAML_IDP_LOGIN` | IdP 登录端点 | 默认 | app/server/lib/SamlConfig.ts:122 |
| `GRIST_SAML_IDP_LOGOUT` | IdP 登出端点 | 默认 | app/server/lib/SamlConfig.ts:126 |
| `GRIST_SAML_IDP_SKIP_SLO` | 跳过单点登出 | 默认 | app/server/lib/SamlConfig.ts:130 |
| `GRIST_SAML_IDP_CERTS` | IdP 证书 | 默认 | app/server/lib/SamlConfig.ts:135 |
| `GRIST_SAML_IDP_UNENCRYPTED` | 允许未加密断言 | 默认 | app/server/lib/SamlConfig.ts:139 |
| `GRIST_ENABLE_SCIM` | 开 SCIM 用户同步 | 默认（关闭） | app/server/lib/FlexServer.ts:1124 |
| `GRIST_SCIM_EMAIL` | SCIM 用的邮箱来源 | 默认 | app/server/lib/scim/v2/ScimV2Api.ts:49 |
| `GRIST_ENABLE_SERVICE_ACCOUNTS` | 开服务账号（API key 机器人） | 默认 | app/gen-server/ApiServer.ts:696 |
| `GRIST_ALLOW_DEPRECATED_BARE_ORG_DELETE` | 允许旧式裸 org 删除 | 不建议 | app/gen-server/ApiServer.ts:46 |
| `GRIST_GETGRISTCOM_SECRET` | getgrist.com 联合登录密钥 | 不建议 | app/server/lib/GetGristComConfig.ts:64 |
| `GRIST_GETGRISTCOM_SP_HOST` | getgrist.com SP 主机 | 不建议 | app/server/lib/GetGristComConfig.ts:89 |
| `GRIST_TEST_LOGIN` | 测试登录后门 | 仅测试 | app/server/lib/FlexServer.ts:3102 |

## ③ 存储与数据

| 变量 | 用途 | 状态 | 位置 |
|---|---|---|---|
| `GRIST_DATA_DIR` | 文档文件目录（通常 `$INST_DIR/docs`） | 已设 | app/server/lib/BootProbes.ts:474 |
| `GRIST_INST_DIR` | 实例目录（数据库、文档、插件根） | 已设 | app/server/lib/places.ts:75 |
| `TYPEORM_TYPE` | 数据库类型（sqlite3 / postgres） | 默认（sqlite3） | app/gen-server/lib/values.ts:42 |
| `TYPEORM_DATABASE` | 数据库文件或库名 | 已设 | app/server/lib/BootProbes.ts:475 |
| `TYPEORM_HOST` | 数据库主机 | 默认 | app/server/lib/dbUtils.ts:177 |
| `TYPEORM_PORT` | 数据库端口 | 默认 | app/server/lib/dbUtils.ts:178 |
| `TYPEORM_USERNAME` | 数据库用户 | 默认 | app/server/lib/dbUtils.ts:175 |
| `TYPEORM_PASSWORD` | 数据库口令 | 默认 | app/server/lib/dbUtils.ts:176 |
| `TYPEORM_EXTRA` | 传给驱动的额外参数（JSON） | 默认 | app/server/lib/dbUtils.ts:194 |
| `TYPEORM_LOGGING` | ORM 的 SQL 日志级别 | 默认 | app/server/companion.ts:208 |
| `TYPEORM_LOG_SLOW_MS` | 慢查询阈值 | 默认 | app/server/lib/dbUtils.ts:182 |
| `TYPEORM_NAME` | 连接名 | 默认 | app/server/lib/dbUtils.ts:50 |
| `TYPEORM_REDIS_URL` | Redis 里传 typeorm 的地址 | 默认 | app/server/lib/dbUtils.ts:157 |
| `REDIS_URL` | Redis 地址（多 worker 通知） | 默认 | app/gen-server/lib/DocWorkerMap.ts:235 |
| `GRIST_POSTGRES_USE_PREPARED_STATEMENTS` | Postgres 预处理语句开关 | 默认 | app/gen-server/lib/homedb/HomeDBManager.ts:162 |
| `GRIST_SQL_TIMEOUT_MSEC` | 公式 SQL 查询超时 | 默认 | app/server/lib/runSQLQuery.ts:16 |
| `GRIST_SQLITE_MODE` | 文档 SQLite 模式调优 | 默认 | app/server/lib/DocStorage.ts:79 |
| `GRIST_VACUUM_ON_CLOSE` | 关文档时是否 VACUUM | 默认（关闭） | app/server/lib/DocStorage.ts:48 |
| `GRIST_FS_STORAGE_DIR` | 外部附件存储目录（文件系统后端） | 默认 | app/server/lib/configureFilesystemExternalStorage.ts:34 |
| `GRIST_EXTERNAL_ATTACHMENTS_MODE` | 附件存储模式（内部/外部） | 默认 | app/server/lib/AttachmentStoreProvider.ts:164 |
| `GRIST_DISABLE_S3` | 禁用 S3 类存储 | 不建议 | app/server/lib/FlexServer.ts:1683 |
| `GRIST_ATTACHMENTS_THRESHOLD_MB` | 超过该大小建议改用外存附件 | 默认（50） | app/server/lib/GranularAccess.ts:73 |
| `GRIST_MAX_INTERNAL_ATTACHMENTS_BYTES` | 内部附件总量上限 | 默认 | app/server/lib/ActiveDoc.ts:242 |
| `GRIST_MAX_UPLOAD_ATTACHMENT_MB` | 单个附件上传上限 | 默认 | app/server/lib/ActiveDoc.ts:3030 |
| `GRIST_MAX_UPLOAD_IMPORT_MB` | 导入文件上传上限 | 默认 | app/server/lib/ActiveDocImport.ts:327 |
| `GRIST_BACKUP_DELAY_SECS` | 改动后多久做备份（外部存储后端） | 默认 | app/server/lib/HostedStorageManager.ts:37 |
| `GRIST_SNAPSHOT_KEEP` | 保留多少个历史快照 | 默认（5） | app/server/lib/DocSnapshots.ts:393 |
| `GRIST_SNAPSHOT_TIME_CAP` | 快照精度的上限 | 默认 | app/server/lib/DocSnapshots.ts:355 |
| `GRIST_ACTION_HISTORY_MAX_BYTES` | 操作历史字节上限 | 默认 | app/server/lib/ActionHistoryImpl.ts:34 |
| `GRIST_ACTION_HISTORY_MAX_ROWS` | 操作历史行数上限 | 默认 | app/server/lib/ActionHistoryImpl.ts:27 |
| `GRIST_ACTIVEDOC_TIMEOUT_SECONDS` | 无客户端后保留文档的秒数，超时即关闭 | 默认（production 30s） | app/server/lib/ActiveDoc.ts:221 |

## ④ 沙箱

| 变量 | 用途 | 状态 | 位置 |
|---|---|---|---|
| `GRIST_SANDBOX_FLAVOR` | 公式沙箱类型（gvisor / pyodide / unsandboxed / macSandboxExec） | 已设 | app/server/lib/gristSettings.ts:205 |
| `GRIST_SANDBOX` | 沙箱程序/镜像名 | 默认 | app/server/lib/NSandbox.ts:1316 |
| `GRIST_SANDBOX_APPEND_ARGS` | 给沙箱追加参数 | 默认 | app/server/lib/NSandbox.ts:1321 |
| `GRIST_SANDBOX_OOM_SCORE_ADJ` | 沙箱进程 OOM 权重 | 默认 | app/server/lib/NSandbox.ts:1388 |
| `GRIST_THROTTLE_CPU` | 限沙箱 CPU（暂停/恢复进程） | 默认 | app/server/lib/SandboxControl.ts:42 |
| `GRIST_PYODIDE_SKIP_DENO` | pyodide 沙箱用 node 而非 Deno | 默认 | app/server/lib/SandboxPyodide.ts:42 |
| `GRIST_TRUTHY_VALUES` | 自定义“真”的取值 | 默认 | app/server/lib/NSandbox.ts:1179 |
| `GRIST_FALSY_VALUES` | 自定义“假”的取值 | 默认 | app/server/lib/NSandbox.ts:1183 |
| `GVISOR_FLAGS` | 传给 `runsc` 的启动参数 | 已设 | sandbox/gvisor/run.py:249 |
| `GVISOR_LIMIT_MEMORY` | gVisor 沙箱内存上限 | 默认 | sandbox/gvisor/run.py:133 |
| `GVISOR_LIMIT_NPROC` | gVisor 沙箱进程数上限（默认 8） | 默认 | sandbox/gvisor/run.py:129 |
| `GVISOR_EXTRA_DIRS` | 额外挂进 gVisor 的目录 | 默认 | sandbox/gvisor/run.py:175 |
| `GRIST_DOCKER_USER` | entrypoint 切到的运行用户 | 已设 | sandbox/docker_entrypoint.sh:13 |
| `GRIST_DOCKER_GROUP` | entrypoint 切到的运行组 | 已设 | sandbox/docker_entrypoint.sh:14 |

## ⑤ 功能开关与 UI

| 变量 | 用途 | 状态 | 位置 |
|---|---|---|---|
| `GRIST_HIDE_UI_ELEMENTS` | 隐藏界面元素（逗号分隔清单） | 默认 | app/server/lib/sendAppPage.ts:301 |
| `GRIST_UI_FEATURES` | 打开 UI 功能位 | 默认 | app/server/lib/sendAppPage.ts:302 |
| `GRIST_SUPPORT_ANON` | 显式打开匿名访问 UI | 默认 | app/server/lib/sendAppPage.ts:297 |
| `GRIST_TEMPLATE_ORG` | 模板库所在 org 域名 | 已设 | app/server/lib/gristSettings.ts:236 |
| `GRIST_ONBOARDING_TUTORIAL_DOC_ID` | 引导教程文档 id | 默认 | app/server/lib/gristSettings.ts:140 |
| `GRIST_WARN_BEFORE_SHARING_PUBLICLY` | 公开分享前提示 | 默认 | app/server/lib/sendAppPage.ts:170 |
| `GRIST_FEATURE_FORM_FRAMING` | 表单 iframe 嵌入 | 默认 | app/server/lib/sendAppPage.ts:58 |
| `GRIST_ENABLE_USER_PRESENCE` | 在线协作头像 | 默认 | app/server/lib/DocClients.ts:24 |
| `GRIST_USER_PRESENCE_MAX_USERS` | 同时显示人数上限 | 默认 | app/server/lib/gristSettings.ts:254 |
| `GRIST_USER_PRESENCE_ICON_PER_TAB` | 每个标签页单独头像 | 默认 | app/server/lib/UserPresence.ts:159 |
| `GRIST_MCP_ENABLED` | 打开内建 MCP 端点 | 默认（关闭） | app/server/lib/FlexServer.ts:3108 |
| `GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING` | 允许自动查新版本 | 已设 | app/server/lib/sendAppPage.ts:148 |
| `GRIST_EXPERIMENTAL_PLUGINS` | 实验插件 | 默认（dev 打开） | app/server/devServerMain.ts:51 |
| `GRIST_ENABLE_REQUEST_FUNCTION` | 公式里的 requests 能力 | 默认（dev 打开） | app/server/devServerMain.ts:56 |
| `GRIST_TRUST_PLUGINS` | 信任插件不受沙箱限制 | 默认 | app/server/lib/FlexServer.ts:2075 |
| `GRIST_EXPERIMENTAL_WORKER_ASSIGNMENT` | 实验性 doc worker 分配 | 默认 | app/gen-server/lib/DocWorkerMap.ts:688 |
| `GRIST_DEFAULT_LOCALE` | 默认语言 | 默认（en） | app/server/lib/ServerLocale.ts:10 |
| `GRIST_OFFER_ALL_LANGUAGES` | 提供全部语言 | 默认 | app/server/localization.ts:73 |
| `GRIST_LOCALES_DIR` | 语言包目录 | 默认 | app/server/localization.ts:18 |
| `GRIST_DEFAULT_PRODUCT` | 默认产品/版本类型 | 不建议 | app/gen-server/entity/Product.ts:170 |
| `GRIST_SERVER_EDITION` | 服务器版本标识 | 默认 | app/server/lib/gristSettings.ts:286 |
| `GRIST_FORCE_ENABLE_ENTERPRISE` | 强制开企业功能 | 不建议 | app/server/lib/gristSettings.ts:283 |
| `GRIST_EXT_FULL_EDITION_BASE_URL` | 完整版扩展包下载地址 | 已设 | app/server/lib/bootstrapFullEdition.ts:98 |
| `GRIST_IN_SERVICE` | 服务在位（维护模式的反面） | 已设 | app/server/lib/gristSettings.ts:360 |
| `GRIST_MAX_NEW_USER_INVITES_PER_ORG` | 每 org 新用户邀请上限 | 默认 | app/gen-server/lib/homedb/HomeDBManager.ts:146 |
| `GRIST_MAX_BILLING_MANAGERS_PER_ORG` | 每 org 计费管理员上限 | 不建议 | app/gen-server/lib/homedb/HomeDBManager.ts:156 |

## ⑥ 可观测与遥测

| 变量 | 用途 | 状态 | 位置 |
|---|---|---|---|
| `GRIST_LOG_LEVEL` | 日志级别 | 默认（info） | app/server/lib/log.ts:25 |
| `GRIST_LOG_AS_JSON` | 日志输出为 JSON | 默认 | app/server/lib/log.ts:16 |
| `GRIST_LOG_API_DETAILS` | 记录 API 细节 | 默认 | app/server/lib/requestUtils.ts:35 |
| `GRIST_LOG_HTTP` | 记录 HTTP 请求 | 默认 | app/server/lib/FlexServer.ts:2980 |
| `GRIST_LOG_SKIP_HTTP` | 跳过某些 HTTP 记录 | 默认 | app/server/lib/FlexServer.ts:2979 |
| `GRIST_LOG_HTTP_BODY` | 记录 HTTP body（含敏感信息，勿在生产开） | 默认（关闭） | app/server/lib/FlexServer.ts:610 |
| `GRIST_TELEMETRY_LEVEL` | 遥测级别 | 默认 | app/client/ui/PermissionsToggleModel.ts:268 |
| `GRIST_TELEMETRY_URL` | 遥测上报地址 | 不建议（云版） | app/server/lib/Telemetry.ts:74 |
| `GRIST_SYNC_WORK_LIMIT_MS` | 单次同步任务时长上限 | 默认（50ms） | app/gen-server/lib/Housekeeper.ts:46 |
| `GRIST_SYNC_WORK_BREAK_MS` | 同步任务之间的让出时长 | 默认（50ms） | app/gen-server/lib/Housekeeper.ts:52 |
| `GRIST_OLDEST_RECOMMENDED_VERSION` | 版本检查的下限 | 不建议 | app/server/lib/UpdateManager.ts:32 |
| `GRIST_REQUEST_TIMEOUT_MS` | 请求超时 | 默认 | app/server/lib/FlexServer.ts:3070 |
| `GRIST_KEEP_ALIVE_TIMEOUT_MS` | keep-alive 超时 | 默认 | app/server/lib/FlexServer.ts:3083 |
| `GRIST_HEADERS_TIMEOUT_MS` | 请求头超时 | 默认 | app/server/lib/FlexServer.ts:3076 |
| `GRIST_BROADCAST_TIMEOUT_MS` | 客户端广播超时 | 默认 | app/server/lib/DocClients.ts:20 |
| `GRIST_MAX_QUEUE_SIZE` | webhook 队列上限 | 默认 | app/server/lib/WebhookQueue.ts:51 |
| `GRIST_TRIGGER_MAX_ATTEMPTS` | webhook 重试次数 | 默认 | app/server/lib/WebhookQueue.ts:62 |
| `GRIST_TRIGGER_WAIT_DELAY` | webhook 重试间隔 | 默认 | app/server/lib/WebhookQueue.ts:59 |
| `GRIST_MAX_PARALLEL_REQUESTS_PER_DOC` | 单文档并发 API 上限 | 默认 | app/server/lib/DocApiUsageTracker.ts:64 |

## ⑦ 其它（多服务器、文档工作进程、测试）

| 变量 | 用途 | 状态 | 位置 |
|---|---|---|---|
| `GRIST_SERVERS` | 本进程角色（home / doc / all） | 默认（all） | app/server/MergedServer.ts:278 |
| `GRIST_ROUTER_URL` | doc worker 找 home 的地址 | 默认 | app/server/lib/FlexServer.ts:1272 |
| `GRIST_DOC_WORKER_ID` | 本 doc worker 的 id | 默认 | app/server/lib/FlexServer.ts:2491 |
| `GRIST_WORKER_GROUP` | doc worker 的组 | 默认 | app/server/lib/FlexServer.ts:2510 |
| `GRIST_MANAGED_WORKERS` | 受管 worker 列表 | 默认 | app/server/lib/DocWorkerUtils.ts:102 |
| `GRIST_DOC_WORKER_MAX_MEMORY_MB` | worker 内存上限（MB） | 默认 | app/server/lib/DocWorkerLoadTracker.ts:17 |
| `GRIST_DOC_WORKER_MAX_MEMORY_BYTES_PATH` | 从文件读内存上限 | 默认 | app/server/lib/DocWorkerLoadTracker.ts:39 |
| `GRIST_DOC_WORKER_USED_MEMORY_BYTES_PATH` | 从文件读已用内存 | 默认 | app/server/lib/DocWorkerLoadTracker.ts:33 |
| `GRIST_DOC_WORKER_UPDATE_LOAD_INTERVAL_MS` | 负载上报间隔 | 默认 | app/server/lib/docWorkerSettings.ts:10 |
| `GRIST_DOC_WORKER_UPDATE_LOAD_VARIANCE_MS` | 负载上报抖动 | 默认 | app/server/lib/DocWorkerLoadTracker.ts:25 |
| `GRIST_CHECKPOINT` | 生成/使用 checkpoint 标记 | 默认 | app/server/generateCheckpoint.ts:14 |
| `GRIST_CHECKPOINT_MAKE` | 生成 checkpoint 模式 | 默认 | app/server/generateCheckpoint.ts:17 |
| `GRIST_RESTART_SHELL` | 使用重启外壳（原地重启/升级） | 默认 | app/server/lib/RestartShell.ts:459 |
| `GRIST_UNDER_RESTART_SHELL` | 标记自己在外壳下运行 | 默认 | app/server/lib/RestartShellWorker.ts:18 |
| `GRIST_RUNNING_UNDER_SUPERVISOR` | 标记受 supervisor 管理 | 默认 | app/server/lib/adminPageConfig.ts:11 |
| `GRIST_TESTING_SOCKET` | 测试走 socket | 仅测试 | app/server/lib/FlexServer.ts:1647 |
| `GRIST_TEST_ADD_PORT_TO_DOCS_ROOT` | 测试用文档根加端口 | 仅测试 | app/server/lib/FlexServer.ts:268 |
| `GRIST_TEST_ATTACHMENTS_DIR` | 测试附件目录 | 仅测试 | app/server/lib/AttachmentStoreProvider.ts:152 |
| `GRIST_TEST_DOC_AUTH_CACHE_TTL` | 测试用权限缓存 TTL | 仅测试 | app/gen-server/lib/homedb/HomeDBManager.ts:180 |
| `GRIST_TEST_ENABLE_PROXIED_TO_HEADER` | 测试用 X-Forwarded-To | 仅测试 | app/server/lib/requestUtils.ts:986 |
| `GRIST_TEST_HTTPS_OFFSET` | 测试端口偏移 | 仅测试 | app/server/lib/requestUtils.ts:41 |
| `GRIST_TEST_IMMEDIATE_VERSION_CHECK` | 启动即查版本 | 仅测试 | app/gen-server/lib/Housekeeper.ts:101 |
| `GRIST_TEST_PROXY_URL` | 测试代理 | 仅测试 | app/gen-server/lib/Housekeeper.ts:58 |
| `GRIST_TEST_REDIS_QUEUE_PREFIX` | 测试队列前缀 | 仅测试 | app/server/lib/GristJobs.ts:11 |
| `GRIST_TEST_RESTART_SHELL_BUSY_INTERVAL` | 测试重启外壳间隔 | 仅测试 | app/server/lib/RestartShellWorker.ts:49 |
| `GRIST_TEST_RESTART_SHELL_READY_DELAY` | 测试就绪延迟 | 仅测试 | app/server/lib/RestartShellWorker.ts:48 |
| `GRIST_TEST_ROUTER` | 测试路由 | 仅测试 | app/server/MergedServer.ts:85 |
| `GRIST_TEST_SANDBOX_ARGS` | 测试沙箱参数 | 仅测试 | app/server/lib/NSandbox.ts:1320 |
| `GRIST_TEST_SANDBOX_PROVIDERS_PROBE_RESULT` | 注入沙箱探针结果 | 仅测试 | app/server/lib/BootProbes.ts:421 |
| `GRIST_TEST_SERVER_DEPLOYMENT_TYPE` | 测试部署类型 | 仅测试 | app/server/lib/FlexServer.ts:280 |
| `GRIST_TEST_SSL_CERT` | 测试证书 | 仅测试 | app/server/lib/FlexServer.ts:2753 |
| `GRIST_TEST_SSL_KEY` | 测试私钥 | 仅测试 | app/server/lib/FlexServer.ts:2754 |
| `GRIST_TEST_TRANSFER_DELAY` | 测试附件传输延迟 | 仅测试 | app/server/lib/AttachmentFileManager.ts:383 |
| `GRIST_TEST_UPDATE_CHECK_TTL` | 测试版本缓存 TTL | 仅测试 | app/server/lib/UpdateManager.ts:28 |
| `GRIST_TEST_UPDATE_DOCKER_HUB_URL` | 测试镜像地址 | 仅测试 | app/server/lib/UpdateManager.ts:21 |
| `GRIST_TEST_UPDATE_ERROR_TTL` | 测试错误缓存 TTL | 仅测试 | app/server/lib/UpdateManager.ts:30 |
| `GRIST_TEST_UPDATE_REQUEST_TIMEOUT` | 测试请求超时 | 仅测试 | app/server/lib/UpdateManager.ts:24 |
| `GRIST_TEST_UPDATE_RETRY_TIMEOUT` | 测试重试间隔 | 仅测试 | app/server/lib/UpdateManager.ts:26 |
| `GRIST_TEST_VERSION_CHECK_URL` | 测试版本检查地址 | 仅测试 | app/server/updateChecker.ts:15 |

---

## 附录 A：只见于文档/测试文本、代码不读取的名字（82）

`GRIST_ACCESS_TOKEN_PREFIX` `GRIST_ACTIVATION` `GRIST_ACTIVATION_FILE` `GRIST_APP_ROOT` `GRIST_AZURE_CONTAINER` `GRIST_AZURE_PREFIX` `GRIST_CHECK_ACTIVATION_INTERVAL` `GRIST_COM_PROVIDER_KEY` `GRIST_CONNECT_ENDPOINT` `GRIST_CONNECT_LOGOUT_URL` `GRIST_CONNECT_PROVIDER_KEY` `GRIST_CONNECT_SECRET` `GRIST_CONNECT_URL` `GRIST_CONSTANTS` `GRIST_CONTACT_SUPPORT_URL` `GRIST_DELIVERY_LOG_MAX_ENTRIES` `GRIST_DELIVERY_LOG_TTL_SECONDS` `GRIST_DOCS_` `GRIST_DOCS_MINIO_` `GRIST_DOCS_MINIO_ACCESS_KEY` `GRIST_DOCS_MINIO_BUCKET` `GRIST_DOCS_MINIO_BUCKET_REGION` `GRIST_DOCS_MINIO_ENDPOINT` `GRIST_DOCS_MINIO_PORT` `GRIST_DOCS_MINIO_PREFIX` `GRIST_DOCS_MINIO_SECRET_KEY` `GRIST_DOCS_MINIO_USE_SSL` `GRIST_DOCS_S3_` `GRIST_DOCS_S3_ACCESS_KEY` `GRIST_DOCS_S3_BUCKET` `GRIST_DOCS_S3_BUCKET_REGION` `GRIST_DOCS_S3_ENDPOINT` `GRIST_DOCS_S3_PORT` `GRIST_DOCS_S3_PREFIX` `GRIST_DOCS_S3_SECRET_KEY` `GRIST_DOCS_S3_USE_SSL` `GRIST_DOC_PATH` `GRIST_DOC_SQL` `GRIST_DOC_WITH_TABLE1_SQL` `GRIST_EDITION` `GRIST_ENABLE_OIDC_DCR` `GRIST_ENABLE_OIDC_SERVER` `GRIST_GETGRISTCOM_KEY` `GRIST_HELP_CENTER` `GRIST_HELP_US_IMPROVE_SURVEY_URL` `GRIST_HEX` `GRIST_HOSTED_VERSION` `GRIST_IMAGE` `GRIST_INSTALL_ADMIN_ORG` `GRIST_INSTALL_ADMIN_ORG_CACHE_TTL_MS` `GRIST_KEY` `GRIST_NODEMAILER_CONFIG` `GRIST_NODEMAILER_SENDER` `GRIST_NOTIFICATION_ROW_CHANGE_FIRST_DELAY_MS` `GRIST_NOTIFICATION_ROW_CHANGE_THROTTLE_MS` `GRIST_NOTIFIER` `GRIST_OAUTH2_CLIENTS_OVERRIDES` `GRIST_OIDC_` `GRIST_OIDC_CIMD_ALLOWED_HOSTS` `GRIST_OIDC_DCR_RATE_LIMIT` `GRIST_OIDC_SERVER_COOKIES_PREFIX` `GRIST_ONBOARDING_VIDEO_ID` `GRIST_PROMCLIENT_PORT` `GRIST_PROXIED_HEADER` `GRIST_REFRESH_TOKEN_PREFIX` `GRIST_SAML_` `GRIST_SANDBOX2` `GRIST_SANDBOX3` `GRIST_SERVE_PLUGINS_PORT` `GRIST_SITE` `GRIST_SKIP_EXT_AUTOSETUP` `GRIST_SMTP_TEMPLATES_DIR` `GRIST_SNAPSHOT_TIMEBUCKET_CAP` `GRIST_STRIPE_FAMILY` `GRIST_TERMS_OF_SERVICE_URL` `GRIST_TEST_ASSISTANT_VERSION` `GRIST_TEST_FORCE_LIGHT_MODE` `GRIST_TEST_INHERITED_MARKER` `GRIST_TEST_OWN_MARKER` `GRIST_THEME_PREFIX` `GRIST_UPDATE_DOCKER_URL` `GRIST_WEBINARS_URL`

## 附录 B：被排除的非环境变量（从 grep 结果里剔除）

`GRIST_CONSTANTS` `GRIST_TYPES` `GRIST_SANDBOX2` `GRIST_SANDBOX3` `GRIST_TMP` `GRIST_DOC_SQL` `GRIST_DOC_WITH_TABLE1_SQL` `GRIST_OIDC_` `GRIST_DOCS_MINIO_` `GRIST_DOCS_S3_` `APP_SCOPE` `REDIS_TESTS` `REDIS_TESTS_DISABLED` `TYPEORM_CONNECTION` `TYPEORM_EXTRA_DRAFT` `GVISOR_AVAILABLE` `GVISOR_RECOMMENDED`
这些是常量名、字符串片段或测试夹具名，不读环境。

存储相关没有 `STORAGE_*` 环境变量；文件存储用 `GRIST_FS_STORAGE_DIR`，其余见 ③ 组。

## 附录 C：本机已设、但不属于 Grist 命名的项

| 变量 | 用途 | 状态 | 位置 |
|---|---|---|---|
| `MCP_RESOURCE_URL` | MCP bridge 对外资源地址（OAuth 元数据用） | 已设 | apps/mcp-bridge/src/server.ts:14 |
| `GRIST_MCP_ENABLED` | 打开 Grist 内建 MCP 端点 | 默认 | app/server/lib/FlexServer.ts:3108 |
| `TZ` | 容器时区（日志与时间显示） | 已设 | 系统环境，非 Grist 代码 |
| `NODE_ENV` | Node 运行模式（production 影响若干默认值） | 已设 | Node 运行时 |
| `NODE_OPTIONS` | Node 启动参数 | 已设 | Node 运行时 |
| `PATH` | 镜像内可执行路径 | 已设 | 系统环境 |
