# HeyTam Core — Hosted Azure Kubernetes Service (AKS) Integration Guide

> **Production Cluster URL:** `http://20.241.243.241`  
> **Service Architecture:** Unified HeyTam Core v3.0.0 (Mastra AI Master Supervisor + 30 Autonomous Slave Agents)  
> **Cluster Environment:** Microsoft Azure Kubernetes Service (AKS) — `heytam-prod-aks`  
> **Audience:** Frontend Developers, Mobile App Engineers, External Integrators  
> **Protocol:** HTTP REST & Server-Sent Events (SSE)  
> **Target Audience:** Frontend Team for `multi-agent-app` and Custom Client Integrations  

---

## 1. Quick Start & Environment Setup

To connect any frontend application (Next.js, React, React Native, Vue, etc.) to the live hosted cluster, configure your environment variables:

### `.env.local` / `.env.production`
```env
NEXT_PUBLIC_BACKEND_URL=http://20.241.243.241
NEXT_PUBLIC_API_URL=http://20.241.243.241/api
```

### Health & Connectivity Verification
Test the live Kubernetes cluster from your terminal or browser:
```bash
curl -i http://20.241.243.241/health
```

**Expected Response (200 OK):**
```json
{
  "status": "ok",
  "service": "heytam-core",
  "role": "supervisor-and-slave-agents",
  "version": "3.0.0",
  "architecture": "unified-supervisor-workforce",
  "description": "HeyTam Core — Mastra AI Supervisor + 30 Slave Agent Workforce (unified in one service)",
  "agents": {
    "total": 30,
    "pods": ["calling", "mail", "marketing", "crm"]
  },
  "aiBackend": {
    "backend": "OPENAI",
    "model": "gpt-4o-mini",
    "configured": true
  }
}
```

---

## 2. API Endpoints Quick Reference

| Endpoint | Method | Auth Required | Purpose |
| :--- | :--- | :--- | :--- |
| `/health` | `GET` | No | Kubernetes liveness & basic health probe |
| `/api/system/health` | `GET` | No | Detailed health status (DB latency, OpenAI readiness, Agent Pods) |
| `/api/test/db` | `POST` | No | Database read/write sanity test ping |
| `/api/agents` | `GET` | No | Complete directory of all 30 slave agents categorized by pod |
| `/api/dispatch` | `POST` | Optional | Natural language multi-agent workflow planner & executor |
| `/api/agents/run/:agentId` | `POST` | Optional | Execute an individual slave agent directly with input & context |
| `/api/agents/run/master-orchestrator` | `POST` | Optional | Run the HeyTam Master Orchestrator directly from prompt |
| `/api/dispatch/calling` | `POST` | Optional | Fast-lane trigger for Calling Slave Pod (Voice Agent) |
| `/api/dispatch/mail` | `POST` | Optional | Fast-lane trigger for Mail Slave Pod (Follow-up Agent) |
| `/api/dispatch/marketing` | `POST` | Optional | Fast-lane trigger for Marketing Slave Pod (Campaign Agent) |
| `/api/dispatch/orchestrate` | `POST` | Optional | Execute workflow with automatic tenant context resolution |
| `/api/auth/register` | `POST` | No | Register a new business account and obtain JWT token |
| `/api/auth/login` | `POST` | No | Log in with email & password to obtain JWT token |
| `/api/auth/me` | `GET` | Yes | Retrieve profile & subscribed agent tools for current business |
| `/api/business/:businessId` | `GET` | Yes | Fetch business configuration and metadata |
| `/api/business/:businessId` | `PUT` | Yes | Update business profile, services, and tone |
| `/api/tools/:businessId` | `GET` | Yes | Get subscribed tool status for a business |
| `/api/tools/:businessId/toggle` | `POST` | Yes | Toggle activation status of an individual agent |
| `/api/tools/:businessId/configure` | `POST` | Yes | Save third-party credentials for an agent tool |
| `/api/workflows/:businessId` | `GET` | Yes | List all custom and template workflows for a business |
| `/api/workflows/:businessId` | `POST` | Yes | Create a new multi-agent automated workflow |
| `/api/workflows/:businessId/:workflowId/run` | `POST` | Yes | Launch asynchronous execution of a workflow |
| `/api/workflows/:businessId/runs` | `GET` | Yes | Fetch workflow execution history and observability runs |
| `/api/workflows/:businessId/run/:runId` | `GET` | Yes | Poll live status and execution logs of a workflow run |
| `/api/workflows/:businessId/run/:runId/stream`| `GET` | Yes | Server-Sent Events (SSE) stream for real-time execution steps |
| `/api/workflows/:businessId/suggest` | `POST` | Yes | Generate an AI suggested workflow pipeline from a natural prompt |
| `/api/integrations/:businessId` | `GET` | Yes | Retrieve configured credentials and integration status |
| `/api/integrations/:businessId` | `POST` | Yes | Save credentials (Twilio, SMTP, Google OAuth, GHL, HubSpot) |
| `/metrics` | `GET` | No | Prometheus telemetry metrics (HTTP request counts, durations) |

