import twilio from 'twilio';
import type { TenantKeys } from '../schema.js';

let cachedAccountSid: string | null = null;

export async function getTwilioClient(keys: TenantKeys): Promise<twilio.Twilio> {
  const sid = (keys.twilioApiKeySid || keys.twilioAccountSid || '').trim();
  const secret = (keys.twilioApiKeySecret || keys.twilioAuthToken || '').trim();

  if (sid.startsWith('SK')) {
    let parentAccountSid = keys.twilioAccountSid && keys.twilioAccountSid.startsWith('AC')
      ? keys.twilioAccountSid.trim()
      : cachedAccountSid;

    if (!parentAccountSid) {
      try {
        const auth = Buffer.from(`${sid}:${secret}`).toString('base64');
        const res = await fetch('https://api.twilio.com/2010-04-01/Accounts.json', {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (res.ok) {
          const accData: any = await res.json();
          parentAccountSid = accData.accounts?.[0]?.sid || accData.accounts?.[0]?.owner_account_sid;
          if (parentAccountSid) {
            cachedAccountSid = parentAccountSid;
            keys.twilioAccountSid = parentAccountSid;
          }
        }
      } catch (err) {
        console.warn('[TwilioClient] Could not resolve parent Account SID for API Key:', err);
      }
    }

    return twilio(sid, secret, parentAccountSid ? { accountSid: parentAccountSid } : undefined);
  }

  return twilio(sid, secret);
}
