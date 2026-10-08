/**
 * Communication Tools — Twilio SMS, Voice Calls, WhatsApp + SMTP Email
 * All credentials come from tenant keys passed per-request.
 */
import { z } from 'zod';
import { createTool } from '@mastra/core/tools';
import twilio from 'twilio';
import nodemailer from 'nodemailer';
import type { TenantKeys } from '../schema.js';
import { getTwilioClient } from './twilio-client.js';
import { normalizePhone, formatSpokenVoiceScript } from '../utils/phone-parser.js';
import {
  generateGatherTwiML,
  generateElevenLabsAudioBuffer,
  getPublicBackendUrl,
  upsertCallSession,
  type CallSession,
} from '../engine/voice-session.js';

export function createCommunicationTools(keys: TenantKeys) {
  const hasTwilioCreds = (keys.twilioAccountSid || keys.twilioApiKeySid) &&
                         (keys.twilioAuthToken || keys.twilioApiKeySecret) &&
                         keys.twilioFromPhone;

  return {
    sendSms: createTool({
      id: 'send-sms',
      description: 'Send an SMS via Twilio for follow-ups, appointment reminders, or recovery messages.',
      inputSchema: z.object({
        to: z.string().describe('E.164 phone number e.g. +15551234567'),
        message: z.string().describe('SMS body. Keep under 160 characters.'),
      }),
      execute: async ({ to, message }: { to: string; message: string }) => {
        if (!hasTwilioCreds)
          return { success: false, error: 'Twilio credentials not provided by tenant.' };
        try {
          const client = await getTwilioClient(keys);
          const cleanTo = normalizePhone(to) || to;
          const msg = await client.messages.create({ body: message, from: keys.twilioFromPhone!, to: cleanTo });
          return { success: true, messageSid: msg.sid, status: String(msg.status) };
        } catch (err: unknown) {
          return { success: false, error: (err as Error).message };
        }
      },
    }),

    sendEmail: createTool({
      id: 'send-email',
      description: 'Send an email via SMTP (Outlook, Gmail App Password, SendGrid SMTP, etc.).',
      inputSchema: z.object({
        to: z.string().describe('Recipient email address.'),
        subject: z.string().describe('Email subject line.'),
        body: z.string().describe('Plain text email body.'),
        htmlBody: z.string().optional().describe('Optional HTML body.'),
      }),
      execute: async ({ to, subject, body, htmlBody }: { to: string; subject: string; body: string; htmlBody?: string }) => {
        if (!keys.smtpHost || !keys.smtpUser || !keys.smtpPass)
          return { success: false, error: 'SMTP credentials not provided by tenant.' };
        try {
          const cleanPass = keys.smtpPass.trim().replace(/\s+/g, '');
          const transporter = nodemailer.createTransport({
            host: keys.smtpHost,
            port: keys.smtpPort || 587,
            secure: (keys.smtpPort || 587) === 465,
            auth: { user: keys.smtpUser, pass: cleanPass },
          });
          const info = await transporter.sendMail({
            from: keys.smtpFrom || keys.smtpUser,
            to,
            subject,
            text: body,
            html: htmlBody,
          });
          return { success: true, messageId: info.messageId };
        } catch (err: unknown) {
          return { success: false, error: (err as Error).message };
        }
      },
    }),

    makeVoiceCall: createTool({
      id: 'make-voice-call',
      description: 'Initiate an outbound voice call via Twilio TTS for proactive outreach.',
      inputSchema: z.object({
        to: z.string().describe('E.164 phone number to call.'),
        message: z.string().describe('Spoken message to deliver via Twilio TTS.'),
        voice: z.string().optional().describe('ElevenLabs voice persona ID (e.g. 21m00Tcm4TlvDq8ikWAM).'),
      }),
      execute: async ({ to, message, voice }: { to: string; message: string; voice?: string }) => {
        if (!hasTwilioCreds)
          return { success: false, error: 'Twilio credentials not provided by tenant.' };
        try {
          const client = await getTwilioClient(keys);
          const cleanTo = normalizePhone(to) || to;
          const sanitizedMessage = formatSpokenVoiceScript(message);
          const selectedVoice = voice || keys.elevenLabsVoiceId || keys.twilioVoice || '21m00Tcm4TlvDq8ikWAM';
          const publicBase = getPublicBackendUrl();
          const turnUrl = `${publicBase}/api/voice/webhook/turn?voice=${encodeURIComponent(selectedVoice)}&direction=outbound`;
          const statusUrl = `${publicBase}/api/voice/webhook/status`;

          let audioUrl: string | null = null;
          const useElevenLabs = keys.useElevenLabs || Boolean(keys.elevenLabsApiKey);
          if (useElevenLabs && keys.elevenLabsApiKey) {
            try {
              const elAudio = await generateElevenLabsAudioBuffer({
                text: sanitizedMessage,
                voiceId: keys.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM',
                apiKey: keys.elevenLabsApiKey,
                modelId: keys.elevenLabsModel || 'eleven_turbo_v2_5',
                stability: keys.elevenLabsStability,
                similarityBoost: keys.elevenLabsSimilarity,
              });
              if (elAudio?.cacheId) {
                audioUrl = `${publicBase}/api/voice/elevenlabs/audio/${elAudio.cacheId}.mp3`;
              }
            } catch {}
          }

          const conversationalTwiML = generateGatherTwiML({
            speech: sanitizedMessage,
            voice: selectedVoice,
            turnUrl,
            isEnding: false,
            audioUrl,
          });

          const call = await client.calls.create({
            to: cleanTo,
            from: keys.twilioFromPhone!,
            twiml: conversationalTwiML,
            statusCallback: statusUrl,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
            statusCallbackMethod: 'POST',
          });

          // Register session
          const session: CallSession = {
            callSid: call.sid,
            businessId: 'tool-caller',
            from: keys.twilioFromPhone!,
            to: cleanTo,
            direction: 'outbound',
            voice: selectedVoice,
            status: 'in-progress',
            startedAt: new Date().toISOString(),
            turns: [{
              role: 'ai',
              text: message,
              timestamp: new Date().toISOString(),
              voice: selectedVoice,
            }],
          };
          upsertCallSession(session);

          let latestStatus = String(call.status);
          for (let p = 0; p < 2; p++) {
            await new Promise(r => setTimeout(r, 1200));
            try {
              const fetched = await client.calls(call.sid).fetch();
              latestStatus = String(fetched.status);
              if (latestStatus !== 'queued') break;
            } catch {
              break;
            }
          }

          return { success: true, callSid: call.sid, status: latestStatus, voice: selectedVoice, interactive: true };
        } catch (err: unknown) {
          const msg = (err as Error).message;
          if (msg.includes('trial') || msg.includes('unverified')) {
            return {
              success: false,
              error: `Twilio Trial Limitation: Phone number ${to} must be verified. Details: ${msg}`,
            };
          }
          return { success: false, error: msg };
        }
      },
    }),

    sendWhatsApp: createTool({
      id: 'send-whatsapp',
      description: 'Send a WhatsApp message via Twilio WhatsApp channel.',
      inputSchema: z.object({
        to: z.string().describe('WhatsApp phone number: whatsapp:+15551234567'),
        message: z.string().describe('WhatsApp message body.'),
      }),
      execute: async ({ to, message }: { to: string; message: string }) => {
        if (!hasTwilioCreds)
          return { success: false, error: 'Twilio credentials not provided by tenant.' };
        try {
          const client = await getTwilioClient(keys);
          const cleanTo = normalizePhone(to) || to;
          const msg = await client.messages.create({
            body: message,
            from: `whatsapp:${keys.twilioFromPhone!}`,
            to: cleanTo.startsWith('whatsapp:') ? cleanTo : `whatsapp:${cleanTo}`,
          });
          return { success: true, messageSid: msg.sid, status: String(msg.status) };
        } catch (err: unknown) {
          return { success: false, error: (err as Error).message };
        }
      },
    }),
  };
}
