// host.ts
process.env.TRANSCODES_GUARD_HOST = "antigravity";

// ../../private-packages/stepup-core/dist/token-store.js
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
var CONFIG_DIR_NAME = ".transcodes";
var CONFIG_FILE_NAME = "config.json";
function transcodesConfigDir() {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}
function transcodesConfigFile() {
  return path.join(transcodesConfigDir(), CONFIG_FILE_NAME);
}
function readRawConfig() {
  let raw;
  try {
    raw = readFileSync(transcodesConfigFile(), "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed;
}
function writeRawConfig(config) {
  const dir = transcodesConfigDir();
  mkdirSync(dir, { recursive: true, mode: 448 });
  writeFileSync(transcodesConfigFile(), JSON.stringify(config), {
    mode: 384
  });
}
function normalizeToken(v) {
  if (typeof v !== "string")
    return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function normalizeLabel(v) {
  if (typeof v !== "string")
    return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function normalizeRecord(item) {
  if (typeof item === "string") {
    const token = normalizeToken(item);
    return token ? { token, label: null } : null;
  }
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const obj = item;
    const token = normalizeToken(obj.token);
    if (!token)
      return null;
    return { token, label: normalizeLabel(obj.label) };
  }
  return null;
}
function readConfig() {
  const obj = readRawConfig();
  if (!obj) {
    return { token: null, tokenList: [] };
  }
  const list = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (rec) => {
    if (!rec)
      return;
    const existing = list.find((r) => r.token === rec.token);
    if (existing) {
      if (!existing.label && rec.label)
        existing.label = rec.label;
      return;
    }
    seen.add(rec.token);
    list.push(rec);
  };
  if (Array.isArray(obj.token_list)) {
    for (const item of obj.token_list)
      push(normalizeRecord(item));
  }
  const active = normalizeToken(obj.token);
  if (active)
    push({ token: active, label: null });
  return {
    token: active ?? (list.length > 0 ? list[0].token : null),
    tokenList: list
  };
}
function readTokenFromFile() {
  return readConfig().token;
}
function isTrackerEnabled() {
  return readRawConfig()?.enabled !== false;
}
function setTrackerEnabled(enabled) {
  writeRawConfig({ ...readRawConfig() ?? {}, enabled });
}
function resolveToken() {
  const envToken = process.env.TRANSCODES_TOKEN?.trim();
  if (envToken) {
    return { token: envToken, source: "env" };
  }
  const fileToken = readTokenFromFile();
  if (fileToken) {
    return { token: fileToken, source: "file" };
  }
  return { token: null, source: "none" };
}

// ../../private-packages/stepup-core/dist/store.js
import { mkdirSync as mkdirSync3, readFileSync as readFileSync2, rmSync as rmSync2, writeFileSync as writeFileSync2 } from "fs";
import path3 from "path";

// ../../packages/plugin-paths/dist/index.js
import { existsSync, mkdirSync as mkdirSync2, renameSync, copyFileSync } from "fs";
import os2 from "os";
import path2 from "path";
var CLAUDE_PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
function transcodesDir() {
  return path2.join(os2.homedir(), ".transcodes");
}
function stateDir() {
  return path2.join(transcodesDir(), "state");
}
function legacyDataDir() {
  return path2.join(os2.homedir(), ".claude", "transcodes-guard");
}
function legacyCacheDir() {
  if (process.platform === "win32") {
    const base2 = process.env.LOCALAPPDATA?.trim() || path2.join(os2.homedir(), "AppData", "Local");
    return path2.join(base2, "transcodes-guard", "Cache");
  }
  if (process.platform === "darwin") {
    return path2.join(os2.homedir(), "Library", "Caches", "transcodes-guard");
  }
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : path2.join(os2.homedir(), ".cache");
  return path2.join(base, "transcodes-guard");
}
function dataDir() {
  return stateDir();
}
function cacheDir() {
  return stateDir();
}
function migrateLegacyFile(name, kind) {
  void kind;
  try {
    const target = stateDir();
    const newPath = path2.join(target, name);
    if (existsSync(newPath)) {
      return;
    }
    const candidates = [];
    const plug = process.env[CLAUDE_PLUGIN_DATA_ENV]?.trim();
    if (plug && plug.length > 0) {
      candidates.push(path2.join(plug, name));
    }
    candidates.push(path2.join(legacyDataDir(), name));
    candidates.push(path2.join(legacyCacheDir(), name));
    const oldPath = candidates.find((p) => p !== newPath && existsSync(p));
    if (!oldPath) {
      return;
    }
    mkdirSync2(target, { recursive: true });
    copyFileSync(oldPath, newPath);
    renameSync(oldPath, oldPath + ".bak");
  } catch {
  }
}

// ../../private-packages/stepup-core/dist/jwt.js
var REQUIRED_AUDIENCE = "transcodes-mcp";
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function tryDecodeBase64UrlJson(segment) {
  if (!segment)
    return void 0;
  try {
    const json = Buffer.from(segment, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    return isPlainObject(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function readString(rec, key) {
  const v = rec[key];
  if (typeof v !== "string")
    return void 0;
  const t = v.trim();
  return t || void 0;
}
function readNumericDate(rec, key) {
  const v = rec[key];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? Math.floor(n) : void 0;
}
function readAudience(rec) {
  const aud = rec["aud"];
  if (typeof aud === "string") {
    const t = aud.trim();
    return t ? [t] : void 0;
  }
  if (Array.isArray(aud)) {
    const list = aud.filter((x) => typeof x === "string").map((x) => x.trim()).filter((x) => x.length > 0);
    return list.length > 0 ? list : void 0;
  }
  return void 0;
}
function parseMemberAccessToken(rawToken) {
  if (typeof rawToken !== "string") {
    throw new Error("token must be a string");
  }
  const raw = rawToken.trim();
  if (!raw) {
    throw new Error("token is empty");
  }
  const warnings = [];
  const parts = raw.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) {
    warnings.push(`token does not look like a JWT (expected 3 non-empty segments, got ${parts.length})`);
  }
  const payloadSegment = parts.length === 3 ? parts[1] : raw;
  const payload = tryDecodeBase64UrlJson(payloadSegment);
  if (!payload) {
    throw new Error("token payload could not be decoded as base64url JSON object");
  }
  const organizationId = readString(payload, "oid");
  const projectId = readString(payload, "pid");
  const memberId = readString(payload, "mid");
  if (!organizationId || !projectId || !memberId) {
    throw new Error("token payload must include oid, pid, and mid claims");
  }
  const aud = readAudience(payload);
  if (!aud) {
    warnings.push("aud claim is missing");
  } else if (!aud.includes(REQUIRED_AUDIENCE)) {
    warnings.push(`aud does not include "${REQUIRED_AUDIENCE}" (got ${JSON.stringify(aud)})`);
  }
  const exp = readNumericDate(payload, "exp");
  if (exp === void 0) {
    throw new Error("token must include exp claim (NumericDate, integer seconds)");
  }
  const nowSec = Math.floor(Date.now() / 1e3);
  if (nowSec >= exp) {
    throw new Error("token has expired");
  }
  return {
    raw,
    claims: {
      organizationId,
      projectId,
      memberId,
      aud,
      exp,
      iss: readString(payload, "iss"),
      jti: readString(payload, "jti"),
      iat: readNumericDate(payload, "iat")
    },
    warnings
  };
}

// ../../private-packages/stepup-core/dist/config.js
var DEFAULT_BACKEND_URL = "https://api.transcodesapis.com";
var STEPUP_TTL_MS = 10 * 60 * 1e3;
function loadStepupConfig() {
  const rawUrl = process.env.TRANSCODES_BACKEND_URL?.trim() || DEFAULT_BACKEND_URL;
  const backendUrl = rawUrl.replace(/\/$/, "");
  try {
    new URL(backendUrl);
  } catch {
    throw new Error(`TRANSCODES_BACKEND_URL is not a valid URL: ${backendUrl}`);
  }
  const { token: tokenRaw } = resolveToken();
  if (!tokenRaw) {
    throw new Error("No Transcodes token found. Get a token from the Transcodes console (member detail page, https://app.transcodes.io), then run `transcodes login <token>` in a terminal \u2014 or set the TRANSCODES_TOKEN environment variable.");
  }
  const parsed = parseMemberAccessToken(tokenRaw);
  for (const w of parsed.warnings) {
    process.stderr.write(`[transcodes-guard] WARN TRANSCODES_TOKEN: ${w}
`);
  }
  return {
    backendUrl,
    apiBaseV1: `${backendUrl}/v1`,
    token: parsed.raw,
    organizationId: parsed.claims.organizationId,
    projectId: parsed.claims.projectId,
    memberId: parsed.claims.memberId
  };
}

// ../../private-packages/stepup-core/dist/store.js
function cacheDir2() {
  return cacheDir();
}
var FILE_NAME = "stepup-verified.json";
function storePath() {
  return path3.join(cacheDir2(), FILE_NAME);
}
function readVerified() {
  migrateLegacyFile(FILE_NAME, "cache");
  const file = storePath();
  let raw;
  try {
    raw = readFileSync2(file, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    consumeVerified();
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    consumeVerified();
    return null;
  }
  const obj = parsed;
  const sid = typeof obj.sid === "string" ? obj.sid : null;
  const verifiedAt = typeof obj.verifiedAt === "number" ? obj.verifiedAt : null;
  if (!sid || verifiedAt === null) {
    consumeVerified();
    return null;
  }
  const ageMs = Date.now() - verifiedAt;
  if (ageMs > STEPUP_TTL_MS) {
    process.stderr.write(`transcodes-guard: verified record EXPIRED (sid=${sid}, age=${ageMs}ms, ttl=${STEPUP_TTL_MS}ms) \u2014 starting a new step-up.
`);
    consumeVerified();
    return null;
  }
  return { sid, verifiedAt };
}
function writeVerified(v) {
  const file = storePath();
  mkdirSync3(path3.dirname(file), { recursive: true });
  writeFileSync2(file, JSON.stringify(v), { mode: 384 });
}
function consumeVerified() {
  try {
    rmSync2(storePath(), { force: true });
  } catch {
  }
}

// ../../private-packages/stepup-core/dist/pending.js
import { mkdirSync as mkdirSync4, readFileSync as readFileSync3, rmSync as rmSync3, writeFileSync as writeFileSync3 } from "fs";
import path4 from "path";
import { z } from "zod";
var FILE_NAME2 = "stepup-pending.json";
var PendingStateSchema = z.object({
  sid: z.string().min(1),
  command: z.string(),
  reason: z.string(),
  browserUrl: z.string(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.string().optional(),
  status: z.enum(["pending", "verified"])
});
function pendingPath() {
  return path4.join(cacheDir(), FILE_NAME2);
}
function readPending() {
  migrateLegacyFile(FILE_NAME2, "cache");
  try {
    const raw = readFileSync3(pendingPath(), "utf8");
    const parsed = PendingStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function writePending(state) {
  const file = pendingPath();
  mkdirSync4(path4.dirname(file), { recursive: true });
  writeFileSync3(file, JSON.stringify(state), { mode: 384 });
}
function clearPending() {
  try {
    rmSync3(pendingPath(), { force: true });
  } catch {
  }
}
function markVerified(sid) {
  const prev = readPending();
  if (!prev || prev.sid !== sid)
    return;
  writePending({ ...prev, status: "verified" });
}
function isExpired(state, now = Date.now()) {
  if (state.expiresAt) {
    const t = Date.parse(state.expiresAt);
    if (Number.isFinite(t))
      return now >= t;
  }
  return now - state.createdAt > STEPUP_TTL_MS;
}

// ../../private-packages/stepup-core/dist/evaluate.js
import { execFileSync } from "child_process";
import path8 from "path";

// ../../packages/danger-patterns/dist/danger-patterns.js
import { readFileSync as readFileSync4, writeFileSync as writeFileSync4, mkdirSync as mkdirSync5, existsSync as existsSync2 } from "fs";
import path5 from "path";

// ../../node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
  let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value2 = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value2 = value2 * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value2 = value2 * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value2 = value2 * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value2 = -1;
    }
    return value2;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
      pos++;
      if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "", start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += "\n";
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "	";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return token = 17;
    }
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return token = 15;
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
        pos++;
        value += "\n";
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return token = 14;
    }
    switch (code) {
      // tokens: []{}:,
      case 123:
        pos++;
        return token = 1;
      case 125:
        pos++;
        return token = 2;
      case 91:
        pos++;
        return token = 3;
      case 93:
        pos++;
        return token = 4;
      case 58:
        pos++;
        return token = 6;
      case 44:
        pos++;
        return token = 5;
      // strings
      case 34:
        pos++;
        value = scanString();
        return token = 10;
      // comments
      case 47:
        const start = pos - 1;
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return token = 12;
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength = len - 1;
          let commentClosed = false;
          while (pos < safeLength) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text.substring(start, pos);
          return token = 13;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
      // numbers
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
          return token = 16;
        }
      // found a minus, followed by a number so
      // we fall through to proceed with scanning
      // numbers
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return token = 11;
      // literals and unknown symbols
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return token = 8;
            case "false":
              return token = 9;
            case "null":
              return token = 7;
          }
          return token = 16;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}
var CharacterCodes;
(function(CharacterCodes2) {
  CharacterCodes2[CharacterCodes2["lineFeed"] = 10] = "lineFeed";
  CharacterCodes2[CharacterCodes2["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes2[CharacterCodes2["space"] = 32] = "space";
  CharacterCodes2[CharacterCodes2["_0"] = 48] = "_0";
  CharacterCodes2[CharacterCodes2["_1"] = 49] = "_1";
  CharacterCodes2[CharacterCodes2["_2"] = 50] = "_2";
  CharacterCodes2[CharacterCodes2["_3"] = 51] = "_3";
  CharacterCodes2[CharacterCodes2["_4"] = 52] = "_4";
  CharacterCodes2[CharacterCodes2["_5"] = 53] = "_5";
  CharacterCodes2[CharacterCodes2["_6"] = 54] = "_6";
  CharacterCodes2[CharacterCodes2["_7"] = 55] = "_7";
  CharacterCodes2[CharacterCodes2["_8"] = 56] = "_8";
  CharacterCodes2[CharacterCodes2["_9"] = 57] = "_9";
  CharacterCodes2[CharacterCodes2["a"] = 97] = "a";
  CharacterCodes2[CharacterCodes2["b"] = 98] = "b";
  CharacterCodes2[CharacterCodes2["c"] = 99] = "c";
  CharacterCodes2[CharacterCodes2["d"] = 100] = "d";
  CharacterCodes2[CharacterCodes2["e"] = 101] = "e";
  CharacterCodes2[CharacterCodes2["f"] = 102] = "f";
  CharacterCodes2[CharacterCodes2["g"] = 103] = "g";
  CharacterCodes2[CharacterCodes2["h"] = 104] = "h";
  CharacterCodes2[CharacterCodes2["i"] = 105] = "i";
  CharacterCodes2[CharacterCodes2["j"] = 106] = "j";
  CharacterCodes2[CharacterCodes2["k"] = 107] = "k";
  CharacterCodes2[CharacterCodes2["l"] = 108] = "l";
  CharacterCodes2[CharacterCodes2["m"] = 109] = "m";
  CharacterCodes2[CharacterCodes2["n"] = 110] = "n";
  CharacterCodes2[CharacterCodes2["o"] = 111] = "o";
  CharacterCodes2[CharacterCodes2["p"] = 112] = "p";
  CharacterCodes2[CharacterCodes2["q"] = 113] = "q";
  CharacterCodes2[CharacterCodes2["r"] = 114] = "r";
  CharacterCodes2[CharacterCodes2["s"] = 115] = "s";
  CharacterCodes2[CharacterCodes2["t"] = 116] = "t";
  CharacterCodes2[CharacterCodes2["u"] = 117] = "u";
  CharacterCodes2[CharacterCodes2["v"] = 118] = "v";
  CharacterCodes2[CharacterCodes2["w"] = 119] = "w";
  CharacterCodes2[CharacterCodes2["x"] = 120] = "x";
  CharacterCodes2[CharacterCodes2["y"] = 121] = "y";
  CharacterCodes2[CharacterCodes2["z"] = 122] = "z";
  CharacterCodes2[CharacterCodes2["A"] = 65] = "A";
  CharacterCodes2[CharacterCodes2["B"] = 66] = "B";
  CharacterCodes2[CharacterCodes2["C"] = 67] = "C";
  CharacterCodes2[CharacterCodes2["D"] = 68] = "D";
  CharacterCodes2[CharacterCodes2["E"] = 69] = "E";
  CharacterCodes2[CharacterCodes2["F"] = 70] = "F";
  CharacterCodes2[CharacterCodes2["G"] = 71] = "G";
  CharacterCodes2[CharacterCodes2["H"] = 72] = "H";
  CharacterCodes2[CharacterCodes2["I"] = 73] = "I";
  CharacterCodes2[CharacterCodes2["J"] = 74] = "J";
  CharacterCodes2[CharacterCodes2["K"] = 75] = "K";
  CharacterCodes2[CharacterCodes2["L"] = 76] = "L";
  CharacterCodes2[CharacterCodes2["M"] = 77] = "M";
  CharacterCodes2[CharacterCodes2["N"] = 78] = "N";
  CharacterCodes2[CharacterCodes2["O"] = 79] = "O";
  CharacterCodes2[CharacterCodes2["P"] = 80] = "P";
  CharacterCodes2[CharacterCodes2["Q"] = 81] = "Q";
  CharacterCodes2[CharacterCodes2["R"] = 82] = "R";
  CharacterCodes2[CharacterCodes2["S"] = 83] = "S";
  CharacterCodes2[CharacterCodes2["T"] = 84] = "T";
  CharacterCodes2[CharacterCodes2["U"] = 85] = "U";
  CharacterCodes2[CharacterCodes2["V"] = 86] = "V";
  CharacterCodes2[CharacterCodes2["W"] = 87] = "W";
  CharacterCodes2[CharacterCodes2["X"] = 88] = "X";
  CharacterCodes2[CharacterCodes2["Y"] = 89] = "Y";
  CharacterCodes2[CharacterCodes2["Z"] = 90] = "Z";
  CharacterCodes2[CharacterCodes2["asterisk"] = 42] = "asterisk";
  CharacterCodes2[CharacterCodes2["backslash"] = 92] = "backslash";
  CharacterCodes2[CharacterCodes2["closeBrace"] = 125] = "closeBrace";
  CharacterCodes2[CharacterCodes2["closeBracket"] = 93] = "closeBracket";
  CharacterCodes2[CharacterCodes2["colon"] = 58] = "colon";
  CharacterCodes2[CharacterCodes2["comma"] = 44] = "comma";
  CharacterCodes2[CharacterCodes2["dot"] = 46] = "dot";
  CharacterCodes2[CharacterCodes2["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes2[CharacterCodes2["minus"] = 45] = "minus";
  CharacterCodes2[CharacterCodes2["openBrace"] = 123] = "openBrace";
  CharacterCodes2[CharacterCodes2["openBracket"] = 91] = "openBracket";
  CharacterCodes2[CharacterCodes2["plus"] = 43] = "plus";
  CharacterCodes2[CharacterCodes2["slash"] = 47] = "slash";
  CharacterCodes2[CharacterCodes2["formFeed"] = 12] = "formFeed";
  CharacterCodes2[CharacterCodes2["tab"] = 9] = "tab";
})(CharacterCodes || (CharacterCodes = {}));

// ../../node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces = new Array(20).fill(0).map((_, index) => {
  return " ".repeat(index);
});
var maxCachedValues = 200;
var cachedBreakLinesWithSpaces = {
  " ": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\n" + " ".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + " ".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r\n" + " ".repeat(index);
    })
  },
  "	": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\n" + "	".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + "	".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r\n" + "	".repeat(index);
    })
  }
};

// ../../node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions2) {
  ParseOptions2.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));
