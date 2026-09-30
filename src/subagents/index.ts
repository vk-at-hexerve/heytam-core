/**
 * Subagents — Public API
 * Single entry point for the entire slave agent workforce.
 * Import this in mastra/index.ts and route handlers.
 */
export { dispatchWorkflow, dispatchSingleAgent, getAgentCatalog } from './engine/master-dispatcher.js';
export { suggestWorkflow, type SuggestedWorkflow, type WorkflowStep } from './engine/workflow-suggester.js';
export { AGENT_REGISTRY, getAgentMeta, getAllAgents, getAgentsByPod, type AgentMeta } from './engine/agent-registry.js';
export { executeSubagent, type AgentExecutionOptions } from './engine/agent-runner.js';
export { createAgentTools } from './tools/index.js';
export type { TenantKeys, AgentResult, HeavyDutyAgentOutput, AgentId } from './schema.js';
