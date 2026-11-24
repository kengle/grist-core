---
# Authelia as the OpenID Connect provider and the forward-auth portal for this deployment.
# Replace every <REPLACE_WITH_...> value; see README.md for how they are generated.
theme: 'auto'
server:
  # Mounted under a path; Caddy keeps the /authelia prefix when proxying.
  address: 'tcp://0.0.0.0:9091/authelia'

log:
  level: 'info'

totp:
  issuer: 'grist'

identity_validation:
  reset_password:
    jwt_secret: '__JWT_SECRET__'

authentication_backend:
  # Rollback to the file backend by restoring the block below and commenting out the ldap one.
  # file:
  #   path: '/config/users_database.yml'
  #   password:
  #     algorithm: 'argon2'
  ldap:
    implementation: 'custom'
    address: 'ldap://lldap:3890'
    start_tls: false
    base_dn: '__BASE_DN__'
    additional_users_dn: 'ou=people'
    users_filter: '(&({username_attribute}={input})(objectClass=person))'
    additional_groups_dn: 'ou=groups'
    groups_filter: '(&(member={dn})(objectClass=groupOfNames))'
    group_search_mode: 'filter'
    user: 'uid=svc-authelia,ou=people,__BASE_DN__'
    password: 'from-env'          # AUTHELIA_AUTHENTICATION_BACKEND_LDAP_PASSWORD
    attributes:
      username: 'uid'
      display_name: 'cn'
      mail: 'mail'
      member_of: 'memberOf'

access_control:
  default_policy: 'one_factor'

session:
  name: 'grist_session'
  secret: '__SESSION_SECRET__'
  expiration: '1h'
  cookies:
    - domain: '__GRIST_HOST__'
      authelia_url: 'https://__GRIST_HOST__:__GRIST_PORT__/authelia'
      default_redirection_url: 'https://__GRIST_HOST__:__GRIST_PORT__'

storage:
  encryption_key: '__STORAGE_KEY__'
  local:
    path: '/config/db.sqlite3'

notifier:
  filesystem:
    filename: '/config/notifications.txt'

identity_providers:
  oidc:
    # The key is authorize_code, NOT authorization_code; the latter stops startup.
    lifespans:
      access_token: '24h'
      id_token: '24h'
      refresh_token: '30d'
      authorize_code: '5m'
    hmac_secret: '__OIDC_HMAC_SECRET__'
    jwks:
      - key_id: 'grist-mcp'
        algorithm: 'RS256'
        use: 'sig'
        key: |
__OIDC_JWKS_KEY_PEM__
    # Grist verifies access tokens with these; every claim below must stay in place.
    claims_policies:
      grist:
        id_token:
          - 'email'
        access_token:
          - 'email'
    clients:
      - client_id: 'grist-mcp'
        client_name: 'Grist MCP'
        # Hex only: base64 may contain '+', which breaks the Basic auth header.
        client_secret: '__OIDC_CLIENT_SECRET__'
        public: false
        authorization_policy: 'one_factor'
        consent_mode: 'pre-configured'
        pre_configured_consent_duration: '1M'
        claims_policy: 'grist'
        token_endpoint_auth_method: 'client_secret_basic'
        access_token_signed_response_alg: 'RS256'
        audience:
          - 'grist-mcp'
          - 'https://__GRIST_HOST__:__GRIST_PORT__'
        requested_audience_mode: 'implicit'
        redirect_uris:
          - 'http://127.0.0.1:9999/callback'
        response_types:
          - 'code'
        grant_types:
          - 'authorization_code'
          - 'refresh_token'
        scopes:
          - 'openid'
          - 'email'
          - 'profile'
          - 'offline_access'
