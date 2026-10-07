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

import crypto from 'crypto';

export interface ElevenLabsAudioOptions {
  text: string;
  voiceId?: string;
  apiKey?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
}

// In-memory cache for generated ElevenLabs audio buffers
export const elevenLabsAudioCache = new Map<string, { buffer: Buffer; contentType: string; createdAt: number }>();

export function getElevenLabsCacheKey(options: ElevenLabsAudioOptions): string {
  const hash = crypto.createHash('sha256');
  hash.update(`${options.text}__${options.voiceId || '21m00Tcm4TlvDq8ikWAM'}__${options.modelId || 'eleven_turbo_v2_5'}`);
  return hash.digest('hex').slice(0, 24);
}

/**
 * Generate audio buffer via ElevenLabs Text-to-Speech API
 */
export async function generateElevenLabsAudioBuffer(
  options: ElevenLabsAudioOptions
): Promise<{ buffer: Buffer; cacheId: string } | null> {
  const text = (options.text || '').trim();
  if (!text) return null;

  const cacheId = getElevenLabsCacheKey(options);
  const cached = elevenLabsAudioCache.get(cacheId);
  if (cached) {
    return { buffer: cached.buffer, cacheId };
  }

  const apiKey = options.apiKey || process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.warn('[ElevenLabs] No API key provided for ElevenLabs audio generation.');
    return null;
  }

  const voiceId = options.voiceId && options.voiceId !== 'custom'
    ? options.voiceId
    : '21m00Tcm4TlvDq8ikWAM'; // Default Rachel

  const modelId = options.modelId || 'eleven_turbo_v2_5';

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: typeof options.stability === 'number' ? options.stability : 0.50,
          similarity_boost: typeof options.similarityBoost === 'number' ? options.similarityBoost : 0.75,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ElevenLabs API Error] Status ${res.status}:`, errText);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    elevenLabsAudioCache.set(cacheId, {
      buffer,
      contentType: 'audio/mpeg',
      createdAt: Date.now(),
    });

    // Keep cache bounded
    if (elevenLabsAudioCache.size > 200) {
      const oldestKey = elevenLabsAudioCache.keys().next().value;
      if (oldestKey) elevenLabsAudioCache.delete(oldestKey);
    }

    return { buffer, cacheId };
  } catch (err) {
    console.error('[ElevenLabs Generation Exception]:', err);
    return null;
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
  // Production cluster fallback (Azure AKS HTTPS domain)
  return 'https://api.heytam.io';
}

/**
 * Safe XML attribute escaping for TwiML attributes
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
 * Safe XML text escaping for TwiML inner text nodes (<Say>, etc.)
 * Keeps standard contractions ("I'm", "don't") intact without &apos; mispronunciation
 */
export function escapeXmlText(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Generate interactive TwiML response with <Gather input="speech">
 * Supports both ElevenLabs audio layer (<Play>) and Twilio native speech (<Say>)
 */
export function generateGatherTwiML(options: {
  speech: string;
  voice: string;
  turnUrl: string;
  isEnding?: boolean;
  audioUrl?: string | null;
}): string {
  const { speech, voice, turnUrl, isEnding, audioUrl } = options;
  const escapedSpeech = escapeXmlText(speech);
  const escapedVoice = escapeXml(voice || 'Polly.Joanna-Neural');

  // If ElevenLabs audio URL is provided, Twilio <Play> executes the ElevenLabs voice layer
  const speechNode = audioUrl
    ? `<Play>${escapeXml(audioUrl)}</Play>`
    : `<Say voice="${escapedVoice}">${escapedSpeech}</Say>`;

  if (isEnding) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${speechNode}
  <Hangup/>
</Response>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" speechTimeout="auto" speechModel="phone_call" timeout="10" action="${escapeXml(turnUrl)}" method="POST">
    ${speechNode}
  </Gather>
  <Gather input="speech" speechTimeout="auto" speechModel="phone_call" timeout="8" action="${escapeXml(turnUrl)}" method="POST">
    <Say voice="${escapedVoice}">I am still on the line. Could you let me know if those timings work for you, or if you have any questions?</Say>
  </Gather>
  <Say voice="${escapedVoice}">Thank you for connecting with ${escapeXml(options.speech ? '' : 'us')}. We will follow up with you shortly. Have a wonderful day!</Say>
  <Hangup/>
</Response>`;
}

/**
 * Generate ending TwiML
 */
export function generateClosingTwiML(options: {
  speech: string;
  voice: string;
  audioUrl?: string | null;
}): string {
  const escapedSpeech = escapeXmlText(options.speech);
  const escapedVoice = escapeXml(options.voice || 'Polly.Joanna-Neural');
  const speechNode = options.audioUrl
    ? `<Play>${escapeXml(options.audioUrl)}</Play>`
    : `<Say voice="${escapedVoice}">${escapedSpeech}</Say>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${speechNode}
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
    businessTone = 'Warm, professional, and helpful',
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

  const servicesList = businessServices.length > 0
    ? businessServices.join(', ')
    : 'Medical treatments, consultations, surgeries, and healthcare procedures';

  const systemInstructions = `You are the live conversational telephone AI assistant for ${businessName}.
Services offered: ${servicesList}.
Speaking Tone: ${businessTone}.
Our operating hours: Monday through Friday from 9:00 AM to 6:00 PM, and Saturday from 10:00 AM to 4:00 PM.

CRITICAL TELEPHONE CONVERSATION RULES:
1. You are actively conversing on a live telephone call. Speak naturally, warmly, and concisely (1 to 2 sentences max).
2. NEVER use markdown, bullet points, asterisks, brackets, URLs, or placeholders.
3. If the caller provides or asks about timings:
   - Confirm their preferred time warmly (e.g. "Tomorrow at 3 PM works perfectly for us.").
   - Explicitly confirm that you are scheduling a Google Calendar reminder for that date and time.
   - Ask if they have any questions regarding the service or procedure.
4. DO NOT prematurely end the call! Keep conversing and answering questions.
5. ONLY end the call when the caller explicitly says goodbye or indicates they are completely done (e.g., "bye", "goodbye", "that is all, thank you", "have a good day").
6. When the caller says goodbye, deliver a warm closing farewell and append [END_CALL].`;

  try {
    const { text } = await generateText({
      model,
      system: systemInstructions,
      prompt: `CONVERSATION TRANSCRIPT SO FAR:\n${historyText}\n\nCustomer just said: "${customerSpeech}"\n\nGenerate your concise, helpful spoken response now:`,
    });

    let cleaned = text.trim();
    let isClosing = false;

    if (cleaned.includes('[END_CALL]')) {
      isClosing = true;
      cleaned = cleaned.replace(/\[END_CALL\]/g, '').trim();
    }

    // Only close if caller explicitly says goodbye or AI concluded
    if (/\b(goodbye|bye\s+now|see\s+you|have\s+a\s+good\s+day|have\s+a\s+nice\s+day)\b/i.test(customerSpeech)) {
      isClosing = true;
    }

    if (!cleaned) {
      cleaned = `Thank you. I have noted that for ${businessName}. Does that timing work well, or would you like to explore other options?`;
    }

    return { replyText: cleaned, isClosing };
  } catch (err: unknown) {
    console.error('[VoiceSession] generateAiVoiceReply error:', err);
    return {
      replyText: `I have noted that for your appointment with ${businessName}. I will ensure your Google Calendar reminder is set for that time. Is there anything else you need?`,
      isClosing: false,
    };
  }
}