function parse(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentProperty = null;
  let currentParent = [];
  const previousParents = [];
  function onValue(value) {
    if (Array.isArray(currentParent)) {
      currentParent.push(value);
    } else if (currentProperty !== null) {
      currentParent[currentProperty] = value;
    }
  }
  const visitor = {
    onObjectBegin: () => {
      const object = {};
      onValue(object);
      previousParents.push(currentParent);
      currentParent = object;
      currentProperty = null;
    },
    onObjectProperty: (name) => {
      currentProperty = name;
    },
    onObjectEnd: () => {
      currentParent = previousParents.pop();
    },
    onArrayBegin: () => {
      const array = [];
      onValue(array);
      previousParents.push(currentParent);
      currentParent = array;
      currentProperty = null;
    },
    onArrayEnd: () => {
      currentParent = previousParents.pop();
    },
    onLiteralValue: onValue,
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  return currentParent[0];
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks++;
      } else {
        let cbReturn = visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice());
        if (cbReturn === false) {
          suppressedCallbacks = 1;
        }
      }
    } : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks--;
      }
      if (suppressedCallbacks === 0) {
        visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
      }
    } : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(
            14
            /* ParseErrorCode.InvalidUnicode */
          );
          break;
        case 5:
          handleError(
            15
            /* ParseErrorCode.InvalidEscapeCharacter */
          );
          break;
        case 3:
          handleError(
            13
            /* ParseErrorCode.UnexpectedEndOfNumber */
          );
          break;
        case 1:
          if (!disallowComments) {
            handleError(
              11
              /* ParseErrorCode.UnexpectedEndOfComment */
            );
          }
          break;
        case 2:
          handleError(
            12
            /* ParseErrorCode.UnexpectedEndOfString */
          );
          break;
        case 6:
          handleError(
            16
            /* ParseErrorCode.InvalidCharacter */
          );
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(
              10
              /* ParseErrorCode.InvalidCommentToken */
            );
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(
            1
            /* ParseErrorCode.InvalidSymbol */
          );
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error, skipUntilAfter = [], skipUntil = []) {
    onError(error);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(
            2
            /* ParseErrorCode.InvalidNumberFormat */
          );
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(3, [], [
        2,
        5
        /* SyntaxKind.CommaToken */
      ]);
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(4, [], [
          2,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
    } else {
      handleError(5, [], [
        2,
        5
        /* SyntaxKind.CommaToken */
      ]);
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(4, [], [
          2,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(7, [
        2
        /* SyntaxKind.CloseBraceToken */
      ], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(4, [], [
          4,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(8, [
        4
        /* SyntaxKind.CloseBracketToken */
      ], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray();
      case 1:
        return parseObject();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}

// ../../node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function(ScanError2) {
  ScanError2[ScanError2["None"] = 0] = "None";
  ScanError2[ScanError2["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
  ScanError2[ScanError2["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
  ScanError2[ScanError2["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
  ScanError2[ScanError2["InvalidUnicode"] = 4] = "InvalidUnicode";
  ScanError2[ScanError2["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
  ScanError2[ScanError2["InvalidCharacter"] = 6] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function(SyntaxKind2) {
  SyntaxKind2[SyntaxKind2["OpenBraceToken"] = 1] = "OpenBraceToken";
  SyntaxKind2[SyntaxKind2["CloseBraceToken"] = 2] = "CloseBraceToken";
  SyntaxKind2[SyntaxKind2["OpenBracketToken"] = 3] = "OpenBracketToken";
  SyntaxKind2[SyntaxKind2["CloseBracketToken"] = 4] = "CloseBracketToken";
  SyntaxKind2[SyntaxKind2["CommaToken"] = 5] = "CommaToken";
  SyntaxKind2[SyntaxKind2["ColonToken"] = 6] = "ColonToken";
  SyntaxKind2[SyntaxKind2["NullKeyword"] = 7] = "NullKeyword";
  SyntaxKind2[SyntaxKind2["TrueKeyword"] = 8] = "TrueKeyword";
  SyntaxKind2[SyntaxKind2["FalseKeyword"] = 9] = "FalseKeyword";
  SyntaxKind2[SyntaxKind2["StringLiteral"] = 10] = "StringLiteral";
  SyntaxKind2[SyntaxKind2["NumericLiteral"] = 11] = "NumericLiteral";
  SyntaxKind2[SyntaxKind2["LineCommentTrivia"] = 12] = "LineCommentTrivia";
  SyntaxKind2[SyntaxKind2["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
  SyntaxKind2[SyntaxKind2["LineBreakTrivia"] = 14] = "LineBreakTrivia";
  SyntaxKind2[SyntaxKind2["Trivia"] = 15] = "Trivia";
  SyntaxKind2[SyntaxKind2["Unknown"] = 16] = "Unknown";
  SyntaxKind2[SyntaxKind2["EOF"] = 17] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
var parse2 = parse;
var ParseErrorCode;
(function(ParseErrorCode2) {
  ParseErrorCode2[ParseErrorCode2["InvalidSymbol"] = 1] = "InvalidSymbol";
  ParseErrorCode2[ParseErrorCode2["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
  ParseErrorCode2[ParseErrorCode2["PropertyNameExpected"] = 3] = "PropertyNameExpected";
  ParseErrorCode2[ParseErrorCode2["ValueExpected"] = 4] = "ValueExpected";
  ParseErrorCode2[ParseErrorCode2["ColonExpected"] = 5] = "ColonExpected";
  ParseErrorCode2[ParseErrorCode2["CommaExpected"] = 6] = "CommaExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBraceExpected"] = 7] = "CloseBraceExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBracketExpected"] = 8] = "CloseBracketExpected";
  ParseErrorCode2[ParseErrorCode2["EndOfFileExpected"] = 9] = "EndOfFileExpected";
  ParseErrorCode2[ParseErrorCode2["InvalidCommentToken"] = 10] = "InvalidCommentToken";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
  ParseErrorCode2[ParseErrorCode2["InvalidUnicode"] = 14] = "InvalidUnicode";
  ParseErrorCode2[ParseErrorCode2["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
  ParseErrorCode2[ParseErrorCode2["InvalidCharacter"] = 16] = "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));

// ../../packages/danger-patterns/dist/data/danger-patterns.json
var danger_patterns_default = {
  patterns: [
    {
      id: "rm-rf-root",
      regex: "\\brm\\s+(-[rRf]+\\s+)+(/[^\\s]*|~[^\\s]*|\\$HOME[^\\s]*)",
      reason: "Recursive removal of an absolute path, ~, or $HOME"
    },
    {
      id: "rm-rf-broad",
      regex: "\\brm\\s+-[rRf]*[rR][rRf]*\\s+\\*",
      reason: "Recursive removal with bare glob (rm -rf *)"
    },
    {
      id: "dd-disk",
      regex: "\\bdd\\s+.*of=/dev/(sd|nvme|hd|disk)",
      reason: "Direct write to block device"
    },
    {
      id: "mkfs",
      regex: "\\bmkfs(\\.|\\s)",
      reason: "Filesystem creation"
    },
    {
      id: "curl-pipe-shell",
      regex: "\\b(curl|wget)\\b[^|]*\\|\\s*(sudo\\s+)?(sh|bash|zsh)\\b",
      reason: "Piping remote content to shell"
    },
    {
      id: "fork-bomb",
      regex: ":\\(\\)\\s*\\{\\s*:\\|:&",
      reason: "Classic fork bomb"
    },
    {
      id: "chmod-recursive-root",
      regex: "\\bchmod\\s+-R\\s+\\d+\\s+(/[^\\s]*|~[^\\s]*|\\$HOME[^\\s]*)",
      reason: "Recursive chmod on an absolute path, ~, or $HOME"
    },
    {
      id: "git-force-push-protected",
      regex: "\\bgit\\s+push\\s+(--force|-f)\\b.*\\b(main|master|prod|production)\\b",
      reason: "Force push to protected branch"
    },
    {
      id: "tracker-self-disable",
      regex: "\\btranscodes\\b[^\\n]*\\bdisable\\b",
      reason: "Disabling the transcodes-guard step-up gate \u2014 requires human step-up approval (an agent must not silently switch off its own guardrails)"
    }
  ]
};

// ../../packages/danger-patterns/dist/danger-patterns.js
var USER_PATTERNS_FILE = "user-patterns.json";
var ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;
function getUserPatternsPath() {
  return path5.join(dataDir(), USER_PATTERNS_FILE);
}
function loadSystemPatterns() {
  return { patterns: [...danger_patterns_default.patterns] };
}
function loadUserPatterns() {
  migrateLegacyFile(USER_PATTERNS_FILE, "data");
  try {
    const raw = readFileSync4(getUserPatternsPath(), "utf8");
    const parsed = parse2(raw);
    if (parsed && Array.isArray(parsed.patterns)) {
      return parsed;
    }
    return { patterns: [] };
  } catch {
    return { patterns: [] };
  }
}
function saveUserPatterns(config) {
  const file = getUserPatternsPath();
  mkdirSync5(path5.dirname(file), { recursive: true });
  writeFileSync4(file, JSON.stringify(config, null, 2) + "\n", "utf8");
}
function loadMergedPatterns() {
  const system = loadSystemPatterns().patterns.map((p) => ({
    ...p,
    source: "system"
  }));
  const user = loadUserPatterns().patterns.map((p) => ({
    ...p,
    source: "user"
  }));
  return [...system, ...user];
}
function findFirstMatch(command, patterns) {
  for (const p of patterns) {
    try {
      if (new RegExp(p.regex).test(command))
        return { matched: p };
    } catch {
    }
  }
  return null;
}
var PatternValidationError = class extends Error {
};
function isReservedId(id, systemIds) {
  return systemIds.has(id);
}
function validateNewPattern(input) {
  const { id, regex, reason } = input;
  if (!ID_REGEX.test(id)) {
    throw new PatternValidationError(`id must match /^[a-z0-9][a-z0-9-]*$/ (got: "${id}")`);
  }
  const systemIds = new Set(loadSystemPatterns().patterns.map((p) => p.id));
  if (isReservedId(id, systemIds)) {
    throw new PatternValidationError(`id "${id}" is reserved by a system pattern and cannot be overridden`);
  }
  try {
    new RegExp(regex);
  } catch (e) {
    throw new PatternValidationError(`regex does not compile: ${e.message}`);
  }
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    throw new PatternValidationError("reason must not be empty");
  }
  return { id, regex, reason: trimmedReason };
}
function addUserPattern(input) {
  const pattern = validateNewPattern(input);
  const current = loadUserPatterns();
  if (current.patterns.some((p) => p.id === pattern.id)) {
    throw new PatternValidationError(`id "${pattern.id}" already exists in user patterns; use update instead`);
  }
  current.patterns.push(pattern);
  saveUserPatterns(current);
  return pattern;
}
function updateUserPattern(id, changes) {
  const systemIds = new Set(loadSystemPatterns().patterns.map((p) => p.id));
  if (systemIds.has(id)) {
    throw new PatternValidationError(`id "${id}" is a system pattern and cannot be modified`);
  }
  const current = loadUserPatterns();
  const existing = current.patterns.find((p) => p.id === id);
  if (!existing) {
    throw new PatternValidationError(`no user pattern with id "${id}"`);
  }
  const merged = {
    id,
    regex: changes.regex ?? existing.regex,
    reason: changes.reason ?? existing.reason
  };
  const validated = validateNewPattern(merged);
  const idx = current.patterns.findIndex((p) => p.id === id);
  current.patterns[idx] = validated;
  saveUserPatterns(current);
  return validated;
}
function removeUserPattern(id) {
  const systemIds = new Set(loadSystemPatterns().patterns.map((p) => p.id));
  if (systemIds.has(id)) {
    throw new PatternValidationError(`id "${id}" is a system pattern and cannot be removed`);
  }
  const current = loadUserPatterns();
  const idx = current.patterns.findIndex((p) => p.id === id);
  if (idx === -1) {
    throw new PatternValidationError(`no user pattern with id "${id}"`);
  }
  current.patterns.splice(idx, 1);
  saveUserPatterns(current);
}

// ../../private-packages/danger-rules/dist/tool-rules.js
import { readFileSync as readFileSync5, writeFileSync as writeFileSync5, mkdirSync as mkdirSync6, existsSync as existsSync3 } from "fs";
import path6 from "path";

// ../../private-packages/danger-rules/dist/data/tool-rules.json
var tool_rules_default = {
  rules: [
    {
      id: "tc-retire-member",
      toolName: "mcp__plugin_transcodes-guard_transcodes-guard__retire_member",
      reason: "Permanent member deletion",
      stepupAction: "retire_member",
      stepupResource: "transcodes-guard:mcp:members"
    },
    {
      id: "tc-suspend-member",
      toolName: "mcp__plugin_transcodes-guard_transcodes-guard__suspend_member",
      reason: "Member login suspension",
      stepupAction: "suspend_member",
      stepupResource: "transcodes-guard:mcp:members"
    },
    {
      id: "tc-unsuspend-member",
      toolName: "mcp__plugin_transcodes-guard_transcodes-guard__unsuspend_member",
      reason: "Member suspension removal",
      stepupAction: "unsuspend_member",
      stepupResource: "transcodes-guard:mcp:members"
    },
    {
      id: "tc-retire-role",
      toolName: "mcp__plugin_transcodes-guard_transcodes-guard__retire_role",
      reason: "Permanent role deletion",
      stepupAction: "retire_role",
      stepupResource: "transcodes-guard:mcp:rbac"
    },
    {
      id: "tc-set-role-permissions",
      toolName: "mcp__plugin_transcodes-guard_transcodes-guard__set_role_permissions",
      reason: "Role permissions matrix reset",
      stepupAction: "set_role_permissions",
      stepupResource: "transcodes-guard:mcp:rbac"
    },
    {
      id: "tc-update-member-role",
      toolName: "mcp__plugin_transcodes-guard_transcodes-guard__update_member_role",
      reason: "Member role reassignment",
      stepupAction: "update_member_role",
      stepupResource: "transcodes-guard:mcp:rbac"
    },
    {
      id: "tc-retire-resource",
      toolName: "mcp__plugin_transcodes-guard_transcodes-guard__retire_resource",
      reason: "Permanent RBAC resource deletion",
      stepupAction: "retire_resource",
      stepupResource: "transcodes-guard:mcp:rbac"
    },
    {
      id: "tc-passcode-create",
      toolName: "mcp__plugin_transcodes-guard_transcodes-guard__passcode_create",
      reason: "Recovery passcode generation",
      stepupAction: "passcode_create",
      stepupResource: "transcodes-guard:mcp:passcode"
    }
  ]
};

// ../../private-packages/danger-rules/dist/tool-rules.js
var USER_TOOL_RULES_FILE = "user-tool-rules.json";
var ID_REGEX2 = /^[a-z0-9][a-z0-9-]*$/;
function getUserToolRulesPath() {
  return path6.join(dataDir(), USER_TOOL_RULES_FILE);
}
function loadSystemToolRules() {
  return { rules: [...tool_rules_default.rules] };
}
function loadUserToolRules() {
  migrateLegacyFile(USER_TOOL_RULES_FILE, "data");
  try {
    const raw = readFileSync5(getUserToolRulesPath(), "utf8");
    const parsed = parse2(raw);
    if (parsed && Array.isArray(parsed.rules)) {
      return parsed;
    }
    return { rules: [] };
  } catch {
    return { rules: [] };
  }
}
function saveUserToolRules(config) {
  const file = getUserToolRulesPath();
  mkdirSync6(path6.dirname(file), { recursive: true });
  writeFileSync5(file, JSON.stringify(config, null, 2) + "\n", "utf8");
}
function loadMergedToolRules() {
  const system = loadSystemToolRules().rules.map((r) => ({
    ...r,
    consume_in_hook: r.consume_in_hook ?? false,
    source: "system"
  }));
  const user = loadUserToolRules().rules.map((r) => ({
    ...r,
    consume_in_hook: r.consume_in_hook ?? true,
    source: "user"
  }));
  return [...system, ...user];
}
function findFirstToolRule(toolName, rules) {
  for (const r of rules) {
    if (r.toolName === toolName)
      return { matched: r };
  }
  return null;
}
var ToolRuleValidationError = class extends Error {
};
function validateNewToolRule(input) {
  const { id, toolName, reason, stepupAction, stepupResource, consume_in_hook } = input;
  if (!ID_REGEX2.test(id)) {
    throw new ToolRuleValidationError(`id must match /^[a-z0-9][a-z0-9-]*$/ (got: "${id}")`);
  }
  const systemIds = new Set(loadSystemToolRules().rules.map((r) => r.id));
  if (systemIds.has(id)) {
    throw new ToolRuleValidationError(`id "${id}" is reserved by a system tool-rule and cannot be overridden`);
  }
  const trimmedToolName = toolName.trim();
  if (!trimmedToolName) {
    throw new ToolRuleValidationError("toolName must not be empty");
  }
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new ToolRuleValidationError("reason must not be empty");
  }
  const trimmedAction = stepupAction.trim();
  if (!trimmedAction) {
    throw new ToolRuleValidationError("stepupAction must not be empty");
  }
  const trimmedResource = stepupResource.trim();
  if (!trimmedResource) {
    throw new ToolRuleValidationError("stepupResource must not be empty");
  }
  return {
    id,
    toolName: trimmedToolName,
    reason: trimmedReason,
    stepupAction: trimmedAction,
    stepupResource: trimmedResource,
    ...consume_in_hook === void 0 ? {} : { consume_in_hook }
  };
}
function addUserToolRule(input) {
  const rule = validateNewToolRule(input);
  const current = loadUserToolRules();
  if (current.rules.some((r) => r.id === rule.id)) {
    throw new ToolRuleValidationError(`id "${rule.id}" already exists in user tool-rules; use update instead`);
  }
  current.rules.push(rule);
  saveUserToolRules(current);
  return rule;
}
function updateUserToolRule(id, changes) {
  const systemIds = new Set(loadSystemToolRules().rules.map((r) => r.id));
  if (systemIds.has(id)) {
    throw new ToolRuleValidationError(`id "${id}" is a system tool-rule and cannot be modified`);
  }
  const current = loadUserToolRules();
  const existing = current.rules.find((r) => r.id === id);
  if (!existing) {
    throw new ToolRuleValidationError(`no user tool-rule with id "${id}"`);
  }
  const merged = {
    id,
    toolName: changes.toolName ?? existing.toolName,
    reason: changes.reason ?? existing.reason,
    stepupAction: changes.stepupAction ?? existing.stepupAction,
    stepupResource: changes.stepupResource ?? existing.stepupResource,
    consume_in_hook: changes.consume_in_hook ?? existing.consume_in_hook
  };
  const validated = validateNewToolRule(merged);
  const idx = current.rules.findIndex((r) => r.id === id);
  current.rules[idx] = validated;
  saveUserToolRules(current);
  return validated;
}
function removeUserToolRule(id) {
  const systemIds = new Set(loadSystemToolRules().rules.map((r) => r.id));
  if (systemIds.has(id)) {
    throw new ToolRuleValidationError(`id "${id}" is a system tool-rule and cannot be removed`);
  }
  const current = loadUserToolRules();
  const idx = current.rules.findIndex((r) => r.id === id);
  if (idx === -1) {
    throw new ToolRuleValidationError(`no user tool-rule with id "${id}"`);
  }
  current.rules.splice(idx, 1);
  saveUserToolRules(current);
}

// ../../private-packages/stepup-core/dist/gate.js
import { spawn } from "child_process";
import { createHash } from "crypto";
import { mkdirSync as mkdirSync7, readFileSync as readFileSync6, writeFileSync as writeFileSync6 } from "fs";
import path7 from "path";

// ../../private-packages/stepup-core/dist/client.js
var REQUEST_TIMEOUT_MS = 3e4;
async function request(config, input) {
  const path10 = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const params = new URLSearchParams();
  if (input.query) {
    for (const [k, v] of Object.entries(input.query)) {
      if (v !== void 0 && v !== null && v !== "") {
        params.append(k, String(v));
      }
    }
  }
  const qs = params.toString();
  const url = `${config.apiBaseV1}${path10}${qs ? `?${qs}` : ""}`;
  const headers = {
    "x-transcodes-token": config.token,
    Accept: "application/json"
  };
  if (input.stepUpSid) {
    headers["X-Step-Up-Session-Id"] = input.stepUpSid;
  }
  let body;
  const sendsBody = input.method !== "GET" && !input.omitBody;
  if (sendsBody) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(input.body ?? {});
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: input.method,
      headers,
      body,
      signal: controller.signal
    });
    let data;
    const text = await response.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      data
    };
  } catch (err) {
    const aborted = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    return {
      ok: false,
      status: 0,
      data: {
        error: "Network Request Failed",
        message: aborted ? "Request timed out" : "Could not reach the backend. Check TRANSCODES_BACKEND_URL and network connectivity."
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

// ../../private-packages/stepup-core/dist/session.js
var STEPUP_PATH = "/auth/temp-session/step-up/session";
function readStepupPayload(envelope) {
  const data = envelope.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return void 0;
  }
  const payload = data.payload;
  if (!Array.isArray(payload) || payload.length === 0)
    return void 0;
  const first = payload[0];
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    return void 0;
  }
  return first;
}
function readString2(rec, key) {
  const v = rec[key];
  return typeof v === "string" && v.trim() ? v : void 0;
}
async function createStepupSession(config, args) {
  const comment = args.comment?.trim();
  if (!comment) {
    throw new Error("comment is required: one short sentence for the step-up UI");
  }
  const envelope = await request(config, {
    method: "POST",
    path: STEPUP_PATH,
    body: {
      organization_id: config.organizationId,
      project_id: config.projectId,
      member_id: args.member_id ?? config.memberId,
      action: args.action,
      resource: args.resource,
      comment,
      mode: args.mode
    }
  });
  const payload = readStepupPayload(envelope);
  return {
    envelope,
    sid: payload ? readString2(payload, "sid") : void 0,
    browserUrl: payload ? readString2(payload, "url") ?? readString2(payload, "browser_url") ?? readString2(payload, "browserUrl") : void 0,
    expiresAt: payload ? readString2(payload, "expiresAt") ?? readString2(payload, "expires_at") : void 0
  };
}
async function pollStepupSession(config, sid) {
  const trimmed = sid?.trim();
  if (!trimmed) {
    throw new Error("sid is required");
  }
  const envelope = await request(config, {
    method: "GET",
    path: `${STEPUP_PATH}/${encodeURIComponent(trimmed)}`
  });
  const payload = readStepupPayload(envelope);
  return {
    envelope,
    status: payload ? readString2(payload, "status") : void 0
  };
}
async function pollStepupSessionWait(config, sid, options = {}) {
  const trimmed = sid?.trim();
  if (!trimmed) {
    throw new Error("sid is required");
  }
  const maxWaitMs = options.maxWaitMs ?? 6e4;
  const intervalMs = options.intervalMs ?? 1e3;
  const deadline = Date.now() + maxWaitMs;
  let attempts = 0;
  let lastEnvelope;
  while (true) {
    attempts += 1;
    const result = await pollStepupSession(config, trimmed);
    lastEnvelope = result.envelope;
    if (result.status === "verified") {
      return {
        envelope: result.envelope,
        outcome: "verified",
        elapsedMs: maxWaitMs - Math.max(0, deadline - Date.now()),
        attempts
      };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return {
        envelope: lastEnvelope,
        outcome: "timeout",
        elapsedMs: maxWaitMs - Math.max(0, remaining),
        attempts
      };
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
}

// ../../private-packages/stepup-core/dist/gate.js
var BROWSER_LOCK_TTL_MS = 15e3;
var BROWSER_LOCK_FILE = "stepup-browser-lock.json";
function fingerprintOf(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
function claimBrowserLaunch(fingerprintKey) {
  migrateLegacyFile(BROWSER_LOCK_FILE, "cache");
  const lockFile = path7.join(cacheDir(), BROWSER_LOCK_FILE);
  const fingerprint = fingerprintOf(fingerprintKey);
  try {
    const raw = readFileSync6(lockFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed;
      const sameCommand = obj.fingerprint === fingerprint;
      const openedAt = typeof obj.openedAt === "number" ? obj.openedAt : 0;
      if (sameCommand && Date.now() - openedAt < BROWSER_LOCK_TTL_MS) {
        return false;
      }
    }
  } catch {
  }
  try {
    mkdirSync7(path7.dirname(lockFile), { recursive: true });
    writeFileSync6(lockFile, JSON.stringify({ fingerprint, openedAt: Date.now() }), { mode: 384 });
  } catch {
  }
  return true;
}
function openBrowser(url) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(opener, args, {
      stdio: "ignore",
      detached: true
    });
    child.on("error", () => {
    });
    child.unref();
  } catch {
  }
}
async function requestStepup(input) {
  if (!resolveToken().token) {
    return { ok: false, reason: "no-token" };
  }
  let config;
  try {
    config = loadStepupConfig();
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      detail: err instanceof Error ? err.message : String(err)
    };
  }
  let created;
  try {
    created = await createStepupSession(config, {
      comment: input.comment ?? `Confirm ${input.reason}`,
      action: input.action,
      resource: input.resource
    });
  } catch (err) {
    return {
      ok: false,
      reason: "create-failed",
      detail: err instanceof Error ? err.message : String(err)
    };
  }
  if (!created.envelope.ok || !created.sid || !created.browserUrl) {
    return {
      ok: false,
      reason: "create-failed",
      detail: `backend rejected create_stepup_session (status ${created.envelope.status})`
    };
  }
  const launched = claimBrowserLaunch(input.fingerprintKey);
  if (launched) {
    openBrowser(created.browserUrl);
  }
  return {
    ok: true,
    sid: created.sid,
    browserUrl: created.browserUrl,
    expiresAt: created.expiresAt,
    launched
  };
}

// ../../private-packages/stepup-core/dist/evaluate.js
function checkPatternMatch(command) {
  const hit = findFirstMatch(command, loadMergedPatterns());
  if (!hit)
    return null;
  const { source, id, reason } = hit.matched;
  return {
    reason: `matched ${source} pattern \`${id}\` \u2014 ${reason}`,
    command
  };
}
function extractRmTargets(command) {
  const tokens = command.trim().split(/\s+/);
  const rmIdx = tokens.indexOf("rm");
  if (rmIdx === -1)
    return null;
  let i = rmIdx + 1;
  let recursive = false;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "--") {
      i++;
      break;
    }
    if (t.startsWith("-") && /^-[a-zA-Z]+$/.test(t)) {
      if (/[rR]/.test(t))
        recursive = true;
      i++;
      continue;
    }
    break;
  }
  if (!recursive)
    return null;
  const targets = tokens.slice(i).filter((t) => !t.startsWith("-"));
  return targets.length > 0 ? targets : null;
}
function checkTargetGitTracked(target, cwd) {
  if (/[*?{[]/.test(target))
    return null;
  const abs = path8.resolve(cwd, target);
  let toplevel;
  try {
    toplevel = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
  const rel = path8.relative(toplevel, abs);
  if (rel.startsWith("..") || path8.isAbsolute(rel))
    return null;
  let tracked;
  try {
    const out = execFileSync("git", ["-C", toplevel, "ls-files", "--", rel || "."], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    tracked = out.split("\n").filter(Boolean);
  } catch {
    return null;
  }
  if (tracked.length === 0)
    return null;
  return {
    target,
    trackedCount: tracked.length,
    samples: tracked.slice(0, 3)
  };
}
function checkRmGitTracked(command, cwd) {
  const targets = extractRmTargets(command);
  if (!targets)
    return null;
  const hits = [];
  for (const target of targets) {
    const check = checkTargetGitTracked(target, cwd);
    if (check)
      hits.push(check);
  }
  if (hits.length === 0)
    return null;
  const totalFiles = hits.reduce((a, h) => a + h.trackedCount, 0);
  return {
    reason: `rm -rf would delete ${totalFiles} file(s) tracked in git`,
    details: hits.map((h) => {
      const more = h.trackedCount > h.samples.length ? `, +${h.trackedCount - h.samples.length} more` : "";
      return `${h.target} \u2014 ${h.trackedCount} tracked file(s): ${h.samples.join(", ")}${more}`;
    }),
    command
  };
}
function stringifyToolInput(input) {
  try {
    const s = JSON.stringify(input);
    if (s === void 0)
      return "[unserializable]";
    return s.length > 200 ? s.slice(0, 197) + "..." : s;
  } catch {
    return "[unserializable]";
  }
}
function classifyToolCall(input) {
  if (input.toolName === "Bash" || input.toolName === "run_command" || input.toolName === "Shell") {
    const cmd = input.toolInput?.command;
    if (typeof cmd !== "string")
      return null;
    return { kind: "bash", command: cmd, cwd: input.cwd };
  }
  const rules = loadMergedToolRules();
  const match = findFirstToolRule(input.toolName, rules);
  if (!match)
    return null;
  return {
    kind: "mcp",
    toolName: input.toolName,
    toolInput: input.toolInput,
    rule: match.matched
  };
}
async function evaluatePreToolUse(input) {
  if (!isTrackerEnabled()) {
    return { kind: "pass" };
  }
  let classified;
  try {
    classified = classifyToolCall(input);
  } catch {
    return { kind: "pass" };
  }
  if (!classified)
    return { kind: "pass" };
  const block = classified.kind === "bash" ? checkPatternMatch(classified.command) ?? checkRmGitTracked(classified.command, classified.cwd) : {
    reason: `matched ${classified.rule.source} tool-rule \`${classified.rule.id}\` \u2014 ${classified.rule.reason}`,
    command: `${classified.toolName} ${stringifyToolInput(classified.toolInput)}`
  };
  if (!block)
    return { kind: "pass" };
  if (readVerified()) {
    const consumeHere = classified.kind === "bash" || classified.rule.consume_in_hook === true;
    return { kind: "allow", block, consumeHere };
  }
  if (!resolveToken().token) {
    return { kind: "deny-no-token", block };
  }
  const gateInput = classified.kind === "bash" ? {
    reason: block.reason,
    action: "bash_exec",
    resource: "transcodes-guard:pre-tool-use",
    fingerprintKey: classified.command,
    comment: `Confirm danger command: ${block.reason}`
  } : {
    reason: block.reason,
    action: classified.rule.stepupAction,
    resource: classified.rule.stepupResource,
    fingerprintKey: `${classified.toolName}:${JSON.stringify(classified.toolInput)}`,
    comment: `Confirm ${classified.rule.id}: ${classified.rule.reason}`
  };
  const req = await requestStepup(gateInput);
  if (!req.ok) {
    return { kind: "deny-stepup-failure", block, failure: req };
  }
  const pending = {
    sid: req.sid,
    command: block.command,
    reason: block.reason,
    browserUrl: req.browserUrl,
    createdAt: Date.now(),
    expiresAt: req.expiresAt,
    status: "pending"
  };
  return {
    kind: "deny-stepup-pending",
    block,
    sid: req.sid,
    browserUrl: req.browserUrl,
    browserLaunched: req.launched,
    pending
  };
}

// ../../private-packages/stepup-core/dist/messages.js
function formatNoTokenSessionNotice() {
  return [
    "transcodes-guard: no Transcodes token is configured.",
    "Danger commands will be BLOCKED and step-up MFA cannot start until a token is set.",
    "",
    "How to fix (guide the user \u2014 the token must NOT be pasted into this chat,",
    "it would leak into the transcript):",
    "  1. Get the token from the Transcodes console \u2192 member detail page:",
    "       https://app.transcodes.io",
    "  2. In a terminal, run this ONCE:",
    "       npx @bigstrider/transcodes-cli login <token>",
    "     (saves it to ~/.transcodes/config.json so every agent session can find it)",
    "",
    "Alternatively, set the TRANSCODES_TOKEN environment variable before launching",
    "the host (note: GUI-launched apps often do NOT inherit your shell env, so the",
    "CLI login above is the more reliable option)."
  ].join("\n");
}
function formatBlockedSummary(block) {
  return [
    "\u26D4 BLOCKED \u2014 Bash was NOT executed.",
    "",
    `Reason : ${block.reason}`,
    ...block.details && block.details.length > 0 ? ["", "Affected:", ...block.details.map((d) => `  - ${d}`)] : [],
    `Command: ${block.command}`
  ].join("\n");
}
function formatAllowReason(decision) {
  return `transcodes-guard: step-up MFA verified \u2014 overriding default permission policy. Original danger match: ${decision.block.reason}. Command: ${decision.block.command}`;
}
function formatNoTokenReason(block) {
  return `Bash blocked by transcodes-guard: ${block.reason}. Step-up MFA gate is not configured (no Transcodes token found). Tell the user to get a token from the Transcodes console (member detail page, https://app.transcodes.io) and run \`transcodes login <token>\` (or set the TRANSCODES_TOKEN environment variable) to enable on-demand authentication, or run the command outside the agent.`;
}
function formatNoTokenSystemMessage(block) {
  return `${formatBlockedSummary(block)}

Step-up MFA gate is not configured (no Transcodes token found).
Get a token from the Transcodes console \u2192 member detail page (https://app.transcodes.io),
then ask the user to run \`transcodes login <token>\` in a terminal (or set TRANSCODES_TOKEN),
and retry. Do not have the user paste the token into this chat.`;
}
function formatStepupFailureDetail(decision) {
  const { failure } = decision;
  return failure.reason === "no-token" ? "No Transcodes token found \u2014 step-up MFA gate is unavailable. Get a token from the Transcodes console (https://app.transcodes.io member detail page), then run `transcodes login <token>`." : failure.reason === "create-failed" ? `Step-up MFA session could not be started${failure.detail ? ` (${failure.detail})` : ""}.` : `Step-up MFA gate errored${failure.detail ? ` (${failure.detail})` : ""}.`;
}
function formatStepupFailureReason(decision) {
  return `Bash blocked by transcodes-guard: ${decision.block.reason}. ${formatStepupFailureDetail(decision)} Report the failure to the user; do not retry until step-up is available.`;
}
function formatStepupFailureSystemMessage(decision) {
  return `${formatBlockedSummary(decision.block)}

${formatStepupFailureDetail(decision)}`;
}
function formatStepupPendingReason(decision) {
  return `Step-up MFA pending. sid=${decision.sid}. Open ${decision.browserUrl}, complete WebAuthn, then call MCP tool \`poll_stepup_session_wait\` with sid="${decision.sid}" and retry the same Bash command.`;
}
function formatStepupPendingSystemMessage(decision) {
  const launchLine = decision.browserLaunched ? "A browser tab has been opened automatically:" : "A concurrent hook process already opened a tab \u2014 reuse it:";
  return [
    "\u{1F510} BLOCKED \u2014 Step-up MFA required. This Bash command was NOT executed.",
    "",
    `Reason : ${decision.block.reason}`,
    `Command: ${decision.block.command}`,
    "",
    launchLine,
    `  ${decision.browserUrl}`,
    "",
    `Session id: ${decision.sid}`,
    "",
    "Agent \u2014 drive the step-up loop (do this WITHOUT asking the user for confirmation):",
    "  1. Tell the user (one short line) to complete WebAuthn in the opened tab (paste the URL above if it did not open).",
    `  2. Immediately call the MCP tool \`poll_stepup_session_wait\` with sid="${decision.sid}". It blocks until verified or 60s timeout \u2014 one call replaces the polling loop.`,
    '  3. On `outcome: "verified"` retry the SAME Bash command \u2014 the hook detects the verified state and allows it. On `outcome: "timeout"` ask the user to retry WebAuthn, then call the wait tool again.'
  ].join("\n");
}
function formatStderrTag(decision) {
  switch (decision.kind) {
    case "pass":
      return "transcodes-guard: pass";
    case "allow":
      return `transcodes-guard: ALLOWED (stepup-verified) \u2014 ${decision.block.command}`;
    case "deny-no-token":
      return `transcodes-guard: BLOCKED (no token) \u2014 ${decision.block.command}`;
    case "deny-stepup-failure":
      return `transcodes-guard: BLOCKED (stepup-failure) \u2014 ${decision.block.command}`;
    case "deny-stepup-pending":
      return `transcodes-guard: STEPUP-PENDING sid=${decision.sid} \u2014 ${decision.block.command}`;
  }
}

// ../../private-packages/stepup-core/dist/inspector.js
import { readFileSync as readFileSync7 } from "fs";
import path9 from "path";
var VERIFIED_FILE = "stepup-verified.json";
var PENDING_FILE = "stepup-pending.json";
var BROWSER_LOCK_FILE2 = "stepup-browser-lock.json";
var BROWSER_LOCK_TTL_MS2 = 15e3;
var COMMAND_PREVIEW_LIMIT = 120;
function readJsonFile(file) {
  try {
    const raw = readFileSync7(file, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }
  return null;
}
function previewCommand(command) {
  if (command.length <= COMMAND_PREVIEW_LIMIT)
    return command;
  return `${command.slice(0, COMMAND_PREVIEW_LIMIT)}\u2026`;
}
function inspectVerified(now) {
  const file = path9.join(cacheDir(), VERIFIED_FILE);
  const data = readJsonFile(file);
  if (!data)
    return { exists: false };
  const sid = typeof data.sid === "string" ? data.sid : null;
  const verifiedAt = typeof data.verifiedAt === "number" ? data.verifiedAt : null;
  if (!sid || verifiedAt === null)
    return { exists: false };
  const ageMs = now - verifiedAt;
  return {
    exists: true,
    sid,
    verified_at_ms: verifiedAt,
    age_ms: ageMs,
    expired: ageMs > STEPUP_TTL_MS,
    ttl_ms: STEPUP_TTL_MS
  };
}
function inspectPending(now) {
  const file = path9.join(cacheDir(), PENDING_FILE);
  const data = readJsonFile(file);
  if (!data)
    return { exists: false };
  const sid = typeof data.sid === "string" ? data.sid : null;
  const status = data.status === "verified" || data.status === "pending" ? data.status : null;
  const createdAt = typeof data.createdAt === "number" ? data.createdAt : null;
  const command = typeof data.command === "string" ? data.command : null;
  const browserUrl = typeof data.browserUrl === "string" ? data.browserUrl : "";
  if (!sid || !status || createdAt === null || command === null) {
    return { exists: false };
  }
  const ageMs = now - createdAt;
  const expiresAt = typeof data.expiresAt === "string" ? data.expiresAt : void 0;
  let expired = ageMs > STEPUP_TTL_MS;
  if (expiresAt) {
    const t = Date.parse(expiresAt);
    if (Number.isFinite(t))
      expired = now >= t;
  }
  return {
    exists: true,
    sid,
    status,
    command_preview: previewCommand(command),
    browser_url: browserUrl,
    created_at_ms: createdAt,
    age_ms: ageMs,
    expired,
    expires_at: expiresAt
  };
}
function inspectBrowserLock(now) {
  const file = path9.join(cacheDir(), BROWSER_LOCK_FILE2);
  const data = readJsonFile(file);
  if (!data)
    return { exists: false };
  const fingerprint = typeof data.fingerprint === "string" ? data.fingerprint : null;
  const openedAt = typeof data.openedAt === "number" ? data.openedAt : null;
  if (!fingerprint || openedAt === null)
    return { exists: false };
  const ageMs = now - openedAt;
  return {
    exists: true,
    fingerprint,
    opened_at_ms: openedAt,
    age_ms: ageMs,
    expired: ageMs > BROWSER_LOCK_TTL_MS2,
    ttl_ms: BROWSER_LOCK_TTL_MS2
  };
}
function inspectStepupState(now = Date.now()) {
  migrateLegacyFile(VERIFIED_FILE, "cache");
  migrateLegacyFile(PENDING_FILE, "cache");
  migrateLegacyFile(BROWSER_LOCK_FILE2, "cache");
  return {
    cache_dir: cacheDir(),
    now_ms: now,
    verified: inspectVerified(now),
    pending: inspectPending(now),
    browser_lock: inspectBrowserLock(now)
  };
}

export {
  getUserPatternsPath,
  loadMergedPatterns,
  findFirstMatch,
  PatternValidationError,
  addUserPattern,
  updateUserPattern,
  removeUserPattern,
  getUserToolRulesPath,
  loadMergedToolRules,
  findFirstToolRule,
  ToolRuleValidationError,
  addUserToolRule,
  updateUserToolRule,
  removeUserToolRule,
  parseMemberAccessToken,
  transcodesConfigFile,
  isTrackerEnabled,
  setTrackerEnabled,
  resolveToken,
  loadStepupConfig,
  request,
  createStepupSession,
  pollStepupSession,
  pollStepupSessionWait,
  readVerified,
  writeVerified,
  consumeVerified,
  readPending,
  writePending,
  clearPending,
  markVerified,
  isExpired,
  inspectStepupState,
  evaluatePreToolUse,
  formatNoTokenSessionNotice,
  formatAllowReason,
  formatNoTokenReason,
  formatNoTokenSystemMessage,
  formatStepupFailureReason,
  formatStepupFailureSystemMessage,
  formatStepupPendingReason,
  formatStepupPendingSystemMessage,
  formatStderrTag
};
