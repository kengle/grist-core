import { OidcValidator, OidcValidatorOptions, readOidcValidatorOptions } from "app/server/lib/OidcValidator";
import { EnvironmentSnapshot } from "test/server/testUtils";

import { assert } from "chai";
import { generateKeyPairSync, KeyObject } from "crypto";

import * as jwt from "jsonwebtoken";

import type { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import type { IncomingMessage } from "http";

const issuer = "https://idp.example.com";
const audience = "grist-mcp";
const kid = "test-key-1";

describe("OidcValidator", function() {
  let privateKey: string;
  let publicKey: KeyObject;
  let options: OidcValidatorOptions;
  let originalFetch: typeof fetch;

  before(function() {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    publicKey = pair.publicKey;
  });

  beforeEach(function() {
    const jwk = publicKey.export({ format: "jwk" }) as { kty: string, n: string, e: string };
    originalFetch = global.fetch;
    // Serve a JWKS document with a single RS256 signing key.
    global.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        keys: [{ ...jwk, kid, use: "sig", alg: "RS256" }],
      }),
    })) as unknown as typeof fetch;
    options = { jwksUrl: "https://idp.example.com/jwks.json", issuer, audience, emailClaim: "email" };
  });

  afterEach(function() {
    global.fetch = originalFetch;
  });

  function makeRequest(authorization?: string): IncomingMessage {
    return { headers: authorization ? { authorization } : {} } as unknown as IncomingMessage;
  }

  function sign(payload: object, opts: jwt.SignOptions = {}): string {
    return jwt.sign(payload, privateKey, {
      algorithm: "RS256", keyid: kid, issuer, audience, expiresIn: "5m", ...opts,
    } as jwt.SignOptions);
  }

  /** A fake home DB that knows one user. */
  function makeDbManager(knownEmails: string[] = ["ken@example.com"]) {
    const users = new Map(knownEmails.map((email, i) => [email, { id: 100 + i, loginEmail: email }]));
    return {
      getExistingUserByLogin: async (email: string) => users.get(email),
      makeFullUser: (user: any) => ({ id: user.id, email: user.loginEmail, name: "ken" }),
    } as unknown as HomeDBManager;
  }

  it("accepts a correctly signed token for a known user", async function() {
    const validator = new OidcValidator(options, makeDbManager());
    const token = sign({ email: "ken@example.com", sub: "ken" });
    const credential = await validator.getCredential(makeRequest(`Bearer ${token}`));
    assert.isDefined(credential);
    assert.equal(credential!.identifiedUser.id, 100);
    // The credential contributes only the userId to the request scope.
    assert.deepEqual(credential!.scope({} as any), { userId: 100 });
    assert.isUndefined(credential!.permissionMask());
  });

  it("rejects a token signed by a different key", async function() {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
      .export({ type: "pkcs8", format: "pem" }) as string;
    const token = jwt.sign({ email: "ken@example.com" }, other,
      { algorithm: "RS256", keyid: kid, issuer, audience, expiresIn: "5m" } as jwt.SignOptions);
    const validator = new OidcValidator(options, makeDbManager());
    assert.isUndefined(await validator.getCredential(makeRequest(`Bearer ${token}`)));
  });

  it("rejects an expired token", async function() {
    const token = sign({ email: "ken@example.com" }, { expiresIn: "-1h" });
    const validator = new OidcValidator(options, makeDbManager());
    assert.isUndefined(await validator.getCredential(makeRequest(`Bearer ${token}`)));
  });

  it("rejects a token with the wrong issuer", async function() {
    const token = sign({ email: "ken@example.com" }, { issuer: "https://evil.example.com" });
    const validator = new OidcValidator(options, makeDbManager());
    assert.isUndefined(await validator.getCredential(makeRequest(`Bearer ${token}`)));
  });

  it("rejects a token with the wrong audience", async function() {
    const token = sign({ email: "ken@example.com" }, { audience: "some-other-client" });
    const validator = new OidcValidator(options, makeDbManager());
    assert.isUndefined(await validator.getCredential(makeRequest(`Bearer ${token}`)));
  });

  it("rejects a token whose email has no Grist user, without creating one", async function() {
    const dbManager = makeDbManager();
    const validator = new OidcValidator(options, dbManager);
    const token = sign({ email: "nobody@example.com" });
    assert.isUndefined(await validator.getCredential(makeRequest(`Bearer ${token}`)));
  });

  it("ignores requests without a bearer token", async function() {
    const validator = new OidcValidator(options, makeDbManager());
    assert.isUndefined(await validator.getCredential(makeRequest()));
    assert.isUndefined(await validator.getCredential(makeRequest("Basic dXNlcjpwYXNz")));
  });

  it("is disabled unless the environment variables are all present", function() {
    const oldEnv = new EnvironmentSnapshot();
    try {
      delete process.env.GRIST_OIDC_JWKS_URL;
      delete process.env.GRIST_OIDC_ISSUER;
      delete process.env.GRIST_OIDC_AUDIENCE;
      assert.isUndefined(readOidcValidatorOptions(process.env));

      process.env.GRIST_OIDC_JWKS_URL = "https://idp.example.com/jwks.json";
      process.env.GRIST_OIDC_ISSUER = issuer;
      assert.isUndefined(readOidcValidatorOptions(process.env));

      process.env.GRIST_OIDC_AUDIENCE = audience;
      const read = readOidcValidatorOptions(process.env);
      assert.isDefined(read);
      assert.equal(read!.emailClaim, "email");    // default claim name
    } finally {
      oldEnv.restore();
    }
  });
});
