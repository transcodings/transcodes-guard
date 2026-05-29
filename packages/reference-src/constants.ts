/**
 * SDK 내부 기본값.
 *
 * `DEFAULT_BACKEND_URL` 는 `TRANSCODES_BACKEND_URL` env 로 override 할 수 있지만,
 * `DEFAULT_ENDPOINT_MAP` 은 SDK 내부 구현 상수로 **고정**됨. MCP tool 이름 → API
 * 경로 매핑은 라이브러리 본인의 인터페이스 계약이므로 런타임에서 바꿀 이유가 없음.
 *
 * 이 값들은 과거(v1.x) GitHub Actions release workflow 가 빌드 시점에 소스
 * 파일에 문자열 치환으로 주입하던 것과 동일한 값. THT-260 에서 CI 치환을 제거하고
 * 동일한 값을 레포 내 상수로 옮겨 (1) `TRANSCODES_BACKEND_URL` runtime override 가
 * 실제로 동작하고 (2) 레포에서 값이 visible 해 유지보수가 가능해짐.
 *
 * Override 예시 (dev):
 *   TRANSCODES_BACKEND_URL=http://localhost:3500
 */

export const DEFAULT_BACKEND_URL = 'https://api.transcodesapis.com';

/**
 * MCP tool 이름 → `/v1` 뒤 API path 맵.
 * 경로 `"*"` 는 내장 tool (백엔드 호출 없음) 을 의미.
 * `config.ts` 의 `loadConfig()` 에서 Map 으로 변환됨.
 */
export const DEFAULT_ENDPOINT_MAP: Readonly<Record<string, string>> = {
  // Meta / built-in tools (경로 없음)
  get_integration_guide: '*',
  // 콘솔 URL 반환 — passkey/authenticator/TOTP 등 브라우저 전용 액션 안내용
  get_console_url: '*',

  // Project
  get_project: '/project',

  // Audit
  get_security_logs: '/audit/logs',

  // Members
  get_member: '/auth/member',
  list_members_paginated: '/auth/members/list',
  list_member_devices: '/auth/members/devices',
  create_member: '/auth/member',
  update_member: '/auth/member',
  retire_member: '/auth/member',
  get_member_suspension: '/auth/member/revocation',
  suspend_member: '/auth/member/revocation',
  unsuspend_member: '/auth/member/revocation',

  // Auth devices — authenticators
  get_authenticator: '/auth/authenticator',
  list_authenticators: '/auth/authenticators',

  // Auth devices — passkeys
  list_passkeys: '/auth/passkeys',

  // Auth devices — TOTP
  list_totps: '/auth/totps',

  // OTP / passcode
  passcode_create: '/auth/passcode/create',

  // RBAC — roles
  get_roles: '/auth/roles',
  create_role: '/auth/role',
  update_role: '/auth/role',
  retire_role: '/auth/role',
  set_role_permissions: '/auth/role',
  update_member_role: '/auth/member/role',
  check_rbac_permission: '/auth/role/check-permission',

  // RBAC — resources
  get_resources: '/auth/resources',
  create_resource: '/auth/resources',
  update_resource: '/auth/resources',
  retire_resource: '/auth/resources',

  // Membership / billing
  membership_plans: '/membership/plans',
  membership_plans_limits: '/membership/plans/limits',
  membership_customer_status_by_project: '/membership/customer/status/project',
  membership_customer_status_by_organization:
    '/membership/customer/status/organization',
  membership_create_checkout_session: '/membership/mcp/session',

  // Step-up auth (temp session)
  create_stepup_session: '/auth/temp-session/step-up/session',
  poll_stepup_session: '/auth/temp-session/step-up/session',
};
