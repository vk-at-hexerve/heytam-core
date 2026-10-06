/**
 * Subagent Orchestrator Engine — 30-Agent Intent & Subscription Router
 * Parses natural language into structured multi-agent workflows.
 * Powers the /api/dispatch/suggest, /api/workflows/:businessId/suggest, and orchestrator endpoints.
 *
 * SUBSCRIPTION AWARE:
 * - If all 30 agents are bought/subscribed (Enterprise or full suite): selects from all 30 specialized agents.
 * - If a specific subset of tools is subscribed: dynamically adapts each pipeline step to the active tools
 *   using compatible fallback mappings so workflows never fail with 402 payment errors.
 */

import { extractPhoneNumbers } from '../utils/phone-parser.js';
import { getAgentMeta } from './agent-registry.js';

export interface WorkflowStep {
  order: number;
  agentId: string;
  agentName: string;
}

export interface SuggestedWorkflow {
  name: string;
  description: string;
  trigger: string;
  steps: WorkflowStep[];
  explanation: string;
  extractedTriggerData?: {
    recipientEmail?: string;
    recipientName?: string;
    message?: string;
    subject?: string;
    service?: string;
    recipientPhone?: string;
    recipientPhones?: string[];
    prompt?: string;
  };
  subscriptionContext?: {
    allAgentsSubscribed: boolean;
    subscribedCount: number;
    adaptedSteps: boolean;
    requiredActivations?: string[];
  };
}

export interface SuggestWorkflowOptions {
  subscribedToolIds?: string[] | Set<string>;
  allAgentsSubscribed?: boolean;
  plan?: string;
}

// ─── Compatible Fallback Map ───────────────────────────────────────────────────
// If an agent is not in the tenant's subscribed tools, map to a compatible active tool
const COMPATIBLE_FALLBACKS: Record<string, string[]> = {
  // Outreach & Marketing → follow-up-agent
  'campaign-agent': ['follow-up-agent'],
  'reactivation-agent': ['follow-up-agent'],
  'review-agent': ['follow-up-agent'],
  'referral-agent': ['follow-up-agent'],
  'lead-recovery-agent': ['follow-up-agent'],
  'cancellation-recovery-agent': ['booking-agent', 'follow-up-agent'],
  'membership-agent': ['follow-up-agent'],
  'upsell-agent': ['follow-up-agent'],
  'revenue-recovery-agent': ['follow-up-agent'],
  'post-treatment-agent': ['follow-up-agent'],
  'patient-concierge': ['follow-up-agent', 'lead-concierge'],
  'front-desk-copilot': ['follow-up-agent', 'booking-agent'],
  'communication-agent': ['follow-up-agent'],

  // Calendar & Reservations → booking-agent
  'rebooking-agent': ['booking-agent'],
  'waitlist-agent': ['booking-agent'],
  'no-show-prevention-agent': ['booking-agent', 'follow-up-agent'],

  // Telephony & Voice → voice-agent
  'outbound-calling-agent': ['voice-agent'],
  'receptionist-agent': ['voice-agent', 'crm-agent', 'follow-up-agent'],

  // Messaging → sms-concierge / follow-up-agent
  'whatsapp-concierge': ['sms-concierge', 'follow-up-agent'],
  'sms-concierge': ['follow-up-agent'],

  // Concierge & Intake → lead-concierge
  'web-concierge': ['lead-concierge', 'follow-up-agent'],
  'treatment-advisor': ['lead-concierge', 'follow-up-agent'],

  // Clinical & CRM → crm-agent
  'emr-ehr-integration-agent': ['crm-agent'],
  'crm-agent': ['lead-concierge'],

  // Intelligence & Analytics
  'lead-qualifier': ['lead-concierge'],
  'growth-analyst': ['crm-agent', 'lead-concierge'],
  'integration-guardian': ['crm-agent'],
};

/**
 * AI Workflow Suggester — Parses natural language and returns a structured workflow.
 * Deterministic, instant, and subscription-aware.
 */
