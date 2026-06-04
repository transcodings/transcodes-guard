import type { StepupConfig } from "./config.js";
export type RbacLevel = 0 | 1 | 2;
export declare function checkRbacPermission(config: StepupConfig, resource: string, action: string): Promise<RbacLevel | null>;
