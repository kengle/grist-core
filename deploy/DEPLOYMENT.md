# Grist + Authelia + Caddy 部署说明

唯一入口 `https://grist.localhost:8080`；Grist 容器不发布端口。凭证只在
`~/workshop/vibe/xx/grist-auth/authelia/.secrets/`，本文件不含任何密钥值。
## 1. 拓扑

```
浏览器 → https://grist.localhost:8080 (Caddy, tls internal)
         ├─ /authelia* → authelia:9091      （免鉴权，登录页）
         ├─ /api/*     → grist-local:8484   （无 forward_auth，key 或 Grist cookie）
         └─ 其它        → forward_auth → Authelia → grist-local:8484
内部自调用 → APP_HOME_INTERNAL_URL=http://127.0.0.1:8484/（容器内，不出版面）
```
## 2. 文件清单（`~/workshop/vibe/xx/grist-auth/`）

| 文件 | 用途 |
|---|---|
| `compose.yml` | `authelia` 与 `caddy` 两服务、网络、端口、卷 |
| `Caddyfile` | TLS + 三段路由（见第 4 节） |
| `authelia/configuration.yml` | Authelia 主配置 |
| `authelia/users_database.yml` | 用户库（名字、邮箱、argon2 哈希、组） |
| `authelia/users_database.yml.bak` | 加 `mm` 前的备份 |
| `authelia/db.sqlite3` | Authelia 存储（session 等），自动生成 |
| `authelia/notifications.txt` | filesystem notifier 输出，自动生成 |
| `authelia/.secrets/` | `session_secret`（session 加密）、`storage_key`（storage encryption_key）、`jwt_secret`（reset_password）、`user_password`（ken）、`mm_password`（mm） |

Grist 数据卷：`/Users/ken/workshop/vibe/xx/grist/data:/persist`（`home.sqlite3`、`docs/`）。
## 3. `grist-local` 的完整 docker run

```bash
docker run -d --name grist-local --restart unless-stopped \
  --network grist-auth_default \
  -v /Users/ken/workshop/vibe/xx/grist/data:/persist \
  -e GRIST_SESSION_SECRET="$(cat ~/workshop/vibe/xx/grist-auth/authelia/.secrets/session_secret)" \
  -e GRIST_DEFAULT_EMAIL=ken@local -e GRIST_SANDBOX_FLAVOR=unsandboxed \
  -e GRIST_FORWARD_AUTH_HEADER=Remote-Email \
  -e GRIST_FORWARD_AUTH_LOGOUT_PATH=/authelia/logout \
  -e APP_HOME_URL=https://grist.localhost:8080/ \
  -e APP_HOME_INTERNAL_URL=http://127.0.0.1:8484/ \
  -e GRIST_TEMPLATE_ORG=templates -e GRIST_ORG_IN_PATH=true \
  -e GRIST_SERVE_SAME_ORIGIN=true \
  gristlabs/grist:latest
```

- `gristlabs/grist:latest`；默认 CMD `./sandbox/run.sh`、ENTRYPOINT `./sandbox/docker_entrypoint.sh`；**无 `-p`**，8484 只在 `grist-auth_default` 内可达。
- 上面 10 条为自加；其余 17 条（`PATH`、`TZ`、`GRIST_IN_SERVICE`、`GRIST_DATA_DIR`、`GRIST_INST_DIR`、`TYPEORM_DATABASE`、`GVISOR_FLAGS` 等）为镜像自带，保持原样。
## 4. Caddyfile 全文

