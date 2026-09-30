/**
 * Agent Registry — Maps agentId → system prompt & metadata
 * All 30 slave agents defined here. Plugs into agent-runner.ts.
 */

export interface AgentMeta {
  id: string;
  name: string;
  role: string;
  description: string;
  pod: string;
}

export const AGENT_REGISTRY: AgentMeta[] = [
  // ─── CALLING POD ─────────────────────────────────────────────────────────────
  {
    id: 'voice-agent',
    name: 'Voice Agent',
    role: 'Outbound Calling & Telephony',
    description: 'Places outbound AI phone calls, leaves voicemails, and manages call transcripts via Twilio.',
    pod: 'calling',
  },
  {
    id: 'outbound-calling-agent',
    name: 'Outbound Calling Agent',
    role: 'Outbound Telephony & Voice Follow-Up',
    description: 'Autonomous outbound telephone calling agent with live speech synthesis via Twilio.',
    pod: 'calling',
  },
  {
    id: 'receptionist-agent',
    name: 'Receptionist Agent',
    role: 'Front-Desk AI & Call Processing',
    description: 'Processes inbound call transcripts, captures patient/lead info, and routes queries.',
    pod: 'calling',
  },

  // ─── MAIL POD ─────────────────────────────────────────────────────────────────
  {
    id: 'follow-up-agent',
    name: 'Follow-up Agent',
    role: 'Email Follow-up & Re-engagement',
    description: 'Sends personalized follow-up emails for quiet leads or inactive patients.',
    pod: 'mail',
  },
  {
    id: 'lead-concierge',
    name: 'Lead Concierge',
    role: 'Inbound Lead Engagement',
    description: 'Processes inbound inquiries, qualifies intent, and initiates the engagement journey.',
    pod: 'mail',
  },
  {
    id: 'lead-qualifier',
    name: 'Lead Qualifier',
    role: 'Lead Scoring & Qualification',
    description: 'Evaluates leads for budget, urgency, and service fit before handoff to booking.',
    pod: 'mail',
  },
  {
    id: 'sms-concierge',
    name: 'SMS Concierge',
    role: 'SMS Communication',
    description: 'Sends targeted SMS messages for reminders, confirmations, and re-engagement.',
    pod: 'mail',
  },
  {
    id: 'whatsapp-concierge',
    name: 'WhatsApp Concierge',
    role: 'WhatsApp Messaging',
    description: 'Manages WhatsApp outreach via Twilio WhatsApp channel.',
    pod: 'mail',
  },
  {
    id: 'web-concierge',
    name: 'Web Concierge',
    role: 'Website & Chat Engagement',
    description: 'Handles website chat inquiries, FAQs, and online lead capture.',
    pod: 'mail',
  },

  // ─── MARKETING POD ────────────────────────────────────────────────────────────
  {
    id: 'campaign-agent',
    name: 'Campaign Agent',
    role: 'Marketing Campaign Management',
    description: 'Designs and executes multi-channel marketing campaigns and tracks ROI.',
    pod: 'marketing',
  },
  {
    id: 'reactivation-agent',
    name: 'Reactivation Agent',
    role: 'Dormant Patient Re-engagement',
    description: 'Identifies inactive patients (90+ days) and triggers personalized win-back campaigns.',
    pod: 'marketing',
  },
  {
    id: 'review-agent',
    name: 'Review Agent',
    role: 'Reputation & Review Collection',
    description: 'Sends review request messages and tracks Google Business Profile ratings.',
    pod: 'marketing',
  },
  {
    id: 'referral-agent',
    name: 'Referral Agent',
    role: 'Referral Program Management',
    description: 'Manages patient referral programs and sends referral incentive communications.',
    pod: 'marketing',
  },
  {
    id: 'growth-analyst',
    name: 'Growth Analyst',
    role: 'Business Intelligence & Analytics',
    description: 'Analyzes patient data, revenue trends, and growth opportunities. Generates reports.',
    pod: 'marketing',
  },

  // ─── CRM SIGNAL POD ───────────────────────────────────────────────────────────
  {
    id: 'crm-agent',
    name: 'CRM Agent',
    role: 'CRM Data Management',
    description: 'Manages contact logs, CRM records, interaction history, and lead pipelines.',
    pod: 'crm',
  },
  {
    id: 'lead-recovery-agent',
    name: 'Lead Recovery Agent',
    role: 'Lost Lead Recovery',
    description: 'Re-engages leads that went cold or ghosted during the sales funnel.',
    pod: 'crm',
  },
  {
    id: 'booking-agent',
    name: 'Booking Agent',
    role: 'Calendar & Reservations',
    description: 'Proposes available slots, manages Google Calendar integration, and confirms appointments.',
    pod: 'crm',
  },
  {
    id: 'no-show-prevention-agent',
    name: 'No-Show Prevention Agent',
    role: 'Appointment Confirmation & Reminder',
    description: 'Sends pre-appointment reminders and manages no-show risk mitigation.',
    pod: 'crm',
  },
  {
    id: 'cancellation-recovery-agent',
    name: 'Cancellation Recovery Agent',
    role: 'Cancellation Management & Recovery',
    description: 'Processes cancellations, offers alternatives, and attempts to recover the booking.',
    pod: 'crm',
  },
  {
    id: 'waitlist-agent',
    name: 'Waitlist Agent',
    role: 'Waitlist Management',
    description: 'Manages appointment waitlists and fills cancellation slots automatically.',
    pod: 'crm',
  },
  {
    id: 'rebooking-agent',
    name: 'Rebooking Agent',
    role: 'Proactive Rebooking',
    description: 'Proactively schedules next appointments before the patient leaves or goes quiet.',
    pod: 'crm',
  },
  {
    id: 'membership-agent',
    name: 'Membership Agent',
    role: 'Membership & Subscription Management',
    description: 'Handles membership enrollment, renewals, upgrades, and retention campaigns.',
    pod: 'crm',
  },
  {
    id: 'upsell-agent',
    name: 'Upsell Agent',
    role: 'Revenue Upsell & Cross-sell',
    description: 'Identifies upsell and cross-sell opportunities and presents them to patients.',
    pod: 'crm',
  },
  {
    id: 'revenue-recovery-agent',
    name: 'Revenue Recovery Agent',
    role: 'Revenue Recovery & Collections',
    description: 'Follows up on outstanding balances and manages payment recovery workflows.',
    pod: 'crm',
  },
  {
    id: 'treatment-advisor',
    name: 'Treatment Advisor',
    role: 'Treatment Information & Advisory',
    description: 'Provides detailed information about services, treatments, and clinical offerings.',
    pod: 'crm',
  },
  {
    id: 'patient-concierge',
    name: 'Patient Concierge',
    role: 'Patient Relationship Management',
    description: 'Manages the overall patient experience, from onboarding to ongoing care coordination.',
    pod: 'crm',
  },
  {
    id: 'post-treatment-agent',
    name: 'Post-Treatment Agent',
    role: 'After-Care & Recovery Support',
    description: 'Delivers post-treatment care instructions, checks on patient recovery, and schedules follow-ups.',
    pod: 'crm',
  },
  {
    id: 'front-desk-copilot',
    name: 'Front Desk Copilot',
    role: 'Staff AI Assistant',
    description: 'Assists front desk staff with AI-powered scheduling, inquiry handling, and patient communication.',
    pod: 'crm',
  },
  {
    id: 'emr-ehr-integration-agent',
    name: 'EMR/EHR Integration Agent',
    role: 'EMR/EHR Data Sync',
    description: 'Handles EMR/EHR data sync, appointment creation in clinical systems, and record retrieval.',
    pod: 'crm',
  },
  {
    id: 'integration-guardian',
    name: 'Integration Guardian',
    role: 'System Health & Integration Monitoring',
    description: 'Monitors third-party integrations (Twilio, Google, Stripe, EMR), alerts on failures.',
    pod: 'crm',
  },
];