export function suggestWorkflow(prompt: string, options?: SuggestWorkflowOptions): SuggestedWorkflow {
  const text = prompt.toLowerCase();

  // ─── 1. Parameter Extraction ─────────────────────────────────────────────────
  let extractedEmail: string | undefined;
  const explicitRecipientMatch = prompt.match(
    /(?:to\s+(?:this\s+)?email|send\s+to|recipient|client|customer|to\s*[:–\-])\s*[:–\-]?\s*["']?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})["']?/i
  );
  const myEmailMatch = prompt.match(/my\s+email\s+is\s*["']?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})["']?/i);
  if (explicitRecipientMatch) {
    extractedEmail = explicitRecipientMatch[1];
  } else {
    const allEmails = [...prompt.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)].map(m => m[0]);
    const nonOwner = allEmails.filter(e => !myEmailMatch || e.toLowerCase() !== myEmailMatch[1].toLowerCase());
    extractedEmail = nonOwner[0] || (myEmailMatch ? undefined : allEmails[0]);
  }

  const extractedPhones = extractPhoneNumbers(prompt);
  const extractedPhone = extractedPhones[0];

  let extractedMessage: string | undefined;
  const msgParts = prompt.split(/(?:message\s+is|message\s*[:–\-]|saying|body\s+is|body\s*[:–\-]|email\s+is|email\s*[:–\-])/i);
  if (msgParts.length > 1 && msgParts[1]) {
    extractedMessage = msgParts[1].split(/(?:and\s+(?:set|book|schedule|create)|in\s+calender|in\s+calendar)/i)[0]?.trim();
  }

  const nameMatch = prompt.match(/(?:hi|hello|dear|name\s*[:–\-])\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
  const extractedName = nameMatch ? nameMatch[1].trim() : (extractedEmail ? extractedEmail.split('@')[0] : undefined);

  const subjectMatch = prompt.match(/subject\s*[:–\-]\s*(.+?)(?:\n|\s*,?\s*(?:email|body|message)\s*[:–\-]|,\s*and|$)/i);
  const extractedSubject = subjectMatch ? subjectMatch[1].trim() : undefined;

  const defaultTriggerData = {
    recipientEmail: extractedEmail,
    recipientName: extractedName,
    message: extractedMessage || 'Hi from HeyTam — your AI workforce.',
    subject: extractedSubject,
    recipientPhone: extractedPhone,
    recipientPhones: extractedPhones,
    prompt: prompt,
  };

  // ─── 2. Intent Taxonomy: Build Ideal Pipeline ─────────────────────────────────
  let idealWorkflow: SuggestedWorkflow;

  // 0. Google Sheets Workflows
  const isSheetIntent = text.includes('docs.google.com/spreadsheets') || text.includes('sheet') || text.includes('spreadsheet') || text.includes('csv');
  const isCalendarIntent = text.includes('calender') || text.includes('calendar') || text.includes('remainder') || text.includes('reminder') || text.includes('appoint') || text.includes('schedule') || text.includes('booking');
  const isEmailSendIntent = (text.includes('send') || text.includes('dispatch') || text.includes('forward') || text.includes('deliver') || text.includes('email to') || text.includes('send to') || text.includes('send the data')) && (text.includes('email') || text.includes('mail') || text.includes('@')) && !text.includes('my email is');

  if (isSheetIntent) {
    if (isCalendarIntent && !isEmailSendIntent) {
      idealWorkflow = {
        name: 'Google Sheet Ingestion & Calendar Synchronization Flow',
        description: 'Reads appointment records from Google Sheets and schedules each client appointment with reminders directly in Google Calendar.',
        trigger: 'On-Demand Google Sheet Calendar Sync Trigger',
        explanation: 'Lead Concierge parses client appointment dates and service details from Google Sheets. Booking Agent synchronizes and creates real Google Calendar events with email and popup reminders for every appointment.',
        steps: [
          { order: 1, agentId: 'lead-concierge', agentName: 'Lead Concierge & Sheet Ingestion' },
          { order: 2, agentId: 'booking-agent', agentName: 'Booking Agent (Calendar Appointments)' },
        ],
        extractedTriggerData: { ...defaultTriggerData, service: 'Google Sheet Calendar Appointment Synchronization' },
      };
    } else if (isCalendarIntent && isEmailSendIntent) {
      idealWorkflow = {
        name: 'Google Sheet Ingestion, Calendar Sync & Email Dispatch Flow',
        description: `Reads Google Sheet, schedules appointments in Google Calendar, and dispatches confirmation report to ${extractedEmail || 'recipient'}.`,
        trigger: 'On-Demand Google Sheet Multi-Agent Trigger',
        explanation: '3-agent flow: Lead Concierge parses spreadsheet records, Booking Agent creates calendar events with reminders, and Follow-up Agent sends confirmation emails.',
        steps: [
          { order: 1, agentId: 'lead-concierge', agentName: 'Lead Concierge & Sheet Ingestion' },
          { order: 2, agentId: 'booking-agent', agentName: 'Booking Agent (Calendar Appointments)' },
          { order: 3, agentId: 'follow-up-agent', agentName: 'Follow-up Agent (Data Dispatch)' },
        ],
        extractedTriggerData: { ...defaultTriggerData, subject: extractedSubject || 'Google Sheet Appointments Sync & Report', service: 'Google Sheet Calendar Sync & Email Dispatch' },
      };
    } else {
      idealWorkflow = {
        name: 'Google Sheet Ingestion & Email Dispatch Flow',
        description: `Reads live spreadsheet data from Google Sheets and dispatches the formatted dataset to ${extractedEmail || 'the recipient'}.`,
        trigger: 'On-Demand Google Sheet Processing Trigger',
        explanation: 'Lead Concierge extracts and parses the live data rows from the Google Sheet. Follow-up Agent formats the leads into a structured report and delivers it via email.',
        steps: [
          { order: 1, agentId: 'lead-concierge', agentName: 'Lead Concierge & Sheet Ingestion' },
          { order: 2, agentId: 'follow-up-agent', agentName: 'Follow-up Agent (Data Dispatch)' },
        ],
        extractedTriggerData: { ...defaultTriggerData, subject: extractedSubject || 'Google Sheet Data Export & Leads Report', service: 'Google Sheet Ingestion & Data Dispatch' },
      };
    }
  }

  // 1. Inbound Email Reading + Rescheduling
  else if (
    (text.includes('read') || text.includes('inbound') || text.includes('first 5') || text.includes('check email')) &&
    (text.includes('email') || text.includes('mail')) &&
    (text.includes('resched') || text.includes('calender') || text.includes('calendar') || text.includes('appoint'))
  ) {
    idealWorkflow = {
      name: 'Email Reading → Calendar Rescheduling → Feedback Dispatch',
      description: 'Reads inbound emails, automatically determines and updates Google Calendar appointment slots, and sends confirmation feedback to each recipient.',
      trigger: 'Batch Inbound Email & Calendar Synchronization Trigger',
      explanation: '3-step pipeline: Lead Concierge reads and parses the emails. Booking Agent reschedules the appointments in Google Calendar. Follow-up Agent sends confirmation emails with Google Calendar times.',
      steps: [
        { order: 1, agentId: 'lead-concierge', agentName: 'Lead Concierge & Email Reader' },
        { order: 2, agentId: 'booking-agent', agentName: 'Booking Agent (Calendar Rescheduling)' },
        { order: 3, agentId: 'follow-up-agent', agentName: 'Follow-up Agent (Email Feedback)' },
      ],
      extractedTriggerData: { ...defaultTriggerData, message: extractedMessage || 'Your appointment has been rescheduled.', service: 'Calendar Rescheduling & Email Feedback' },
    };
  }

  // 2. Receptionist / Inbound Call Transcript
  else if (text.includes('reception') || text.includes('transcript') || text.includes('caller') || text.includes('inbound call')) {
    idealWorkflow = {
      name: 'Front-Desk Call Reception & Intake Pipeline',
      description: 'Processes inbound caller transcripts, captures patient details, and logs to CRM.',
      trigger: 'Inbound Call Transcript Trigger',
      explanation: 'Receptionist Agent parses caller inquiries and patient details. CRM Agent stores the structured record.',
      steps: [
        { order: 1, agentId: 'receptionist-agent', agentName: 'Receptionist Agent' },
        { order: 2, agentId: 'crm-agent', agentName: 'CRM Agent' },
      ],
      extractedTriggerData: { ...defaultTriggerData, service: 'Front-Desk Call Intake' },
    };
  }

  // 3. Outbound Voice Calling
  else if (text.includes('call') || text.includes('phone') || text.includes('dial') || text.includes('voice')) {
    const hasBookingIntent = /book|appoint|reserv|schedul|calendar|slot/i.test(prompt);
    idealWorkflow = hasBookingIntent ? {
      name: 'Voice Calling & Booking Flow',
      description: 'Places outbound voice call via Twilio and confirms appointment.',
      trigger: 'Outbound Telephony Trigger',
      explanation: 'Voice Agent dials the contact via Twilio using natural speech synthesis. Booking Agent reserves the calendar appointment.',
      steps: [
        { order: 1, agentId: 'voice-agent', agentName: 'Voice Agent (Outbound Call)' },
        { order: 2, agentId: 'booking-agent', agentName: 'Booking Agent (Calendar)' },
      ],
      extractedTriggerData: { ...defaultTriggerData, service: 'Outbound Voice Call & Booking' },
    } : {
      name: 'Outbound Voice Outreach Flow',
      description: 'Places conversational AI voice call via Twilio and engages contact with real-time dialogue.',
      trigger: 'Outbound Telephony Trigger',
      explanation: 'Voice Agent dials the contact via Twilio with natural speech synthesis and real-time back-and-forth speech interaction.',
      steps: [
        { order: 1, agentId: 'voice-agent', agentName: 'Voice Agent (Outbound Call)' },
      ],
      extractedTriggerData: { ...defaultTriggerData, service: 'Outbound Voice Call' },
    };
  }

  // 4. WhatsApp Outreach
  else if (text.includes('whatsapp')) {
    idealWorkflow = {
      name: 'WhatsApp Outreach & Engagement Flow',
      description: 'Sends targeted WhatsApp messages via Twilio WhatsApp API.',
      trigger: 'WhatsApp Direct Outreach Trigger',
      explanation: 'WhatsApp Concierge delivers personalized messaging directly to the recipient over WhatsApp.',
      steps: [{ order: 1, agentId: 'whatsapp-concierge', agentName: 'WhatsApp Concierge' }],
      extractedTriggerData: { ...defaultTriggerData, service: 'WhatsApp Messaging' },
    };
  }

  // 5. SMS Outreach
  else if (text.includes('sms') || text.includes('text message')) {
    idealWorkflow = {
      name: 'SMS Outreach & Notification Flow',
      description: 'Delivers automated SMS notifications and reminders via Twilio.',
      trigger: 'SMS Outreach Trigger',
      explanation: 'SMS Concierge delivers direct text messages for appointment updates and confirmations.',
      steps: [{ order: 1, agentId: 'sms-concierge', agentName: 'SMS Concierge' }],
      extractedTriggerData: { ...defaultTriggerData, service: 'SMS Outreach' },
    };
  }

  // 6. Marketing Campaigns & Broadcasts
  else if (text.includes('campaign') || text.includes('newsletter') || text.includes('broadcast') || text.includes('promo')) {
    idealWorkflow = {
      name: 'Multi-Channel Marketing Campaign Flow',
      description: 'Designs and executes personalized marketing campaigns and promotional broadcasts.',
      trigger: 'Marketing Campaign Launch Trigger',
      explanation: 'Campaign Agent designs and executes high-converting promotional emails with branded layouts.',
      steps: [
        { order: 1, agentId: 'campaign-agent', agentName: 'Campaign Agent' },
        { order: 2, agentId: 'follow-up-agent', agentName: 'Follow-up Agent' },
      ],
      extractedTriggerData: { ...defaultTriggerData, service: 'Marketing Campaign' },
    };
  }

  // 7. Dormant Patient Reactivation / Win-Back
  else if (text.includes('reactivat') || text.includes('dormant') || text.includes('win back') || text.includes('inactive') || text.includes('lapsed')) {
    idealWorkflow = {
      name: 'Dormant Client Reactivation Pipeline',
      description: 'Re-engages inactive clients (90+ days) with tailored win-back incentives and booking links.',
      trigger: 'Dormant Client Win-Back Trigger',
      explanation: 'Reactivation Agent delivers tailored win-back offers. Booking Agent schedules recovered appointments.',
      steps: [
        { order: 1, agentId: 'reactivation-agent', agentName: 'Reactivation Agent' },
        { order: 2, agentId: 'booking-agent', agentName: 'Booking Agent' },
      ],
      extractedTriggerData: { ...defaultTriggerData, service: 'Client Reactivation' },
    };
  }

  // 8. Google Reviews & Reputation
  else if (text.includes('review') || text.includes('reputation') || text.includes('5-star') || text.includes('feedback') || text.includes('rating')) {
    idealWorkflow = {
      name: '5-Star Review Generation Flow',
      description: 'Dispatches automated Google review requests and tracks reputation feedback.',
      trigger: 'Post-Interaction Review Trigger',
      explanation: 'Review Agent sends personalized review requests with direct Google Business links.',
      steps: [{ order: 1, agentId: 'review-agent', agentName: 'Review Agent' }],
      extractedTriggerData: { ...defaultTriggerData, service: 'Reputation Management' },
    };
  }

  // 9. Referral Programs
  else if (text.includes('referral') || text.includes('recommend') || text.includes('invite friend')) {
    idealWorkflow = {
      name: 'Patient Referral Program Campaign',
      description: 'Promotes patient referral rewards and tracks friend invitations.',
      trigger: 'Referral Incentive Trigger',
      explanation: 'Referral Agent delivers referral rewards and program invitations to satisfied clients.',
      steps: [{ order: 1, agentId: 'referral-agent', agentName: 'Referral Agent' }],
      extractedTriggerData: { ...defaultTriggerData, service: 'Referral Program' },
    };
  }

  // 10. Memberships & Subscriptions
  else if (text.includes('membership') || text.includes('subscription') || text.includes('vip') || text.includes('tier') || text.includes('renew')) {
    idealWorkflow = {
      name: 'VIP Membership & Subscription Flow',
      description: 'Manages membership enrollment, tier perks, and renewal notices.',
      trigger: 'Membership Management Trigger',
      explanation: 'Membership Agent dispatches membership confirmations, VIP benefits, and renewal terms.',
      steps: [{ order: 1, agentId: 'membership-agent', agentName: 'Membership Agent' }],
      extractedTriggerData: { ...defaultTriggerData, service: 'Membership Management' },
    };
  }

  // 11. Upsell & Cross-Sell
  else if (text.includes('upsell') || text.includes('cross-sell') || text.includes('upgrade') || text.includes('package') || text.includes('add-on')) {
    idealWorkflow = {
      name: 'Revenue Upsell & Treatment Upgrade Flow',
      description: 'Presents tailored service upgrades and treatment add-ons to clients.',
      trigger: 'Upsell Opportunity Trigger',
      explanation: 'Upsell Agent identifies high-value treatment enhancements and presents proposals to clients.',
      steps: [
        { order: 1, agentId: 'upsell-agent', agentName: 'Upsell Agent' },
        { order: 2, agentId: 'booking-agent', agentName: 'Booking Agent' },
      ],
      extractedTriggerData: { ...defaultTriggerData, service: 'Service Upsell' },
    };
  }

  // 12. Growth & Business Intelligence Analytics
  else if (text.includes('growth') || text.includes('analyst') || text.includes('kpi') || text.includes('metrics') || (text.includes('report') && !text.includes('sheet'))) {
    idealWorkflow = {
      name: 'Business Growth & Intelligence Analytics Flow',
      description: 'Analyzes patient trends, service profitability, and operational bottlenecks.',
      trigger: 'Growth Analytics Trigger',
      explanation: 'Growth Analyst computes business metrics, conversion funnels, and revenue projections.',
      steps: [{ order: 1, agentId: 'growth-analyst', agentName: 'Growth Analyst' }],
      extractedTriggerData: { ...defaultTriggerData, service: 'Growth Analytics' },
    };
  }

  // 13. Revenue Recovery & Outstanding Balances
  else if ((text.includes('revenue recovery') || text.includes('balance') || text.includes('unpaid') || text.includes('overdue') || text.includes('invoice') || text.includes('collect')) && !text.includes('growth')) {
    idealWorkflow = {
      name: 'Revenue Recovery & Balance Notification Flow',
      description: 'Follows up on outstanding balances and delivers secure payment notices.',
      trigger: 'Revenue Recovery Trigger',
      explanation: 'Revenue Recovery Agent sends courteous account statements and payment details.',
      steps: [{ order: 1, agentId: 'revenue-recovery-agent', agentName: 'Revenue Recovery Agent' }],
      extractedTriggerData: { ...defaultTriggerData, service: 'Revenue Recovery' },
    };
  }

  // 13. No-Show Prevention & Reminders
  else if (text.includes('no-show') || text.includes('reminder') || text.includes('confirm app')) {
    idealWorkflow = {
      name: 'No-Show Prevention & Appointment Confirmation Flow',
      description: 'Sends pre-appointment alerts, confirms client arrival, and manages waitlist buffers.',
      trigger: 'Appointment Confirmation Trigger',
      explanation: 'No-Show Prevention Agent delivers proactive confirmation alerts to safeguard schedule capacity.',
      steps: [
        { order: 1, agentId: 'no-show-prevention-agent', agentName: 'No-Show Prevention Agent' },
        { order: 2, agentId: 'booking-agent', agentName: 'Booking Agent' },
      ],
      extractedTriggerData: { ...defaultTriggerData, service: 'No-Show Prevention' },
    };
  }

  // 14. Cancellation Recovery
  else if (text.includes('cancel') || text.includes('reschedule') || text.includes('missed')) {
    idealWorkflow = {
      name: 'Cancellation Recovery & Waitlist Backfill Flow',
      description: 'Processes cancellations, fills openings from the waitlist, and reschedules clients.',
      trigger: 'Cancellation Event Trigger',
      explanation: 'Cancellation Recovery Agent reaches out to reschedule canceled slots, backed by Waitlist Agent.',
      steps: [
        { order: 1, agentId: 'cancellation-recovery-agent', agentName: 'Cancellation Recovery Agent' },
        { order: 2, agentId: 'waitlist-agent', agentName: 'Waitlist Agent' },
        { order: 3, agentId: 'booking-agent', agentName: 'Booking Agent' },
      ],
      extractedTriggerData: { ...defaultTriggerData, service: 'Cancellation Recovery' },
    };
  }

  // 15. Post-Treatment Care & After-Care
  else if (text.includes('post') || text.includes('after') || text.includes('recovery') || text.includes('care tips')) {
    idealWorkflow = {
      name: 'Post-Treatment After-Care & Review Flow',
      description: 'Delivers clinical after-care instructions, verifies patient recovery, and requests reviews.',
      trigger: 'Post-Treatment Care Trigger',
      explanation: 'Post-Treatment Agent delivers recovery guidance. Review Agent collects positive feedback.',
      steps: [
        { order: 1, agentId: 'post-treatment-agent', agentName: 'Post-Treatment Agent' },
        { order: 2, agentId: 'review-agent', agentName: 'Review Agent' },
        { order: 3, agentId: 'rebooking-agent', agentName: 'Rebooking Agent' },
      ],
      extractedTriggerData: { ...defaultTriggerData, service: 'Post-Treatment Care' },
    };
  }

  // 16. CRM Management & Lead Logging
  else if (text.includes('crm') || text.includes('database') || text.includes('save contact') || text.includes('log lead')) {
    idealWorkflow = {
      name: 'CRM Data Synchronization & Contact Logging Flow',
      description: 'Synchronizes patient records, interaction history, and lead statuses to CRM.',
      trigger: 'CRM Synchronization Trigger',
      explanation: 'CRM Agent records contact details and notes directly to MongoDB and CRM pipelines.',
      steps: [
        { order: 1, agentId: 'crm-agent', agentName: 'CRM Agent' },
        { order: 2, agentId: 'follow-up-agent', agentName: 'Follow-up Agent' },
      ],
      extractedTriggerData: { ...defaultTriggerData, service: 'CRM Synchronization' },
    };
  }

  // 17. New Lead Intake & Qualification
  else if (text.includes('lead') || text.includes('qualif') || text.includes('intake') || text.includes('inquiry')) {
    idealWorkflow = {
      name: 'Lead Intake & Qualification Pipeline',
      description: 'Captures incoming inquiries, qualifies budget and intent, and schedules consultations.',
      trigger: 'Inbound Lead Trigger',
      explanation: 'Lead Concierge ingests inquiry, Lead Qualifier scores intent, and Booking Agent reserves calendar slots.',
      steps: [
        { order: 1, agentId: 'lead-concierge', agentName: 'Lead Concierge' },
        { order: 2, agentId: 'lead-qualifier', agentName: 'Lead Qualifier' },
        { order: 3, agentId: 'booking-agent', agentName: 'Booking Agent' },
      ],
      extractedTriggerData: { ...defaultTriggerData, service: 'Lead Qualification & Booking' },
    };
  }

  // 18. Treatment Advisory & Clinical Questions
  else if (text.includes('treatment') || text.includes('procedure') || text.includes('clinical') || text.includes('doctor') || text.includes('advice')) {
    idealWorkflow = {
      name: 'Treatment Advisory & Consultation Flow',
      description: 'Provides structured treatment guidance, procedure explanations, and scheduling.',
      trigger: 'Clinical Advisory Trigger',
      explanation: 'Treatment Advisor delivers detailed clinical guidance and hands off to Booking Agent.',
      steps: [
        { order: 1, agentId: 'treatment-advisor', agentName: 'Treatment Advisor' },
        { order: 2, agentId: 'booking-agent', agentName: 'Booking Agent' },
      ],
      extractedTriggerData: { ...defaultTriggerData, service: 'Treatment Advisory' },
    };
  }

  // 20. EMR / EHR Clinical Sync
  else if (text.includes('emr') || text.includes('ehr') || text.includes('medical record') || text.includes('fhir') || text.includes('hl7')) {
    idealWorkflow = {
      name: 'EMR/EHR Clinical Record Synchronization Flow',
      description: 'Validates clinical patient schemas and synchronizes appointment records with EMR/EHR.',
      trigger: 'EMR Sync Trigger',
      explanation: 'EMR/EHR Integration Agent validates HL7/FHIR payloads and synchronizes clinical entries.',
      steps: [
        { order: 1, agentId: 'emr-ehr-integration-agent', agentName: 'EMR/EHR Integration Agent' },
        { order: 2, agentId: 'crm-agent', agentName: 'CRM Agent' },
      ],
      extractedTriggerData: { ...defaultTriggerData, service: 'EMR Clinical Sync' },
    };
  }

  // 21. Integration Health Check
  else if (text.includes('health') || text.includes('integration') || text.includes('status') || text.includes('ping')) {
    idealWorkflow = {
      name: 'Integration Guardian System Health Check',
      description: 'Monitors Twilio telephony, Google OAuth, and SMTP delivery endpoints.',
      trigger: 'Integration Health Check Trigger',
      explanation: 'Integration Guardian validates the live operational readiness of all connected third-party services.',
      steps: [{ order: 1, agentId: 'integration-guardian', agentName: 'Integration Guardian' }],
      extractedTriggerData: { ...defaultTriggerData, service: 'System Health Check' },
    };
  }

  // 22. Calendar-Only Scheduling
  else if (isCalendarIntent && !isEmailSendIntent && !text.includes('call')) {
    idealWorkflow = {
      name: 'Google Calendar Appointment Booking',
      description: 'Schedules consultation and adds reminders directly in Google Calendar.',
      trigger: 'Direct Calendar Booking Trigger',
      explanation: 'Booking Agent checks calendar availability and creates the event with popup & email reminders.',
      steps: [{ order: 1, agentId: 'booking-agent', agentName: 'Booking Agent (Calendar)' }],
      extractedTriggerData: { ...defaultTriggerData, service: 'Calendar Booking' },
    };
  }

  // 23. Direct Email Communication
  else if (text.includes('email') || text.includes('mail') || extractedEmail) {
    idealWorkflow = {
      name: 'Direct Email Dispatch Flow',
      description: `Composes and delivers personalized email to ${extractedEmail || 'the client'}.`,
      trigger: 'Direct Email Trigger',
      explanation: 'Follow-up Agent composes and delivers branded email communications via SMTP.',
      steps: [{ order: 1, agentId: 'follow-up-agent', agentName: 'Follow-up Agent (Email)' }],
      extractedTriggerData: { ...defaultTriggerData, service: 'Email Communication' },
    };
  }

  // 24. General Fallback Workflow
  else {
    const defaultSteps: WorkflowStep[] = [
      { order: 1, agentId: 'follow-up-agent', agentName: 'Follow-up Agent (Email)' },
    ];
    if (isCalendarIntent) {
      defaultSteps.push({ order: 2, agentId: 'booking-agent', agentName: 'Booking Agent (Calendar)' });
    }
    idealWorkflow = {
      name: prompt.length > 40 ? prompt.slice(0, 40) + '...' : prompt,
      description: `Autonomous workflow for: ${prompt}`,
      trigger: 'On-Demand Execution Trigger',
      explanation: `Automated pipeline utilizing ${defaultSteps.map(s => s.agentName).join(' and ')}.`,
      steps: defaultSteps,
      extractedTriggerData: { ...defaultTriggerData, service: 'General Autonomous Task' },
    };
  }

  // ─── 3. Subscription Enforcement & Fallback Adaptation ────────────────────────
  // Check if tenant has subscribed to all agents (Enterprise plan or all 30 tools active)
  const subscribedList = options?.subscribedToolIds
    ? (Array.isArray(options.subscribedToolIds) ? options.subscribedToolIds : Array.from(options.subscribedToolIds))
    : undefined;

  const isAllBought = Boolean(
    options?.allAgentsSubscribed === true ||
    options?.plan?.toLowerCase().includes('enterprise') ||
    options?.plan?.toLowerCase().includes('all') ||
    (subscribedList && (subscribedList.length >= 30 || subscribedList.includes('*')))
  );

  // If no subscription constraints passed or all agents bought, return full 30-agent suite workflow
  if (!subscribedList || isAllBought) {
    return {
      ...idealWorkflow,
      subscriptionContext: {
        allAgentsSubscribed: true,
        subscribedCount: subscribedList ? subscribedList.length : 30,
        adaptedSteps: false,
      },
    };
  }

  // Otherwise, tenant has a specific subset of subscribed tools.
  // Dynamically map each step to an active subscribed tool so /run NEVER fails with 402!
  const activeSet = new Set(subscribedList);
  activeSet.add('heytam-orchestrator');
  activeSet.add('master-orchestrator');

  const requiredActivations: string[] = [];
  const adaptedSteps: WorkflowStep[] = [];
  let wasAdapted = false;

  for (const step of idealWorkflow.steps) {
    if (activeSet.has(step.agentId)) {
      adaptedSteps.push({ ...step });
      continue;
    }

    // Try finding a subscribed fallback
    const fallbacks = COMPATIBLE_FALLBACKS[step.agentId] || [];
    const matchedFallback = fallbacks.find(fb => activeSet.has(fb));

    if (matchedFallback) {
      wasAdapted = true;
      const meta = getAgentMeta(matchedFallback);
      adaptedSteps.push({
        order: adaptedSteps.length + 1,
        agentId: matchedFallback,
        agentName: meta?.name || matchedFallback,
      });
    } else {
      // No subscribed tool can fulfill this capability (e.g. voice call requested, but voice-agent not bought)
      requiredActivations.push(step.agentName);
      adaptedSteps.push({ ...step });
    }
  }

  // Deduplicate consecutive identical agents (e.g. if two marketing steps mapped to follow-up-agent)
  const dedupedSteps: WorkflowStep[] = [];
  for (const step of adaptedSteps) {
    if (dedupedSteps.length === 0 || dedupedSteps[dedupedSteps.length - 1].agentId !== step.agentId) {
      dedupedSteps.push(step);
    }
  }

  // Re-index step orders
  const finalSteps = dedupedSteps.map((s, idx) => ({ ...s, order: idx + 1 }));

  let finalExplanation = idealWorkflow.explanation;
  if (wasAdapted) {
    finalExplanation += ` (Optimized for your subscribed agents: using ${finalSteps.map(s => s.agentName).join(' ➔ ')}).`;
  }
  if (requiredActivations.length > 0) {
    finalExplanation += ` 💡 Note: Running this workflow fully requires subscribing to: ${requiredActivations.join(', ')}.`;
  }

  return {
    ...idealWorkflow,
    steps: finalSteps,
    explanation: finalExplanation,
    subscriptionContext: {
      allAgentsSubscribed: false,
      subscribedCount: activeSet.size,
      adaptedSteps: wasAdapted,
      requiredActivations: requiredActivations.length > 0 ? requiredActivations : undefined,
    },
  };
}
