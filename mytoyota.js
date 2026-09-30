"use strict";

/*
 * Minimal client for Toyota Connected Services Europe ("MyToyota").
 *
 * The protocol is not documented by Toyota. This is a port of the parts of
 * pytoyoda (https://github.com/pytoyoda/pytoyoda, MIT licensed) that are
 * needed to read vehicle status, translated from Python to Node.
 *
 * Login is a three step dance against Toyota's ForgeRock instance:
 *
 *   1. POST the authenticate URL repeatedly. It replies with a list of
 *      "callbacks" to fill in — username, then password, sometimes more —
 *      and each reply is posted straight back until a `tokenId` appears.
 *   2. GET the authorize URL carrying that tokenId as a cookie. It answers
 *      302 and the authorization code is in the Location query string.
 *   3. POST that code to the access_token URL to get access/refresh/id
 *      tokens. The `uuid` claim inside the id token is the account guid,
 *      which every later API call has to echo back in its headers.
 */

const crypto = require("crypto");

const CLIENT_VERSION = "2.14.0";
const API_BASE_URL = "https://ctpa-oneapi.tceu-ctp-prd.toyotaconnectedeurope.io";

const CLIENT_ID = "oneapp";
const REDIRECT_URI = "com.toyota.oneapp:/oauth2Callback";
const BASIC_AUTH = "basic b25lYXBwOm9uZWFwcA==";

const AUTHENTICATE_URL =
  "https://b2c-login.toyota-europe.com/json/realms/root/realms/tme/authenticate?authIndexType=service&authIndexValue=oneapp";
const AUTHORIZE_URL =
  "https://b2c-login.toyota-europe.com/oauth2/realms/root/realms/tme/authorize" +
  "?client_id=oneapp&scope=openid+profile+write&response_type=code" +
  "&redirect_uri=com.toyota.oneapp:/oauth2Callback&code_challenge=plain&code_challenge_method=plain";
const ACCESS_TOKEN_URL =
  "https://b2c-login.toyota-europe.com/oauth2/realms/root/realms/tme/access_token";

// This key is not a secret: it is shipped in the MyToyota app and is the same
// for every user. Toyota's gateway rejects requests without it.
const API_KEY = "tTZipv6liF74PwMfk9Ed68AQ0bISswwf3iHQdqcF";

const ENDPOINTS = {
  vehicles: "/v2/vehicle/guid",
  electric: "/v1/vehicle/electric/status",
  telemetry: "/v3/telemetry",
  location: "/v1/location",
  status: "/v1/vehicle/status"
};

const REQUEST_TIMEOUT_MS = 20000;
const MAX_AUTH_ROUNDS = 10;

class ToyotaLoginError extends Error {}
class ToyotaApiError extends Error {}

function hmacSha256(key, message) {
  return crypto.createHmac("sha256", Buffer.from(key, "utf8"))
    .update(Buffer.from(message, "utf8"))
    .digest("hex");
}

// The id token is only read for its `uuid` claim. The signature is not
// verified: we received it over TLS directly from Toyota, and we are not
// making a trust decision on it — it only tells us which guid to send back.
function guidFromIdToken(idToken) {
  const parts = String(idToken).split(".");
  if (parts.length < 2) throw new ToyotaLoginError("id_token is not a JWT");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (!payload.uuid) throw new ToyotaLoginError("id_token has no uuid claim");
  return payload.uuid;
}

class MyToyota {
  constructor(username, password, log = () => {}) {
    this.username = username;
    this.password = password;
    this.log = log;
    this.token = null;
    this.refreshToken = null;
    this.guid = null;
    this.expiresAt = 0;
  }

