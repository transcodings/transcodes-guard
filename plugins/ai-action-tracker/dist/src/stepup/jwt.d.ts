/**
 * Member MCP access token (JWT) parser.
 *
 * Copied from transcodes-mcp-server/src/token.ts (no behavioural changes).
 *
 * Policy:
 *   - Fatal (throw): payload cannot be decoded, missing oid/pid/mid,
 *                    missing/invalid/expired exp.
 *   - Warning: missing aud or aud not including transcodes-mcp,
 *              token shape that does not look like a JWT.
 *   - Signature verification is performed by the backend (x-transcodes-token).
 */
export declare const REQUIRED_AUDIENCE = "transcodes-mcp";
export type MemberTokenClaims = {
    organizationId: string;
    projectId: string;
    memberId: string;
    aud?: readonly string[];
    exp: number;
    iss?: string;
    jti?: string;
    iat?: number;
};
export type ParsedMemberToken = {
    raw: string;
    claims: MemberTokenClaims;
    warnings: readonly string[];
};
export declare function parseMemberAccessToken(rawToken: unknown): ParsedMemberToken;
