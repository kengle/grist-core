import { FullUser } from "app/common/LoginSessionAPI";
import { IOAuthValidator } from "app/server/lib/IOAuthValidator";
import { AuthCredential } from "app/server/lib/AuthCredential";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import log from "app/server/lib/log";

import { createPublicKey, KeyObject } from "crypto";
import { IncomingMessage } from "http";

import * as jwt from "jsonwebtoken";

import type { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import type { DocAuthResult, HomeDBDocAuth } from "app/gen-server/lib/homedb/Interfaces";
import type { GristServer } from "app/server/lib/GristServer";
import type { Request } from "express";

/**
 * Options read from the environment. All of jwksUrl, issuer and audience must be
 * present for the validator to be constructed at all.
 */
export interface OidcValidatorOptions {
  jwksUrl: string;
  issuer: string;
  audience: string;
  emailClaim: string;
}

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  use?: string;
  alg?: string;
}

/** How long to trust a fetched JWKS document. */
const JWKS_TTL_MS = 5 * 60 * 1000;

/** Be lenient about clock skew between Grist and the identity provider. */
const CLOCK_TOLERANCE_SECONDS = 5;

/**
 * Reads GRIST_OIDC_* from the environment, returning undefined unless the validator
 * is fully configured. An unconfigured server therefore behaves exactly as before:
 * getOAuthValidator() returns undefined and only cookies / API keys authenticate.
 */
export function readOidcValidatorOptions(
  env: NodeJS.ProcessEnv = process.env,
): OidcValidatorOptions | undefined {
  const jwksUrl = env.GRIST_OIDC_JWKS_URL;
  const issuer = env.GRIST_OIDC_ISSUER;
  const audience = env.GRIST_OIDC_AUDIENCE;
  if (!jwksUrl || !issuer || !audience) { return undefined; }
  return {
    jwksUrl,
    issuer,
    audience,
    emailClaim: env.GRIST_OIDC_EMAIL_CLAIM || "email",
  };
}

/**
 * Builds the validator for a server, or undefined when GRIST_OIDC_* is not configured.
 */
export function createOidcValidator(gristServer: GristServer): IOAuthValidator | undefined {
  const options = readOidcValidatorOptions();
  if (!options) { return undefined; }
  return new OidcValidator(options, gristServer.getHomeDBManager());
}

/**
 * A credential obtained from an identity provider JWT. It carries the Grist user
 * matched by email, and behaves like that user for both home and document requests.
 */
export class OidcCredential implements AuthCredential {
  constructor(
    public readonly identifiedUser: FullUser,
    private readonly _email: string,
  ) {}

  public scope(req: Request) {
    return { userId: this.identifiedUser.id };
  }

  public async docAuth(
    mreq: RequestWithLogin, dbManager: HomeDBDocAuth, urlId: string,
  ): Promise<DocAuthResult> {
    return dbManager.getDocAuthCached({
      urlId, userId: this.identifiedUser.id, org: mreq.org,
    });
  }

  public permissionMask() { return undefined; }

  public get email() { return this._email; }
}

/**
 * Validates RS256 JWTs issued by an external identity provider (e.g. Authelia),
 * using its JWKS document. A token is accepted only when its signature, issuer,
 * audience and expiry all check out, and when its email claim matches an existing
 * Grist user. No account is ever created here.
 */
export class OidcValidator implements IOAuthValidator {
  private _keys = new Map<string, KeyObject>();
  private _keysFetchedAt = 0;
  private _fetching: Promise<void> | undefined;

  constructor(
    private readonly _options: OidcValidatorOptions,
    private readonly _dbManager: HomeDBManager,
  ) {}

  /**
   * Returns a credential for the request's bearer token, or undefined when the
   * request has no usable token, or the token is invalid, or its user is unknown.
   * Failures never throw: the request simply falls through to the other auth paths.
   */
  public async getCredential(req: IncomingMessage): Promise<AuthCredential | undefined> {
    const token = extractBearerToken(req);
    if (!token) { return undefined; }

    let payload: Record<string, unknown>;
    try {
      payload = await this._verify(token);
    } catch (e) {
      log.debug("OidcValidator: rejected token: %s", (e as Error).message);
      return undefined;
    }

    const email = payload[this._options.emailClaim];
    if (typeof email !== "string" || !email) {
      log.debug("OidcValidator: token has no %s claim", this._options.emailClaim);
      return undefined;
    }

    const user = await this._dbManager.getExistingUserByLogin(email);
    if (!user) {
      // Deliberately does not create an account. Note the email, never the token.
      log.warn("OidcValidator: no Grist user for email %s", email);
      return undefined;
    }
    if (user.disabledAt) {
      log.warn("OidcValidator: user %s is disabled", email);
      return undefined;
    }
    return new OidcCredential(this._dbManager.makeFullUser(user), email);
  }

  private async _verify(token: string): Promise<Record<string, unknown>> {
    const decoded = jwt.decode(token, { complete: true }) as { header?: { kid?: string } } | null;
    const kid = decoded?.header?.kid;
    const key = await this._getKey(kid);
    const payload = jwt.verify(token, key.export({ type: "spki", format: "pem" }) as string, {
      algorithms: ["RS256"],
      issuer: this._options.issuer,
      audience: this._options.audience,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    if (typeof payload !== "object" || payload === null) { throw new Error("bad payload"); }
    return payload as Record<string, unknown>;
  }

  /**
   * Returns the signing key for a kid, refreshing the JWKS document when the key is
   * unknown or the cached copy is old. Concurrent refreshes share one fetch.
   */
  private async _getKey(kid?: string): Promise<KeyObject> {
    const fresh = Date.now() - this._keysFetchedAt < JWKS_TTL_MS;
    if (!fresh || (kid !== undefined && !this._keys.has(kid))) {
      await this._refreshKeys();
    }
    if (kid !== undefined) {
      const key = this._keys.get(kid);
      if (!key) { throw new Error(`unknown key id ${kid}`); }
      return key;
    }
    if (this._keys.size !== 1) { throw new Error("token has no key id"); }
    return this._keys.values().next().value!;
  }

  private async _refreshKeys(): Promise<void> {
    if (this._fetching) { return await this._fetching; }
    this._fetching = (async () => {
      try {
        const resp = await fetch(this._options.jwksUrl);
        if (!resp.ok) { throw new Error(`JWKS fetch failed: ${resp.status}`); }
        const body = await resp.json() as { keys?: Jwk[] };
        const keys = new Map<string, KeyObject>();
        for (const jwk of body.keys ?? []) {
          if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) { continue; }
          if (jwk.use !== undefined && jwk.use !== "sig") { continue; }
          if (jwk.alg !== undefined && jwk.alg !== "RS256") { continue; }
          const key = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" } as any);
          keys.set(jwk.kid ?? "", key);
        }
        if (keys.size === 0) { throw new Error("JWKS has no usable RSA signing key"); }
        this._keys = keys;
        this._keysFetchedAt = Date.now();
      } finally {
        this._fetching = undefined;
      }
    })();
    return await this._fetching;
  }
}

/** Extracts the token from an "Authorization: Bearer <token>" header, or undefined. */
function extractBearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers?.authorization;
  if (!header) { return undefined; }
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") { return undefined; }
  return parts[1] || undefined;
}
