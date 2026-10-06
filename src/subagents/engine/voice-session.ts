/**
 * HeyTam Core — Voice Session Manager
 * Handles multi-turn conversational AI voice calls over Twilio STT & TTS.
 * Connects real-time phone dialogue directly to the HeyTam Orchestrator execution logs.
 */
import { generateText } from 'ai';
import { openai, createOpenAI } from '@ai-sdk/openai';

export interface CallTurn {
  role: 'ai' | 'customer' | 'system';
  text: string;
  timestamp: string;
  voice?: string;
  confidence?: number;
}

export interface CallSession {
  callSid: string;
  businessId: string;
  runId?: string;
  stepOrder?: number;
  from: string;
  to: string;
  direction: 'inbound' | 'outbound';
  voice: string;
  status: 'in-progress' | 'completed' | 'failed' | 'busy' | 'no-answer' | 'canceled';
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  turns: CallTurn[];
  systemPrompt?: string;
  metadata?: Record<string, any>;
}

// In-memory active call sessions store
export const callSessionsStore = new Map<string, CallSession>();

// Orchestrator real-time logger callback
export type OrchestratorLogger = (
  runId: string,
  logLine: string,
  meta?: {
    stepOrder?: number;
    agentId?: string;
    customerSpeech?: string;
    aiReply?: string;
    voice?: string;
    callSid?: string;
  }
) => void;

let orchestratorLogger: OrchestratorLogger | null = null;

export function registerOrchestratorLogger(fn: OrchestratorLogger): void {
  orchestratorLogger = fn;
}

export function logToOrchestrator(
  runId: string | undefined,
  logLine: string,
  meta?: {
    stepOrder?: number;
    agentId?: string;
    customerSpeech?: string;
    aiReply?: string;
    voice?: string;
    callSid?: string;
  }
): void {
  if (!runId) return;
  if (orchestratorLogger) {
    try {
      orchestratorLogger(runId, logLine, meta);
    } catch (e) {
      console.error('[VoiceSession] Error dispatching orchestrator log:', e);
    }
  }
}

/**
 * Get public backend URL reachable by Twilio webhooks
 */
export function getPublicBackendUrl(): string {
  if (process.env.PUBLIC_BACKEND_URL && !process.env.PUBLIC_BACKEND_URL.includes('localhost')) {
    return process.env.PUBLIC_BACKEND_URL.replace(/\/+$/, '');
  }
  if (process.env.BACKEND_PUBLIC_URL && !process.env.BACKEND_PUBLIC_URL.includes('localhost')) {
    return process.env.BACKEND_PUBLIC_URL.replace(/\/+$/, '');
  }
  // Production cluster fallback (Azure Kubernetes Service public IP)
  return 'http://20.241.243.241';
}

/**
 * Safe XML text escaping for TwiML
 */
export function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate interactive TwiML response with <Gather input="speech">
 */
export function generateGatherTwiML(options: {
  speech: string;
  voice: string;
  turnUrl: string;
  isEnding?: boolean;
}): string {
  const { speech, voice, turnUrl, isEnding } = options;
  const escapedSpeech = escapeXml(speech);
  const escapedVoice = escapeXml(voice || 'Polly.Joanna-Neural');

  if (isEnding) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${escapedVoice}">${escapedSpeech}</Say>
  <Hangup/>
</Response>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" speechTimeout="auto" speechModel="phone_call" timeout="5" action="${escapeXml(turnUrl)}" method="POST">
    <Say voice="${escapedVoice}">${escapedSpeech}</Say>
  </Gather>
  <Say voice="${escapedVoice}">Thank you for calling. If you need further assistance, please reach back out anytime. Have a wonderful day. Goodbye!</Say>
  <Hangup/>
</Response>`;
}

/**
 * Generate ending TwiML
 */
export function generateClosingTwiML(options: { speech: string; voice: string }): string {
  const escapedSpeech = escapeXml(options.speech);
  const escapedVoice = escapeXml(options.voice || 'Polly.Joanna-Neural');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${escapedVoice}">${escapedSpeech}</Say>
  <Hangup/>
</Response>`;
}

/**
 * Look up or store call sessions
 */
export function getCallSession(callSid: string): CallSession | undefined {
  return callSessionsStore.get(callSid);
}

export function upsertCallSession(session: CallSession): void {
  callSessionsStore.set(session.callSid, session);
}

export function getCallSessionsForBusiness(businessId: string): CallSession[] {
  return Array.from(callSessionsStore.values())
    .filter(s => s.businessId === businessId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

/**
 * Generate contextual conversational AI reply for live telephone turn
 */
export async function generateAiVoiceReply(options: {
  businessName: string;
  businessServices?: string[];
  businessTone?: string;
  systemContext?: string;
  history: CallTurn[];
  customerSpeech: string;
  openaiApiKey?: string;
}): Promise<{ replyText: string; isClosing: boolean }> {
  const {
    businessName,
    businessServices = [],
    businessTone = 'Warm, professional, and empathetic',
    history,
    customerSpeech,
    openaiApiKey,
  } = options;

  // Build dialogue transcript
  const historyText = history
    .filter(t => t.text)
    .map(t => `${t.role === 'customer' ? 'Customer' : 'AI'}: ${t.text}`)
    .join('\n');

  const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const model = openaiApiKey
    ? createOpenAI({ apiKey: openaiApiKey })(modelName)
    : openai(modelName);

  const systemInstructions = `You are the live conversational telephone AI receptionist/representative for ${businessName}.
Services offered: ${businessServices.length > 0 ? businessServices.join(', ') : 'Consultations and appointments'}.
Speaking Tone: ${businessTone}.

CRITICAL SPOKEN VOICE GUIDELINES:
1. You are speaking out loud on a REAL phone call via Twilio Text-to-Speech.
2. Keep your answers concise, direct, and conversational (1 to 2 sentences maximum).
3. Do NOT use markdown, asterisks, bullet points, numbered lists, emojis, URLs, or special characters.
4. If the customer is asking about scheduling, prices, or services, give a helpful, courteous response.
5. If the customer indicates they want to conclude the call (e.g. "goodbye", "bye", "that's all", "thank you bye", "see you"), say a warm goodbye and end with [END_CALL].
6. If the customer asks to speak with a human or schedule an appointment, confirm their request and say our team will follow up promptly.`;

  try {
    const { text } = await generateText({
      model,
      system: systemInstructions,
      prompt: `CONVERSATION TRANSCRIPT SO FAR:\n${historyText}\n\nCustomer just said: "${customerSpeech}"\n\nGenerate your spoken response now:`,
    });

    let cleaned = text.trim();
    let isClosing = false;

    if (cleaned.includes('[END_CALL]')) {
      isClosing = true;
      cleaned = cleaned.replace(/\[END_CALL\]/g, '').trim();
    }

    const lowerSpeech = customerSpeech.toLowerCase();
    if (
      lowerSpeech.includes('bye') ||
      lowerSpeech.includes('goodbye') ||
      lowerSpeech.includes('have a good day') ||
      lowerSpeech.includes('hang up') ||
      lowerSpeech.includes('that is all') ||
      lowerSpeech.includes("that's all")
    ) {
      isClosing = true;
    }

    if (!cleaned) {
      cleaned = `Thank you for sharing that with us at ${businessName}. How else may I assist you today?`;
    }

    return { replyText: cleaned, isClosing };
  } catch (err: unknown) {
    console.error('[VoiceSession] generateAiVoiceReply error:', err);
    return {
      replyText: `Thank you for contacting ${businessName}. I have noted your details and our team will follow up with you right away. Have a wonderful day!`,
      isClosing: true,
    };
  }
}