---

## 3. Authentication & Headers

Every tenant-scoped request should include standard JSON and authentication headers:

```http
Content-Type: application/json
Authorization: Bearer <JWT_TOKEN>
x-tenant-id: <BUSINESS_ID>
```

> **Note:** For on-demand or testing triggers via `/api/dispatch` and `/api/agents/run/:agentId`, passing `tenantId: "default"` or `tenantId: "<BUSINESS_ID>"` in the request body is also supported.

---

## 4. Workforce Directory (30 Slave Agents)

The backend exposes 30 specialized agents divided across 4 pods. Call `GET http://20.241.243.241/api/agents` to fetch this dynamically.

### Pod 1: Calling Pod (`calling`)
| Agent ID | Name | Role | Required Integration |
| :--- | :--- | :--- | :--- |
| `voice-agent` | Voice Agent | Outbound Calling & Telephony | Twilio Account SID, Auth Token, From Phone |
| `outbound-calling-agent` | Outbound Calling Agent | Autonomous Telephony & Speech | Twilio Account SID, Auth Token, From Phone |
| `receptionist-agent` | Receptionist Agent | Inbound Front-Desk Processing | AI Reasoning (No external keys required) |

### Pod 2: Mail Pod (`mail`)
| Agent ID | Name | Role | Required Integration |
| :--- | :--- | :--- | :--- |
| `follow-up-agent` | Follow-up Agent | Email Follow-up & Re-engagement | SMTP Host, Port, User, App-Password |
| `lead-concierge` | Lead Concierge | Inbound Lead Intake & FAQs | AI Reasoning (No external keys required) |
| `lead-qualifier` | Lead Qualifier | Intent, Budget & Urgency Scoring | AI Reasoning (No external keys required) |
| `sms-concierge` | SMS Concierge | SMS Outreach & Confirmations | Twilio Account SID, Auth Token, From Phone |
| `whatsapp-concierge` | WhatsApp Concierge | WhatsApp Messaging | Twilio WhatsApp Sender Number |
| `web-concierge` | Web Concierge | Website Chat & Lead Capture | AI Reasoning (No external keys required) |

### Pod 3: Marketing Pod (`marketing`)
| Agent ID | Name | Role | Required Integration |
| :--- | :--- | :--- | :--- |
| `campaign-agent` | Campaign Agent | Marketing Campaign Design | SMTP / Email or Twilio SMS |
| `reactivation-agent` | Reactivation Agent | Dormant Patient Win-Back | SMTP / Email or Twilio SMS |
| `review-agent` | Review Agent | Google Review Acceleration | SMTP / Email or Twilio SMS |
| `referral-agent` | Referral Agent | Referral Programs & Incentives | SMTP / Email or Twilio SMS |
| `growth-analyst` | Growth Analyst | Analytics & Performance Reports | AI Reasoning (No external keys required) |

