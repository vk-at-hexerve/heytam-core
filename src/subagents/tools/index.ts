/**
 * Subagent Tools Registry
 * Assembles all real-world tools per tenant and exports workflow utilities.
 */
import { createCommunicationTools } from './communication.tools.js';
import { createCalendarTools } from './calendar.tools.js';
import { createCrmTools } from './crm.tools.js';
import { createInboxTools } from './inbox.tools.js';
import type { TenantKeys } from '../schema.js';

export { createCommunicationTools } from './communication.tools.js';
export { createCalendarTools } from './calendar.tools.js';
export { createCrmTools } from './crm.tools.js';
export { createInboxTools } from './inbox.tools.js';

/**
 * Assemble the complete tool registry for a given tenant.
 * Returns all real-world tools wired with tenant credentials.
 */
export function createAgentTools(tenantKeys: TenantKeys) {
  return {
    ...createCommunicationTools(tenantKeys),
    ...createCalendarTools(tenantKeys),
    ...createCrmTools(tenantKeys),
    ...createInboxTools(tenantKeys),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