```
https://grist.localhost:8080 {
	tls internal

	# Authelia portal: must stay unauthenticated, or login loops.
	handle /authelia* {
		reverse_proxy authelia:9091
	}

	# Scripts and agents: API key goes straight to Grist, no forward_auth.
	@api path /api/*
	handle @api {
		reverse_proxy grist-local:8484 {
			header_up Host {http.request.hostport}
			header_up X-Forwarded-Proto {scheme}
			header_up X-Forwarded-Host {http.request.hostport}
		}
	}

	# Everything else: browser paths behind Authelia.
	handle {
		forward_auth authelia:9091 {
			uri /authelia/api/authz/forward-auth
			copy_headers Remote-User Remote-Email Remote-Groups
		}
		reverse_proxy grist-local:8484 {
			header_up Host {http.request.hostport}
			header_up X-Forwarded-Proto {scheme}
			header_up X-Forwarded-Host {http.request.hostport}
		}
	}
}
```

- `/authelia*` 最前且免鉴权：登录页不能被 `forward_auth` 保护，否则死循环。
- `/api/*` 放行：脚本用 `Authorization: Bearer <key>`；浏览器仍靠 Grist session cookie。`header_up Host` 用 `{http.request.hostport}`，因 Grist `getOriginUrl()` 直接读 Host，丢端口会跳坏。
## 5. Authelia 配置要点
- 用户：`ken`/`ken@local`、`mm`/`mm@local.test`，均属 `admins`；file 后端 + `argon2`。
- `access_control.default_policy: 'one_factor'`，无自定义规则，**未启用 2FA**（`totp` 只设 `issuer`）。
- `session`：`grist_session`、`expiration: '1h'`、cookie `domain: grist.localhost`、`authelia_url: https://grist.localhost:8080/authelia`。
- `storage.local.path: /config/db.sqlite3`；`server.address: tcp://0.0.0.0:9091/authelia`（子路径）；`notifier.filesystem` 写文件不发邮件；`reset_password.jwt_secret` 取自 `.secrets/jwt_secret`。
## 6. 从零重建

```bash
# 1) 目录与密钥（只生成，不回显）
D=~/workshop/vibe/xx/grist-auth/authelia
mkdir -p $D/.secrets && chmod 700 $D/.secrets && cd $D
openssl rand -hex 32 > .secrets/session_secret   # session.secret
openssl rand -hex 24 > .secrets/storage_key      # storage.encryption_key
openssl rand -hex 32 > .secrets/jwt_secret       # reset_password.jwt_secret
openssl rand -base64 12 > .secrets/user_password # ken 的密码
chmod 600 .secrets/*

# 2) 密码哈希（每人一条，输出粘进 users_database.yml）
docker run --rm authelia/authelia:latest authelia crypto hash generate argon2 --password "$(cat .secrets/user_password)"

# 3) 写 configuration.yml、users_database.yml（结构见本节末）
# 4) 启动 Caddy + Authelia
cd ~/workshop/vibe/xx/grist-auth && docker compose up -d
# 5) 建 grist-local（第 3 节命令）；若先建于默认 bridge 再接入网络
docker network connect grist-auth_default grist-local
# 6) 信任 Caddy 内部 CA（否则浏览器与 curl 不认）
docker cp grist-auth-caddy-1:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt
security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db /tmp/caddy-root.crt
# 7) 验证（第 7 节）
```

