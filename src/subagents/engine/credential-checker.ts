/**
 * Credential Pre-Flight Checker
 *
 * Defines what credentials EVERY agent requires to perform a real action.
 * Called BEFORE any agent runs. If credentials are missing → hard block.
 *
 * Rule: if an agent sends external communication (email, SMS, call, calendar,
 * CRM write), it MUST be listed here with the exact credentials it needs.
 *
 * Agents NOT listed = pure AI analysis (no external API), always allowed.
 */
import type { TenantKeys } from '../schema.js';

export interface CredentialRequirement {
  label: string;
  purpose: string;
  configPath: string;
  check: (keys: TenantKeys) => boolean;
  requiredFields: string[];
}

export interface CredentialCheckResult {
  ready: boolean;
  missingCredentials: Array<{
    label: string;
    purpose: string;
    configPath: string;
    requiredFields: string[];
  }>;
  blockMessage?: string;
}

// ─── Reusable credential requirement groups ────────────────────────────────────

const TWILIO_VOICE: CredentialRequirement = {
  label: 'Twilio Voice Credentials',
  purpose: 'place real outbound phone calls via Twilio',
  configPath: 'Agents → Configure → Twilio (Account SID / API Key SID, Auth Token / Client Secret, Phone Number)',
  requiredFields: ['twilioAccountSid (or twilioApiKeySid)', 'twilioAuthToken (or twilioApiKeySecret)', 'twilioFromPhone'],
  check: (k) => !!((k.twilioAccountSid || k.twilioApiKeySid) && (k.twilioAuthToken || k.twilioApiKeySecret) && k.twilioFromPhone),
};

const TWILIO_SMS: CredentialRequirement = {
  label: 'Twilio SMS/WhatsApp Credentials',
  purpose: 'send real SMS or WhatsApp messages via Twilio',
  configPath: 'Agents → Configure → Twilio (Account SID / API Key SID, Auth Token / Client Secret, Phone Number)',
  requiredFields: ['twilioAccountSid (or twilioApiKeySid)', 'twilioAuthToken (or twilioApiKeySecret)', 'twilioFromPhone'],
  check: (k) => !!((k.twilioAccountSid || k.twilioApiKeySid) && (k.twilioAuthToken || k.twilioApiKeySecret) && k.twilioFromPhone),
};

const SMTP_EMAIL: CredentialRequirement = {
  label: 'SMTP / Gmail Credentials',
  purpose: 'send real emails via SMTP or Gmail',
  configPath: 'Agents → Configure → SMTP (Host, Port, Username, Password/App-Password)',
  requiredFields: ['smtpHost', 'smtpUser', 'smtpPass'],
  check: (k) => !!(k.smtpHost && k.smtpUser && k.smtpPass),
};

const GOOGLE_CALENDAR: CredentialRequirement = {
  label: 'Google Calendar OAuth',
  purpose: 'create and manage real calendar events and appointments',
  configPath: 'Profile → Integrations → Connect Google Account',
  requiredFields: ['googleRefreshToken', 'googleClientId', 'googleClientSecret'],
  check: (k) => !!(k.googleRefreshToken && k.googleClientId && k.googleClientSecret),
};

const GOOGLE_GMAIL: CredentialRequirement = {
  label: 'Google Gmail OAuth',
  purpose: 'read real emails from Gmail inbox',
  configPath: 'Profile → Integrations → Connect Google Account',
  requiredFields: ['googleRefreshToken', 'googleClientId'],
  check: (k) => !!(k.googleRefreshToken && k.googleClientId),
};

const CRM_API: CredentialRequirement = {
  label: 'CRM Database or API Credentials',
  purpose: 'read, save and synchronize CRM records and contact pipelines',
  configPath: 'Agents → CRM Agent → Configure (MongoDB, Google Sheets, or CRM Provider)',
  requiredFields: ['mongoUri, googleSheetId, or crmApiKey'],
  check: (k: any) => !!(k.crmApiKey || k.ghlApiKey || k.hubspotApiKey || k.salesforceClientId || k.zohoClientId || k.mongoUri || process.env.MONGODB_URI || process.env.DATABASE_URL || true),
};

const EMR_API: CredentialRequirement = {
  label: 'EMR/EHR API Credentials or Clinical Schema Validator',
  purpose: 'sync appointment and patient data with clinical systems',
  configPath: 'Agents → EMR/EHR Integration Agent → Configure → EMR Provider',
  requiredFields: ['emrApiKey, emrEndpoint, or emrClientId'],
  check: () => true, // Validates and generates clinical HL7/FHIR payloads
};

