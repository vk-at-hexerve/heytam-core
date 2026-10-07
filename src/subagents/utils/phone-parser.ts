/**
 * HeyTam Phone Parser Utility
 * Robust international phone number extraction and normalization.
 */

export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');

  // Must have at least 10 digits and at most 15 digits (E.164 standard)
  if (digitsOnly.length < 10 || digitsOnly.length > 15) return null;

  if (trimmed.startsWith('+')) {
    return `+${digitsOnly}`;
  }

  if (trimmed.startsWith('00')) {
    return `+${digitsOnly.slice(2)}`;
  }

  // 10-digit number without +
  if (digitsOnly.length === 10) {
    if (/^[6-9]/.test(digitsOnly)) {
      return `+91${digitsOnly}`;
    }
    return `+1${digitsOnly}`;
  }

  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`;
  }

  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return `+${digitsOnly}`;
  }

  return `+${digitsOnly}`;
}

export function extractPhoneNumbers(text: string, excludePhone?: string): string[] {
  if (!text) return [];

  const excludeDigits = excludePhone ? excludePhone.replace(/\D/g, '') : null;
  const found: string[] = [];

  const isExcluded = (phone: string) => {
    if (!excludeDigits) return false;
    const d = phone.replace(/\D/g, '');
    return d === excludeDigits || d.endsWith(excludeDigits) || excludeDigits.endsWith(d);
  };

  // 1. Check explicit headers first: RECIPIENT_PHONES or RECIPIENT_PHONE
  const phonesHeaderMatch = text.match(/RECIPIENT_PHONES\s*:\s*([^\n]+)/i);
  if (phonesHeaderMatch) {
    const parts = phonesHeaderMatch[1].split(/[,;|\s]+/);
    for (const p of parts) {
      const normalized = normalizePhone(p);
      if (normalized && !isExcluded(normalized) && !found.includes(normalized)) {
        found.push(normalized);
      }
    }
  }

  const singleHeaderMatch = text.match(/RECIPIENT_PHONE\s*:\s*([^\n]+)/i);
  if (singleHeaderMatch) {
    const normalized = normalizePhone(singleHeaderMatch[1]);
    if (normalized && !isExcluded(normalized) && !found.includes(normalized)) {
      found.push(normalized);
    }
  }

  // 2. Extract international format (+countrycode...) and standard numbers from entire text
  const regex = /(?:\+|00)?(?:[1-9]\d{0,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,9}/g;
  const matches = text.match(regex) || [];

  for (const m of matches) {
    const raw = m.trim();
    if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(raw)) continue;
    if (/\d+:\d+/.test(raw)) continue;

    const normalized = normalizePhone(raw);
    if (normalized && !isExcluded(normalized) && !found.includes(normalized)) {
      found.push(normalized);
    }
  }

  return found;
}

/**
 * Formats and sanitizes spoken voice scripts for Twilio Text-to-Speech:
 * - Introduces the business warmly
 * - Strips any recited phone numbers or raw digit sequences so TTS never repeats them
 * - Strips internal agent meta-phrases ("I will proceed to...", "Calling...")
 * - Ensures natural second-person phrasing ("your appointment", "you")
 */
export function formatSpokenVoiceScript(rawMessage: string | undefined, tenantContext?: string): string {
  const bizMatch = tenantContext?.match(/Business(?:\s+Name)?:\s*([^\n,]+)/i);
  const businessName = bizMatch
    ? bizMatch[1].trim()
    : (tenantContext && !tenantContext.includes('---') && tenantContext.trim() !== 'HeyTam AI Workforce'
        ? tenantContext.split('\n')[0].replace(/^Business:\s*/i, '').trim()
        : 'HeyTam');

  let text = (rawMessage || '').replace(/<[^>]+>/g, '').trim();

  // Extract operating timings from context if available
  const timingsMatch = tenantContext?.match(/(?:Operating|Available)?\s*(?:Timings|Hours):\s*([^\n]+)/i);
  const defaultTimings = timingsMatch ? timingsMatch[1].trim() : 'Monday through Friday from 9:00 AM to 6:00 PM';

  // Scrub or replace placeholders like [insert service timings]
  text = text
    .replace(/\[\s*insert\s*(?:service\s*)?timings?\s*\]/gi, defaultTimings)
    .replace(/\[\s*insert\s*(?:service\s*details?|services?)\s*\]/gi, 'our treatments and healthcare services')
    .replace(/\[\s*insert[^\]]*\]/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\.{3,}/g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 1. Strip phone numbers or digit sequences so Twilio TTS never speaks phone numbers aloud
  text = text
    .replace(/(?:\+|00)?\d{1,4}[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,9}/g, '')
    .replace(/\b\d{7,15}\b/g, '')
    .replace(/\bto\s+(?:the\s+)?(?:number|phone)\b/gi, '')
    .trim();

  // 2. Strip internal agent commentary/preamble
  text = text
    .replace(/^(?:hello!?,?\s*)?(?:i will|i'll|i am going to|proceeding to|calling|i will proceed to|we will)\s+(?:make a call|call|reach out|contact|dial|inform|tell|notify)[^.:]*[.:]\s*/i, '')
    .replace(/^(?:calling|contacting|dialing)\s+/i, '')
    .replace(/^(?:to\s+)?(?:inform|tell|notify|let them know)\s+(?:the\s+)?(?:client|customer|patient|them)\s+that\s+/i, '')
    .replace(/^(?:i will|i'll|we will)\s+(?:proceed to\s+)?/i, '')
    .trim();

  // 3. Convert third person to second person
  text = text
    .replace(/\btheir appointment\b/gi, 'your appointment')
    .replace(/\btheir booking\b/gi, 'your booking')
    .replace(/\bthem that\b/gi, 'you that')
    .trim();

  if (!text || text.length < 8) {
    text = `Hello! This is ${businessName}. I am calling regarding our available services and consultation timings. Our availability is ${defaultTimings}. What timing works best for you?`;
    return text;
  }

  const hasGreeting = /^(hello|hi|good\s+morning|good\s+afternoon|good\s+evening)/i.test(text);
  const mentionsBusiness = text.toLowerCase().includes(businessName.toLowerCase());

  if (!mentionsBusiness && !hasGreeting) {
    const capitalized = text.charAt(0).toUpperCase() + text.slice(1);
    return `Hello! This is an automated notification from ${businessName}. ${capitalized} If you need to make any changes or have questions, please reach back out to us. Have a wonderful day!`;
  } else if (!mentionsBusiness && hasGreeting) {
    return text.replace(/^(hello|hi|good\s+morning|good\s+afternoon|good\s+evening)[!,.]?\s*/i, (match) => {
      const cleanMatch = match.replace(/[!,.]/g, '').trim();
      return `${cleanMatch}! This is ${businessName}. `;
    });
  } else if (!hasGreeting) {
    return `Hello! ${text.charAt(0).toUpperCase() + text.slice(1)}`;
  }

  return text;
}

