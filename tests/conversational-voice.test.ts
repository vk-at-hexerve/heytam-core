import { describe, it, expect } from 'vitest';
import {
  generateGatherTwiML,
  generateClosingTwiML,
  escapeXml,
  callSessionsStore,
  upsertCallSession,
  getCallSession,
  registerOrchestratorLogger,
  logToOrchestrator,
  type CallSession,
} from '../src/subagents/engine/voice-session.js';
import { TWILIO_VOICE_PACKS } from '../src/subagents/catalog/toolCatalog.js';

describe('HeyTam Conversational Voice Engine', () => {
  it('should escape XML entities safely', () => {
    const raw = 'Hello & welcome <to> "HeyTam" clinic \'appointments\'';
    const escaped = escapeXml(raw);
    expect(escaped).toBe('Hello &amp; welcome &lt;to&gt; &quot;HeyTam&quot; clinic &apos;appointments&apos;');
  });

  it('should generate valid interactive TwiML with Gather speech recognition and neural voice', () => {
    const twiml = generateGatherTwiML({
      speech: 'Hello! This is Sophia from Gold Eye Sight. How can I help you today?',
      voice: 'Polly.Joanna-Neural',
      turnUrl: 'http://20.241.243.241/api/voice/webhook/turn?businessId=biz_123&runId=run_456&voice=Polly.Joanna-Neural',
      isEnding: false,
    });

    expect(twiml).toContain('<Response>');
    expect(twiml).toContain('<Gather input="speech"');
    expect(twiml).toContain('speechTimeout="auto"');
    expect(twiml).toContain('voice="Polly.Joanna-Neural"');
    expect(twiml).toContain('action="http://20.241.243.241/api/voice/webhook/turn?businessId=biz_123&amp;runId=run_456&amp;voice=Polly.Joanna-Neural"');
    expect(twiml).toContain('Hello! This is Sophia from Gold Eye Sight');
    expect(twiml).toContain('<Hangup/>');
  });

  it('should generate closing TwiML when conversation concludes', () => {
    const twiml = generateClosingTwiML({
      speech: 'Thank you for calling. Have a wonderful day. Goodbye!',
      voice: 'Polly.Matthew-Neural',
    });

    expect(twiml).toContain('<Response>');
    expect(twiml).toContain('<Say voice="Polly.Matthew-Neural">Thank you for calling. Have a wonderful day. Goodbye!</Say>');
    expect(twiml).toContain('<Hangup/>');
    expect(twiml).not.toContain('<Gather');
  });

  it('should manage multi-turn call sessions and register to orchestrator', () => {
    const testCallSid = `CA_test_${Date.now()}`;
    const session: CallSession = {
      callSid: testCallSid,
      businessId: 'biz_test_1',
      runId: 'run_test_99',
      from: '+17372508034',
      to: '+919958241284',
      direction: 'outbound',
      voice: 'Polly.Joanna-Neural',
      status: 'in-progress',
      startedAt: new Date().toISOString(),
      turns: [{
        role: 'ai',
        text: 'Initial outreach greeting',
        timestamp: new Date().toISOString(),
        voice: 'Polly.Joanna-Neural',
      }],
    };

    upsertCallSession(session);
    const fetched = getCallSession(testCallSid);
    expect(fetched).toBeDefined();
    expect(fetched?.callSid).toBe(testCallSid);
    expect(fetched?.turns.length).toBe(1);

    // Simulate customer turn
    fetched?.turns.push({
      role: 'customer',
      text: 'What are your clinic hours tomorrow?',
      timestamp: new Date().toISOString(),
      confidence: 0.98,
    });
    expect(fetched?.turns.length).toBe(2);
    expect(fetched?.turns[1].role).toBe('customer');

    // Test orchestrator logging
    const loggedLines: string[] = [];
    registerOrchestratorLogger((runId, logLine) => {
      loggedLines.push(`${runId}:${logLine}`);
    });

    logToOrchestrator('run_test_99', '👤 Customer: "What are your clinic hours tomorrow?"');
    expect(loggedLines.length).toBe(1);
    expect(loggedLines[0]).toContain('What are your clinic hours tomorrow?');
  });

  it('should contain full catalog of Twilio in-built neural voice packs', () => {
    expect(TWILIO_VOICE_PACKS.length).toBeGreaterThanOrEqual(10);
    const joanna = TWILIO_VOICE_PACKS.find(v => v.value === 'Polly.Joanna-Neural');
    const matthew = TWILIO_VOICE_PACKS.find(v => v.value === 'Polly.Matthew-Neural');
    const kajal = TWILIO_VOICE_PACKS.find(v => v.value === 'Polly.Kajal-Neural');
    expect(joanna).toBeDefined();
    expect(matthew).toBeDefined();
    expect(kajal).toBeDefined();
  });
});