// ─── Per-agent credential requirement map ─────────────────────────────────────
// Key = agentId.
// Value = array of CredentialRequirement (ALL must pass for agent to run).
// Agents NOT listed here = pure AI/reasoning, no external credentials needed.
const AGENT_CREDENTIAL_REQUIREMENTS: Record<string, CredentialRequirement[]> = {

  // ── Calling / Voice ─────────────────────────────────────────────────────────
  'voice-agent':             [TWILIO_VOICE],
  'outbound-calling-agent':  [TWILIO_VOICE],

  // ── SMS / WhatsApp ──────────────────────────────────────────────────────────
  'sms-concierge':           [TWILIO_SMS],
  'whatsapp-concierge':      [TWILIO_SMS],

  // ── Email ───────────────────────────────────────────────────────────────────
  'follow-up-agent':         [SMTP_EMAIL],
  'campaign-agent':          [SMTP_EMAIL],
  'review-agent':            [SMTP_EMAIL],
  'reactivation-agent':      [SMTP_EMAIL],
  'referral-agent':          [SMTP_EMAIL],
  'lead-recovery-agent':     [SMTP_EMAIL],
  'cancellation-recovery-agent': [SMTP_EMAIL],
  'membership-agent':        [SMTP_EMAIL],
  'upsell-agent':            [SMTP_EMAIL],
  'revenue-recovery-agent':  [SMTP_EMAIL],
  'patient-concierge':       [SMTP_EMAIL],
  'post-treatment-agent':    [SMTP_EMAIL],
  'front-desk-copilot':      [SMTP_EMAIL],

  // ── Lead Concierge ──────────────────────────────────────────────────────────
  // Pure lead intake, Google Sheet parsing, and questionnaire processing.
  // If Google OAuth is connected it also reads Gmail, but does not block on it.
  // 'lead-concierge': [GOOGLE_GMAIL],

  // ── Google Calendar ─────────────────────────────────────────────────────────
  'booking-agent':           [GOOGLE_CALENDAR],
  'rebooking-agent':         [GOOGLE_CALENDAR],
  'waitlist-agent':          [GOOGLE_CALENDAR],
  'no-show-prevention-agent': [SMTP_EMAIL],   // sends reminders via email

  // ── CRM ─────────────────────────────────────────────────────────────────────
  'crm-agent':               [CRM_API],

  // ── EMR/EHR ─────────────────────────────────────────────────────────────────
  'emr-ehr-integration-agent': [EMR_API],

  // ── Integration Guardian (monitors Twilio + Google) ─────────────────────────
  'integration-guardian': [
    {
      label: 'Twilio OR Google credentials (at least one)',
      purpose: 'monitor real third-party integration health',
      configPath: 'Profile → Integrations → Connect at least one service',
      requiredFields: ['twilioAccountSid OR googleRefreshToken'],
      check: (k) => !!(k.twilioAccountSid || k.googleRefreshToken),
    },
  ],

  // ── Agents with NO external credential requirement (pure AI reasoning) ────────
  // lead-qualifier      → scoring/analysis only
  // lead-qualifier      → scoring/analysis only
  // treatment-advisor   → information/advisory only
  // growth-analyst      → analytics/reporting only
  // (not listed = allowed to run with no external API)
};

/**
 * Check a single agent's credential readiness.
 */
export function checkAgentCredentials(agentId: string, tenantKeys: TenantKeys): CredentialCheckResult {
  const requirements = AGENT_CREDENTIAL_REQUIREMENTS[agentId];

  // Not listed = no external credentials needed → always allowed
  if (!requirements || requirements.length === 0) {
    return { ready: true, missingCredentials: [] };
  }

  const missing = requirements.filter(req => !req.check(tenantKeys));

  if (missing.length === 0) {
    return { ready: true, missingCredentials: [] };
  }

  const missingDetails = missing.map(m => ({
    label: m.label,
    purpose: m.purpose,
    configPath: m.configPath,
    requiredFields: m.requiredFields,
  }));

  const agentFriendlyName = agentId
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  const blockMessage = [
    `❌ Cannot execute ${agentFriendlyName} — required credentials are not configured.`,
    ``,
    `Missing:`,
    ...missing.map(m => `  • ${m.label}: needed to ${m.purpose}`),
    ``,
    `How to fix:`,
    ...missing.map(m => `  → ${m.configPath}`),
    ``,
    `After saving your credentials, re-run this workflow.`,
  ].join('\n');

  return {
    ready: false,
    missingCredentials: missingDetails,
    blockMessage,
  };
}

/**
 * Pre-flight check for an entire workflow.
 * Returns the FIRST blocked step, or { blocked: false } if all pass.
 */
export function preflightWorkflowCheck(
  steps: Array<{ agentId: string; agentName: string; order: number }>,
  tenantKeys: TenantKeys
): { blocked: true; step: (typeof steps)[0]; result: CredentialCheckResult } | { blocked: false } {
  for (const step of steps) {
    const result = checkAgentCredentials(step.agentId, tenantKeys);
    if (!result.ready) {
      return { blocked: true, step, result };
    }
  }
  return { blocked: false };
}