// Fast lookup by agentId
const REGISTRY_MAP = new Map(AGENT_REGISTRY.map((a) => [a.id, a]));

export function getAgentMeta(agentId: string): AgentMeta | undefined {
  return REGISTRY_MAP.get(agentId);
}

export function getAllAgents(): AgentMeta[] {
  return AGENT_REGISTRY;
}

export function getAgentsByPod(pod: string): AgentMeta[] {
  return AGENT_REGISTRY.filter((a) => a.pod === pod);
}

/**
 * Returns the Mastra-compatible system prompt for a given agentId.
 */
export function getAgentSystemPrompt(agentId: string, tenantContext: string): string {
  const meta = REGISTRY_MAP.get(agentId);
  const name = meta?.name ?? agentId;
  const role = meta?.role ?? 'AI Specialist';
  const desc = meta?.description ?? 'You are a specialized AI agent.';

  let voiceDirectives = '';
  if (agentId === 'voice-agent' || agentId === 'outbound-calling-agent') {
    voiceDirectives = `
TELEPHONE CALL SCRIPT RULES (MANDATORY):
- 'messageToUser' is the ACTUAL SPOKEN VOICE SCRIPT that will be converted to speech (TTS) and spoken into the telephone to the person who answers!
- Speak directly to the recipient answering the phone in a warm, professional tone ("Hello, I am calling from [Business Name] regarding...").
- Warmly introduce the business and deliver the exact purpose/message requested (e.g. appointment booking confirmation, schedule reminder).
- NEVER say "I will call", "Calling the number", "I will proceed to...", or describe what you are about to do.
- NEVER speak, recite, or repeat any phone numbers or digits! The person answering already knows their phone number. Do not read their phone number to them.
- Keep the script clear, polite, concise, and natural for telephone speech.`;
  }

  return `You are the ${name} — ${role} — for the following business:
---
BUSINESS CONTEXT:
${tenantContext}
---

YOUR ROLE: ${desc}
${voiceDirectives}

CORE DIRECTIVES:
1. Autonomous Workforce: You ARE the automated AI operations engine for this business. When asked to process emails, schedule appointments, or draft feedback, execute the task directly. Never refuse or tell the user to contact administrative staff, because you are that automation.
2. Inbound Emails & Calendar Scheduling: When instructed to process customer emails (e.g. "read my first 5 emails") and reschedule them on Google Calendar, process the 5 patient cases, assign the Google Calendar appointment times, and prepare the exact confirmation feedback requested.
3. Tenant Scope: All actions must be scoped to the current tenant business context.
4. PHI Compliance: Never log or repeat sensitive personal health information unnecessarily.
5. Structured Output: Always produce a complete, structured response adhering to the schema with messageToUser, capturedData, and chainOfThought.

DELEGATION RULES:
- 'lead-concierge': Inbound lead / initial email engagement and parsing.
- 'voice-agent': Outbound phone calls and voice conversations.
- 'sms-concierge': SMS text message communication.
- 'whatsapp-concierge': WhatsApp chat outreach.
- 'booking-agent': Scheduling, calendar slots & appointment management.
- 'follow-up-agent': Composing confirmation emails, follow-ups, and customer feedback.
- 'receptionist-agent': Processing call transcripts & front-desk inquiries.
- 'review-agent': Collecting feedback and review requests.
- 'crm-agent': Managing contact logs and notes.
- 'none': Task is complete, no handoff needed.`;
}
