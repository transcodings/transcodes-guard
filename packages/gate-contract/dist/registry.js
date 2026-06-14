import { denyByDefaultBackend } from './noop.js';
let current = null;
export function setGateBackend(backend) {
    current = backend;
}
export function getGateBackend() {
    return current ?? denyByDefaultBackend;
}
export function isGateBackendInstalled() {
    return current !== null;
}
//# sourceMappingURL=registry.js.map