```yaml
users:
  ken:
    disabled: false
    displayname: 'Ken'
    password: '<第 2 步的 argon2 输出>'
    email: 'ken@local'
    groups: ['admins']
```
## 7. 验证清单
```bash
curl -sI https://grist.localhost:8080/ | head -3   # 302 → /authelia/?rd=...
curl -s -H "Authorization: Bearer <KEY>" https://grist.localhost:8080/api/orgs  # 200 + org 列表
curl -s https://grist.localhost:8080/api/orgs     # 200 + []
lsof -nP -iTCP:8484 -sTCP:LISTEN                  # 空
```
浏览器登录后进 Grist 首页；打开文档 → 分享图标 → 「在副本上工作」应成功（URL 形如 `/o/<org>/doc/<id>~<forkId>~<userId>`）。
## 8. 已知问题与坑
1. **必须 https + 主机名**：Authelia `IsURISecure` 只认 `https/wss`；TLS 要 SNI，裸 IP 握手失败。
2. **缺 `APP_HOME_INTERNAL_URL` → fork 报 `ENOTFOUND grist.localhost`**：fork 由 doc worker 内部 fetch（`ActiveDoc.ts:1954`），需 `http://127.0.0.1:8484/`。
3. **`/authelia*` 不排最前 → 登录死循环**：登录页被自己的 `forward_auth` 拦住。
4. **Caddy CA 会随容器重建而变**：已加命名卷 `caddy-data:/data`；若仍换 CA，重做第 6 节第 6 步。
5. **模板 org 不对全站可见**：需逐个加 `viewers`；org 级 `everyone@` 被禁（`UsersManager.ts:845-855`）。
6. **删文档用 `POST /api/docs/<id>/remove`**（回收站）；`DELETE` 是硬删，行会消失。
7. **未保存的 fork 删不掉**：`remove` 报 `403 No view access`，只能留在库里。
8. **浏览器信任依赖登录钥匙串的 Caddy CA**：撤销 `security remove-trusted-cert -d /tmp/caddy-root.crt`。
## 9. 当前数据现状
- org：`2 Personal`(docs-5)、`9 Templates`(templates)、`4 maimang`。
- 模板文档：`oY5YmsCofsxtB4zNckUXff`（`Digital Sales CRM`，workspace 12，已 pin）。
- 成员：maimang — `ken@local` owners、`mm@local.test` editors、`kkk@kk.com` viewers、`mail@qiu.fm` editors；Templates — `ken@local` owners、`mm@local.test` viewers。
- 回收站：`pGpmKWeewsdUms5tfLuAJW`、`tJD8PR4gVBdF2MksxdQWpH`、`2bxWZdsgwxkuhDy5XTvH8N`、`rG2NidqS6KdLRxxBmSY8TB`(ws)、`3qtY8KeVYHb8ig9SH8C4rC`(Untitled document)；删不掉的未保存 fork：`kxEnzZbVb9UBzqaPm6M8mL`、`rk8WWcrG46fRX7PPVXdmHV`、`xkBFMzkSyG6nChk6ufvK58`。
- 幽灵账号：`mm@local`（user id 9，无权限，`logins` 有行）。
## 10. 撤销

```bash
cd ~/workshop/vibe/xx/grist-auth && docker compose down -v   # 停并删 caddy-data 卷
docker rm -f grist-local
security remove-trusted-cert -d /tmp/caddy-root.crt
rm -rf ~/workshop/vibe/xx/grist-auth      # 含 authelia/.secrets
# rm -rf ~/workshop/vibe/xx/grist/data    # 数据卷；会删所有文档
```

## OAuth 令牌（外部客户端用）

外部客户端可以拿身份提供方（本例 Authelia）签发的 **JWT** 直接调 Grist REST API，
不需要 Grist 自己的 API key。Grist 侧只认两类 JWT：**id_token** 与 **JWT 格式的 access_token**。

客户端侧（Authelia 的 `clients` 与 `claims_policies`）：

```yaml
identity_providers:
  oidc:
    claims_policies:
      grist:
        id_token:
          - 'email'
        access_token:
          - 'email'
    clients:
      - client_id: 'grist-mcp'
        claims_policy: 'grist'
        access_token_signed_response_alg: 'RS256'   # 让 access_token 成为 JWT
        audience:
          - 'grist-mcp'                             # access_token 的 aud
        requested_audience_mode: 'implicit'         # 不显式请求也授予该 aud
```

- 请求头：`Authorization: Bearer <access_token>`（或 `<id_token>`，两者都行）。
- access_token 的 header 形如 `{"alg":"RS256","kid":"<key id>","typ":"at+jwt"}`，claims 含
  `iss`、`aud`、`exp`、`email`、`sub`、`client_id`、`scp`。
