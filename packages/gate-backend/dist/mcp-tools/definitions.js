import { auditToolDefinitions } from './audit.js';
import { authDeviceToolDefinitions } from './auth-devices.js';
import { jwkToolDefinitions } from './jwk.js';
import { memberToolDefinitions } from './members.js';
import { membershipToolDefinitions } from './membership.js';
import { metaToolDefinitions } from './meta.js';
import { organizationToolDefinitions } from './organization.js';
import { passcodeToolDefinitions } from './passcode.js';
import { projectToolDefinitions } from './project.js';
import { rbacToolDefinitions } from './rbac.js';
export const backendToolDefinitions = [
    ...memberToolDefinitions,
    ...rbacToolDefinitions,
    ...passcodeToolDefinitions,
    ...projectToolDefinitions,
    ...auditToolDefinitions,
    ...authDeviceToolDefinitions,
    ...membershipToolDefinitions,
    ...metaToolDefinitions,
    ...organizationToolDefinitions,
    ...jwkToolDefinitions,
];
//# sourceMappingURL=definitions.js.map