### Pod 4: CRM Pod (`crm`)
| Agent ID | Name | Role | Required Integration |
| :--- | :--- | :--- | :--- |
| `crm-agent` | CRM Agent | Contact History & Note Logging | MongoDB Atlas (Built-in) / CRM Key |
| `lead-recovery-agent` | Lead Recovery Agent | Cold Lead Re-engagement | SMTP / Email or Twilio SMS |
| `booking-agent` | Booking Agent | Google Calendar Appointments | Google OAuth Refresh Token |
| `no-show-prevention-agent`| No-Show Prevention Agent | Appointment Reminders | SMTP / Email or Twilio SMS |
| `cancellation-recovery-agent`| Cancellation Recovery | Cancellation Rebooking | SMTP / Email or Twilio SMS |
| `waitlist-agent` | Waitlist Agent | Cancellation Slot Backfilling | SMTP / Email or Twilio SMS |
| `rebooking-agent` | Rebooking Agent | Proactive Future Booking | SMTP / Email or Twilio SMS |
| `membership-agent` | Membership Agent | Subscriptions & Renewals | SMTP / Email or Twilio SMS |
| `upsell-agent` | Upsell Agent | Treatment Recommendations | AI Reasoning (No external keys required) |
| `revenue-recovery-agent` | Revenue Recovery Agent | Outstanding Balances & Invoices | SMTP / Email or Twilio SMS |
| `treatment-advisor` | Treatment Advisor | Clinical Offerings & Advisory | AI Reasoning (No external keys required) |
| `patient-concierge` | Patient Concierge | Patient Care Coordination | SMTP / Email or Twilio SMS |
| `post-treatment-agent` | Post-Treatment Agent | After-Care Recovery Guidance | SMTP / Email or Twilio SMS |
| `front-desk-copilot` | Front Desk Copilot | Staff AI Scheduling Assistant | AI Reasoning (No external keys required) |
| `emr-ehr-integration-agent`| EMR/EHR Agent | Clinical Data Sync & Records | AI Reasoning (No external keys required) |
| `integration-guardian` | Integration Guardian | Health & Integration Monitor | Built-in Verification Check |

---

## 5. Core API Workflows & Payloads

### 5.1 Natural Language Master Supervisor Dispatch
Send any freeform operational prompt. The supervisor analyzes the request, generates an optimal workflow pipeline, checks tenant subscriptions, performs credential checks, and triggers the required slave agents.

`POST http://20.241.243.241/api/dispatch`

**Request Body:**
```json
{
  "prompt": "Call +15551234567 to confirm their appointment for tomorrow at 2 PM",
  "tenantId": "default",
  "tenantContext": "Beverly Hills Aesthetic MedSpa, Tone: Warm, Professional",
  "tenantKeys": {
    "twilioAccountSid": "ACxxxxxx",
    "twilioAuthToken": "xxxxxx",
    "twilioFromPhone": "+17372508034"
  }
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "runId": "4b679cb6-19e8-4e3b-8695-c4f87be8cb74",
  "tenantId": "default",
  "workflow": {
    "name": "Appointment Confirmation Call",
    "description": "Automated outbound phone confirmation",
    "trigger": "Direct On-Demand Trigger",
    "steps": [
      { "order": 1, "agentId": "voice-agent", "agentName": "Voice Agent" }
    ],
    "extractedTriggerData": {
      "recipientPhones": ["+15551234567"],
      "prompt": "Call +15551234567 to confirm appointment"
    }
  },
  "steps": [
    {
      "stepOrder": 1,
      "agentId": "voice-agent",
      "agentName": "Voice Agent",
      "status": "completed",
      "output": {
        "messageToUser": "Outbound call placed successfully.",
        "callSid": "CA1234567890abcdef"
      },
      "actionsExecuted": [
        "REAL: Outbound call placed to +15551234567 via Twilio (Call SID: CA1234567890abcdef)"
      ]
    }
  ],
  "finalOutput": "Successfully confirmed appointment with patient.",
  "status": "completed"
}
```

**Missing Credentials Response (Clear Guidance for Users):**
If an agent requires credentials that have not been provided, the supervisor safely blocks execution before attempting delivery and returns exact instructions:
```json
{
  "success": false,
  "status": "blocked",
  "finalOutput": "❌ Cannot execute Follow-up Agent — required credentials are not configured.\n\nMissing:\n  • SMTP / Gmail Credentials: needed to send real emails via SMTP or Gmail\n\nHow to fix:\n  → Agents → Configure → SMTP (Host, Port, Username, Password/App-Password)",
  "blockedAt": {
    "stepOrder": 1,
    "agentId": "follow-up-agent",
    "agentName": "Follow-up Agent (Email)",
    "missingCredentials": [
      {
        "label": "SMTP / Gmail Credentials",
        "purpose": "send real emails via SMTP or Gmail",
        "configPath": "Agents → Configure → SMTP",
        "requiredFields": ["smtpHost", "smtpUser", "smtpPass"]
      }
    ]
  }
}
```

---

### 5.2 Direct Slave Agent Runner
Execute a specific slave agent immediately with custom input.

`POST http://20.241.243.241/api/agents/run/:agentId`

**Example:** Triggering `lead-concierge`
`POST http://20.241.243.241/api/agents/run/lead-concierge`

**Request Body:**
```json
{
  "input": "Hi, what treatments do you offer for acne scarring and fine lines?",
  "tenantContext": "Beverly Hills Aesthetic MedSpa",
  "tenantKeys": {}
}
```