- Grist 侧四个环境变量（缺一个就不启用，行为与原来一致）：
  `GRIST_OIDC_JWKS_URL`、`GRIST_OIDC_ISSUER`、`GRIST_OIDC_AUDIENCE`（= client_id）、
  `GRIST_OIDC_EMAIL_CLAIM`（默认 `email`）。
- `GRIST_OIDC_JWKS_URL` 建议指向容器内网地址（例 `http://authelia:9091/authelia/jwks.json`）：
  Grist 容器不信任 Caddy 的内部 CA；校验器会带 `Host` / `X-Forwarded-Proto` / `X-Forwarded-Host`
  头，使挂在子路径后的提供方能正确回应。
- 约定：token 的 email 在 Grist 里**查不到就拒绝（401），不自动建号**；`aud` 必须与本配置一致，
  `iss`、`exp` 同样校验；被判无效的 token 会落回后续鉴权链（API key / 会话 / 匿名）。

## MCP 桥

- 位置：`apps/mcp-bridge/`，与 Grist **同一个镜像、同一个容器**；`docker/entrypoint-two.sh` 起两个进程（任一退出即停另一个并以非零码退出），日志前缀 `[grist]` / `[mcp]`。
- 桥只监听容器内 `127.0.0.1:8765`（MCP 库在 `127.0.0.1:8766`），上游 `http://127.0.0.1:8484/api`；不发布端口。
- 工具 19 个：`list_orgs`、`list_workspaces`、`list_docs`、`get_doc`、`list_tables`、`describe_table`、`query_records`、`get_record`、`add_records`、`update_records`、`delete_records`、`apply_user_actions`、`create_doc`、`copy_doc`、`remove_doc`、`upload_attachment`、`list_webhooks`、`create_webhook`、`delete_webhook`。
- 身份：桥**只透传 `Authorization`**，不验签、不刷新、不存凭据；权限由 Grist 按 token 所属用户判定（OIDC token 请求在 `Authorizer.ts` 里以该用户执行，等同 API key）。
- Caddy：`/mcp*` 与 `/.well-known/oauth-protected-resource` 直通 `grist-local:8765`，**不经 Authelia**。
- Authelia 客户端 `grist-mcp` 要点：`token_endpoint_auth_method: client_secret_basic`（secret 用十六进制——base64 里的 `+` 会破坏 Basic 头）；`audience` 含 `https://grist.localhost:8080`；`requested_audience_mode: 'implicit'`；`claims_policies.<p>.access_token: ['email']`；`access_token_signed_response_alg: 'RS256'`；`grant_types` 含 `refresh_token`；`scopes` 含 `offline_access`；`consent_mode: 'pre-configured'`（首次授权仍需批准一次）。
- 令牌寿命（`identity_providers.oidc.lifespans`）：`access_token: '24h'`、`id_token: '24h'`、`refresh_token: '30d'`、**`authorize_code: '5m'`**（键名是 `authorize_code`，写成 `authorization_code` 会启动失败）。
- Grist 侧四个变量：`GRIST_OIDC_JWKS_URL=http://authelia:9091/authelia/jwks.json`（容器内网，容器不信任 Caddy 的 CA）、`GRIST_OIDC_ISSUER=https://grist.localhost:8080/authelia`、`GRIST_OIDC_AUDIENCE=https://grist.localhost:8080`、`GRIST_OIDC_EMAIL_CLAIM=email`。
- PiP 条目：`url: https://grist.localhost:8080/mcp`；`oauth.clientId: grist-mcp`；`oauth.clientSecret: "!cat /Users/ken/.pi-pocket/grist-mcp-secret"`；`oauth.authServerMetadataUrl: https://grist.localhost:8080/authelia/.well-known/openid-configuration`；`oauth.callbackPort: 9999`；`oauth.scope` 含 `offline_access`。
- 两条教训：
  1. **不要拿 PiP 的 refresh token 做手工刷新实验**——Authelia 会轮换，旧 token 立即作废，PiP 下次续期会 `invalid_grant`。
  2. `grist-local` 的环境变量现在在 `~/workshop/vibe/xx/grist-auth/grist.env`（权限 600、已 gitignore），由 compose 的 `env_file` 加载；**不要再手工 `docker run`**。

