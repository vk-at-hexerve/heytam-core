/**
 * PHI (Protected Health Information) Scrubber
 * 
 * In a HIPAA-compliant environment, sensitive patient data should be redacted
 * or anonymized before being transmitted to external LLM providers, unless
 * a Business Associate Agreement (BAA) is actively maintained with the provider 
 * (e.g., Azure OpenAI HIPAA compliant endpoints).
 */

export class PhiScrubber {
  /**
   * Redacts common PII/PHI patterns from a text payload.
   * Note: In a production healthcare environment, consider using a dedicated NLP 
   * engine like Azure AI Health Bot or AWS Comprehend Medical for robust entity extraction.
   */
  static redact(text: string): string {
    let scrubbed = text;
    
    // Mask Social Security Numbers (SSN)
    scrubbed = scrubbed.replace(/\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g, '[REDACTED_SSN]');
    
    // Mask Email Addresses
    scrubbed = scrubbed.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[REDACTED_EMAIL]');
    
    // Mask Phone Numbers (Standard US)
    scrubbed = scrubbed.replace(/\b(?:\+?1[-.]?)?\(?([0-9]{3})\)?[-.]?([0-9]{3})[-.]?([0-9]{4})\b/g, '[REDACTED_PHONE]');

    // Mask Medicare / Health Plan Identifiers (Basic mock regex)
    scrubbed = scrubbed.replace(/\b[A-Z0-9]{8,12}\b/g, (match) => {
        // Skip common capitalized words, target alphanumeric IDs
        return /^[A-Z]+$/.test(match) ? match : '[REDACTED_HEALTH_ID]';
    });

    return scrubbed;
  }
}
