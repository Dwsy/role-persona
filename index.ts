/**
 * role-persona — Pi Extension entry point.
 *
 * Pi discovers extensions by loading index.ts from directories in ~/.pi/agent/extensions/.
 * This file re-exports the adapter, which registers tools, commands, and events.
 *
 * Architecture:
 *   core/           — pure logic, zero Pi dep
 *   service/        — unified facade
 *   extensions/pi/  — Pi adapter (direct service via Pi SDK)
 *   transport/      — CLI, MCP, daemon
 */
export { default } from "./src/extensions/pi/adapter.ts";