**Response (200 OK):**
```json
{
  "agentName": "Lead Concierge",
  "agentRole": "lead-concierge",
  "input": "Hi, what treatments do you offer for acne scarring and fine lines?",
  "output": {
    "chainOfThought": "Inquiry regarding treatment options for acne scarring and fine lines...",
    "messageToUser": "Thank you for reaching out! We specialize in advanced skin rejuvenation treatments such as Microneedling with PRP, fractional laser resurfacing, and chemical peels...",
    "capturedData": {
      "service": "acne scarring and fine lines"
    },
    "requiresHandoff": false,
    "targetAgent": "none"
  },
  "status": "success",
  "timestamp": "2026-10-05T04:46:57.783Z"
}
```

---

### 5.3 Workflows: Run & Real-Time SSE Stream

#### Launch Workflow Run
`POST http://20.241.243.241/api/workflows/:businessId/:workflowId/run`

**Request Body:**
```json
{
  "triggerData": {
    "recipientName": "Emily Johnson",
    "recipientEmail": "emily@example.com",
    "recipientPhone": "+15559876543",
    "service": "Laser Consultation"
  },
  "prompt": "Send welcome follow-up and schedule consultation"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "runId": "run_17900088921_x8q1",
  "status": "running",
  "message": "Workflow initiated"
}
```

#### Real-Time Server-Sent Events (SSE) Stream
Connect an `EventSource` to receive step-by-step progress updates in real-time as agents complete tasks:

```javascript
const eventSource = new EventSource(
  `http://20.241.243.241/api/workflows/${businessId}/run/${runId}/stream?token=${jwtToken}`
);

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Execution update:', data);

  if (data.status === 'completed' || data.status === 'failed' || data.status === 'blocked') {
    eventSource.close();
  }
};

eventSource.onerror = (err) => {
  console.error('SSE Error:', err);
  eventSource.close();
};
```

---

## 6. Frontend TypeScript Client Example

Here is a ready-to-use API client utility to drop directly into your frontend (`lib/heytamApi.ts`):

```typescript
// lib/heytamApi.ts
const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://20.241.243.241';

export interface DispatchRequest {
  prompt: string;
  tenantId?: string;
  tenantContext?: string;
  tenantKeys?: Record<string, string>;
}

export interface AgentCatalogResponse {
  success: boolean;
  total: number;
  agents: Array<{
    id: string;
    name: string;
    role: string;
    description: string;
    pod: 'calling' | 'mail' | 'marketing' | 'crm';
  }>;
  pods: Record<string, string[]>;
}

export async function fetchHealth() {
  const res = await fetch(`${BASE_URL}/health`);
  return res.json();
}

export async function fetchSystemHealth() {
  const res = await fetch(`${BASE_URL}/api/system/health`);
  return res.json();
}

export async function fetchAgentCatalog(): Promise<AgentCatalogResponse> {
  const res = await fetch(`${BASE_URL}/api/agents`);
  return res.json();
}

export async function dispatchWorkflow(payload: DispatchRequest, token?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (payload.tenantId) headers['x-tenant-id'] = payload.tenantId;

  const res = await fetch(`${BASE_URL}/api/dispatch`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function runSingleAgent(
  agentId: string,
  input: string,
  tenantContext?: string,
  tenantKeys?: Record<string, string>
) {
  const res = await fetch(`${BASE_URL}/api/agents/run/${agentId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, tenantContext, tenantKeys }),
  });
  return res.json();
}
```

---

## 7. Frontend Integration Checklist

- [x] **Hosted URL:** Ensure frontend requests point to `http://20.241.243.241`.
- [x] **CORS:** The hosted backend is configured with `Access-Control-Allow-Origin: *` and permits `Authorization`, `Content-Type`, and `x-tenant-id` headers.
- [x] **Health Check:** Test `GET http://20.241.243.241/health` on initial load.
- [x] **Agent Marketplace:** Query `GET http://20.241.243.241/api/agents` to display the active workforce catalog.
- [x] **Credentials Validation:** Display the `blockedAt.missingCredentials` warning banner if a user attempts a live call or email without configured API keys.
- [x] **Real-Time Visualizer:** Utilize the SSE endpoint `/api/workflows/:bizId/run/:runId/stream` or polling `/api/workflows/:bizId/run/:runId` to animate live agent execution nodes in your dashboard.
