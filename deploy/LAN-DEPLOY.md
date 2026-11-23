# 局域网部署（Grist + Caddy + Authelia）

两个方案并列：**A 自有域名 + 私有 IP**（推荐）、**B 无域名自签**。都不接 LDAP、不做 SSO、不建内网 DNS 服务器。
## 1. 前提

- 一台常开机器，固定局域网 IP（或 DHCP 保留），员工用浏览器访问。
- **只暴露一个端口 443**；Grist 的 8484 与 Authelia 的 9091 都不发布。
- 不做的部分：不接 LDAP/AD、不做 SSO/OIDC、不引入内网 DNS 服务器（解析靠公网 DNS 的私有 A 记录或客户端 hosts）。
## 2. 方案 A：自有域名 + 私有 IP 的 A 记录（推荐）

**DNS**：在你有权管理的公网域名上加 `A grist.example.com → 192.168.1.10`（私网地址）。
外网解析得到私网 IP，连不上；局域网内能解析即可用。无需对外开 80/443。

**证书**：用 DNS-01 签发，不要求 80/443 对外。

- 方式 1（自动续期）：`xcaddy build --with github.com/caddy-dns/cloudflare`，Caddyfile 内 `tls { dns cloudflare {env.CF_API_TOKEN} }`。
- 方式 2（外部签发）：`acme.sh --issue --dns dns_cf -d grist.example.com`，再
  `acme.sh --install-cert -d grist.example.com --fullchain-file /srv/certs/fullchain.pem --key-file /srv/certs/key.pem --reloadcmd "docker compose -f /srv/grist-auth/compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile"`，
  Caddyfile 内 `tls /certs/fullchain.pem /certs/key.pem`，并挂载 `-v /srv/certs:/certs:ro`。

**改三个值**（方案 A 必须同步改名）：
- Grist env `APP_HOME_URL=https://grist.example.com/`
- Authelia `session.cookies[].authelia_url: 'https://grist.example.com/authelia'`
- Authelia cookie `domain: 'grist.example.com'`（`default_redirection_url` 同步）

**续期**：方式 1 由 Caddy 自动；方式 2 靠 acme.sh 的 cron（`--reloadcmd` 已含）。
续期后只需 **reload Caddy**（`caddy reload`），不必停服、不必重启 Grist。
## 3. 方案 B：无域名，Caddy 自签 + 分发根证书

**主机名**：用 `grist.lan`（或直接用 IP）。`tls internal` 要显式列出所有访问名；用 IP 访问必须让 IP 进 SAN：

```
https://grist.lan, https://192.168.1.10 {
	tls internal
	...
}
```

**导出根证书**：
```bash
docker cp grist-auth-caddy-1:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

**分发（每台客户端一次）**：
- macOS：双击 → 钥匙串“系统” → 显示简介 → 信任 → **始终信任**；或 `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain caddy-root.crt`。
- Windows：双击 → 安装证书 → **本地计算机** → “**受信任的根证书颁发机构**”。
- iOS：把 .crt 发到设备 → 设置 → 通用 → VPN 与设备管理 → 安装 → 通用 → 关于本机 → 证书信任设置 → 完全信任。
- Android：设置 → 安全 → 加密与凭据 → 安装证书 → **CA 证书**。

**客户端 hosts**（无内网 DNS 时的替代）：加一行 `192.168.1.10 grist.lan`；或用 DHCP 保留 + 路由器本地 DNS 记录。

**必须保留 `caddy-data` 卷**：删了会换 CA，已分发的根证书全部失效。
## 4. 共同改动

| 项 | 值/动作 | 说明 |
|---|---|---|
| `APP_HOME_URL` | `https://<你的域名或IP>/` | 对外基址，浏览器跳转用 |
| `APP_HOME_INTERNAL_URL` | `http://127.0.0.1:8484/` | **不变**，内部自调用（fork 必需） |
| `GRIST_FORWARD_AUTH_HEADER` | `Remote-Email` | Authelia 注入的邮箱头 |
| `GRIST_FORWARD_AUTH_LOGOUT_PATH` | `/authelia/logout` | Grist 登出跳 Authelia 登出页 |
| Authelia `authelia_url` | `https://<host>/authelia` | 必须 https，否则 fatal |
| Authelia cookie `domain` / `default_redirection_url` | `<host>` / `https://<host>/` | 域名需含点；两者不能相同 |
| `GRIST_DEFAULT_EMAIL` | **删除** | 有 forward auth 时不需要；它会固定一个身份，易误判 |
## 5. 加用户流程

```bash
# 1) 生成密码（不回显）
openssl rand -base64 12 > /tmp/pw && chmod 600 /tmp/pw

# 2) 生成 argon2 哈希
docker run --rm authelia/authelia:latest authelia crypto hash generate argon2 --password "$(cat /tmp/pw)"

# 3) 写入 authelia/users_database.yml（disabled/displayname/password/email/groups）

# 4) 重载 Authelia
docker compose -f ~/workshop/vibe/xx/grist-auth/compose.yml restart authelia

# 5) 在 Grist 里按邮箱邀请：站点右上角「管理团队」→ 输入邮箱 →「邀请新成员」→ 选角色 →「确认」
```
CE 不发邀请邮件；Grist 要求邮箱合法（需 `域.后缀`）。
## 6. 验证清单

```bash
curl -sI https://<host>/ | head -3                 # 302 → /authelia/?rd=...
curl -s -H "Authorization: Bearer <KEY>" https://<host>/api/orgs  # 200 + org 列表
curl -s https://<host>/api/orgs                    # 200 + []
lsof -nP -iTCP:8484 -sTCP:LISTEN ; lsof -nP -iTCP:9091 -sTCP:LISTEN   # 都应为空
```
浏览器打开无证书警告；未登录 302；登录后显示 `@<用户名>` 与邮箱；打开文档 → 分享 → 「在副本上工作」成功。
## 7. 对比表

| 维度 | A 自有域名 + DNS-01 | B 自签 + 分发根证书 |
|---|---|---|
| 需要域名 | 需要（可用你自己的公网域名） | 不需要 |
| 员工要手动装东西 | 不需要 | 需要：装根证书（+可能改 hosts） |
| 续期 | Caddy 自动 或 acme.sh cron | 不用续期（CA 长期有效） |
| 主要故障点 | DNS-01 API token、私网 A 记录写错 | CA 更换、客户端未信任、IP 不在 SAN |
| 适合 | 员工多、要长期维护 | 小团队、临时、无域名 |
## 8. 端口与防火墙

- 宿主只开 **443**（compose 里 `- '443:443'`，或 `443:8080` 端口映射）。
- 不发布 8484、9091：`docker run` 不加 `-p`，Authelia 不加 `ports`。
- 主机防火墙只放行 443/tcp（macOS 用“防火墙选项”，Linux 用 `ufw allow 443/tcp`）。
## 9. 撤销

```bash
cd ~/workshop/vibe/xx/grist-auth && docker compose down -v   # 停服务并删 caddy-data 卷（CA 一并删）
docker rm -f grist-local
sudo security remove-trusted-cert -d /Library/Keychains/System.keychain   # macOS；Windows 用 certlm.msc 删
rm -rf ~/workshop/vibe/xx/grist-auth      # 含 authelia/.secrets
# rm -rf ~/workshop/vibe/xx/grist/data    # 数据卷；会删所有文档
```