  async fetchJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    return response;
  }

  // Step 1: walk the callback chain until Toyota hands us a tokenId.
  async authenticate() {
    let data = {};
    for (let round = 0; round < MAX_AUTH_ROUNDS; round++) {
      if (data.callbacks) {
        for (const cb of data.callbacks) {
          const outputValue = cb.output && cb.output[0] && cb.output[0].value;
          if (cb.type === "NameCallback" && outputValue === "User Name") {
            cb.input[0].value = this.username;
          } else if (cb.type === "PasswordCallback") {
            cb.input[0].value = this.password;
          } else if (cb.type === "TextOutputCallback" && outputValue === "User Not Found") {
            throw new ToyotaLoginError("Authentication failed: user not found. Check the username.");
          }
        }
      }

      const response = await this.fetchJson(AUTHENTICATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(data)
      });

      if (response.status !== 200) {
        const text = await response.text().catch(() => "");
        throw new ToyotaLoginError(
          `Authentication failed: HTTP ${response.status}. ${text.slice(0, 200)}`
        );
      }

      data = await response.json();
      if (data.tokenId) return data.tokenId;
    }
    throw new ToyotaLoginError(
      `Authentication failed: no tokenId after ${MAX_AUTH_ROUNDS} rounds. ` +
      "Toyota may be asking for something this client cannot answer, such as a one-time code."
    );
  }

  // Step 2: trade the tokenId for an authorization code.
  async authorize(tokenId) {
    const response = await this.fetchJson(AUTHORIZE_URL, {
      method: "GET",
      headers: { cookie: `iPlanetDirectoryPro=${tokenId}` }
    });
    if (response.status !== 302) {
      throw new ToyotaLoginError(`Authorization failed: expected HTTP 302, got ${response.status}`);
    }
    const location = response.headers.get("location");
    if (!location) throw new ToyotaLoginError("Authorization failed: no Location header");
    const code = new URL(location, "http://localhost").searchParams.get("code");
    if (!code) throw new ToyotaLoginError("Authorization failed: no code in the redirect");
    return code;
  }

  // Step 3 (and token refresh): both use the same endpoint, different grant.
  async requestTokens(form) {
    const response = await this.fetchJson(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: BASIC_AUTH,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(form).toString()
    });
    if (response.status !== 200) {
      const text = await response.text().catch(() => "");
      throw new ToyotaLoginError(`Token request failed: HTTP ${response.status}. ${text.slice(0, 200)}`);
    }
    const tokens = await response.json();
    for (const field of ["access_token", "id_token", "refresh_token", "expires_in"]) {
      if (!tokens[field]) throw new ToyotaLoginError(`Token response is missing ${field}`);
    }
    this.token = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    this.guid = guidFromIdToken(tokens.id_token);
    // Renew a minute early so a call never goes out on a just-expired token.
    this.expiresAt = Date.now() + (tokens.expires_in - 60) * 1000;
    return tokens;
  }

  async login() {
    this.log("MMM-MyToyota: logging in");
    const tokenId = await this.authenticate();
    const code = await this.authorize(tokenId);
    await this.requestTokens({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      code_verifier: "plain",
      code
    });
    this.log("MMM-MyToyota: logged in");
  }

  async ensureToken() {
    if (this.token && Date.now() < this.expiresAt) return;
    if (this.refreshToken) {
      try {
        this.log("MMM-MyToyota: refreshing token");
        await this.requestTokens({
          client_id: CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          grant_type: "refresh_token",
          code_verifier: "plain",
          refresh_token: this.refreshToken
        });
        return;
      } catch (error) {
        this.log(`MMM-MyToyota: refresh failed (${error.message}), logging in again`);
        this.refreshToken = null;
      }
    }
    await this.login();
  }

  headers(vin) {
    const headers = {
      "x-api-key": API_KEY,
      "x-guid": this.guid,
      "guid": this.guid,
      "x-client-ref": hmacSha256(CLIENT_VERSION, this.guid),
      "x-correlationid": crypto.randomUUID(),
      "x-appversion": CLIENT_VERSION,
      "x-channel": "ONEAPP",
      "x-brand": "T",
      "x-region": "EU",
      "x-user-region": "EU",
      "authorization": `Bearer ${this.token}`,
      "user-agent": "okhttp/4.10.0",
      "accept": "application/json"
    };
    if (vin) headers.vin = vin;
    return headers;
  }

  async get(endpoint, vin) {
    await this.ensureToken();
    const url = API_BASE_URL + endpoint;
    const response = await this.fetchJson(url, { method: "GET", headers: this.headers(vin) });

    // A 401 usually means the token was invalidated early. Re-login once.
    if (response.status === 401) {
      this.log("MMM-MyToyota: got 401, re-authenticating");
      this.token = null;
      this.refreshToken = null;
      await this.ensureToken();
      const retry = await this.fetchJson(url, { method: "GET", headers: this.headers(vin) });
      if (!retry.ok) throw new ToyotaApiError(`GET ${endpoint} returned HTTP ${retry.status}`);
      return retry.json();
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ToyotaApiError(`GET ${endpoint} returned HTTP ${response.status}. ${text.slice(0, 200)}`);
    }
    return response.json();
  }

  // Toyota wraps most answers as { payload: ..., status: ... }
  static unwrap(body) {
    if (body && typeof body === "object" && "payload" in body) return body.payload;
    return body;
  }

  async listVehicles() {
    const payload = MyToyota.unwrap(await this.get(ENDPOINTS.vehicles));
    return Array.isArray(payload) ? payload : [];
  }

  async getElectricStatus(vin) {
    return MyToyota.unwrap(await this.get(ENDPOINTS.electric, vin));
  }

  async getTelemetry(vin) {
    return MyToyota.unwrap(await this.get(ENDPOINTS.telemetry, vin));
  }

  async getLocation(vin) {
    return MyToyota.unwrap(await this.get(ENDPOINTS.location, vin));
  }

  async getStatus(vin) {
    return MyToyota.unwrap(await this.get(ENDPOINTS.status, vin));
  }
}

module.exports = { MyToyota, ToyotaLoginError, ToyotaApiError, ENDPOINTS, API_BASE_URL };