## LLDAP（目录服务，已接管 Authelia 登录）

- 服务 `lldap`（镜像 `lldap/lldap:v0.6.3`），与其它服务同网络；端口只绑回环：
  `127.0.0.1:3890`（LDAP）、`127.0.0.1:17170`（Web 管理端 + GraphQL）。
- 数据卷 `./lldap:/data`（`users.db` 是唯一权威数据，**必须进备份**）。
- 密钥与初始管理员密码在 `lldap.env`（600、已 gitignore）：`LLDAP_JWT_SECRET`、`LLDAP_LDAP_BASE_DN`、
  `LLDAP_LDAP_USER_PASS`、`KEN_TEMP_PASSWORD`、`MM_TEMP_PASSWORD`。
- base DN `dc=maimang,dc=local`；用户建在 `ou=people`，组在 `ou=groups`（`admins`、`users`，`ken` 属 `admins`）。
- 改密码：**从改文件改为网页**——打开 `http://127.0.0.1:17170` 用 `admin` 登录，在用户页设置；文件里的
  `KEN_TEMP_PASSWORD`／`MM_TEMP_PASSWORD` 只是首次设定用的临时值，可删除。
- 备份：`./lldap`（当前约 144 KB）与 `../data` 一起纳入备份计划。
- **已切换**：`authentication_backend` 用 `ldap`，bind 账号 `uid=svc-authelia,ou=people,dc=maimang,dc=local`，
  密码由环境变量 `AUTHELIA_AUTHENTICATION_BACKEND_LDAP_PASSWORD` 注入（存在 `lldap.env`，不进仓库）；
  `users_database.yml` 保留不删，回滚时把注释恢复即可。
- **身份迁移（本次做过一次）**：邮箱从 `@local` 换成 `@mai-mang.com` 时，改的是 `logins.email`，user id 不变；
  `aliases` 表是**文档 URL 别名**，不是邮箱别名，别用错表：
  ```sql
  UPDATE logins SET email='ken@mai-mang.com', display_email='ken@mai-mang.com' WHERE email='ken@local';
  UPDATE logins SET email='mm@mai-mang.com',  display_email='mm@mai-mang.com'  WHERE user_id=10;  -- mm 有 maimang 权限的那个用户
  ```
  回滚：还原 `home.sqlite3` 备份，或把两行 `UPDATE` 反向执行。

### 切换到 LLDAP 时要改哪几行（草案，未启用）

把 `deploy/authelia/configuration.yml` 的 `authentication_backend.file` 换成：

```yaml
authentication_backend:
  ldap:
    implementation: 'custom'                       # LLDAP 是标准 LDAP，不是 Active Directory
    address: 'ldap://lldap:3890'                   # 容器内服务名
    start_tls: false                               # 内网明文，端口不对外
    base_dn: 'dc=maimang,dc=local'
    additional_users_dn: 'ou=people'
    users_filter: '(&({username_attribute}={input})(objectClass=person))'
    additional_groups_dn: 'ou=groups'
    groups_filter: '(&(member={dn})(objectClass=groupOfNames))'
    group_search_mode: 'filter'
    user: 'uid=admin,ou=people,dc=maimang,dc=local'   # 服务账号，能枚举用户与组
    password: '<REPLACE_WITH_LLDAP_ADMIN_PASSWORD>'   # 取自 lldap.env 的 LLDAP_LDAP_USER_PASS
    attributes:
      username: 'uid'
      display_name: 'cn'
      mail: 'mail'
      member_of: 'memberOf'
```

改完后：`docker compose up -d authelia`，确认登录页能列出用户；`file` 后端与 `users_database.yml` 可暂时保留做回滚。
