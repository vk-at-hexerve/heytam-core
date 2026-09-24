import { openai, createOpenAI } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';

/**
 * Returns the Vercel AI SDK model instance based on the AI_BACKEND environment variable.
 */
export function getAgentModel() {
  const backend = process.env.AI_BACKEND?.toUpperCase() || 'OPENAI';

  switch (backend) {
    case 'ANTHROPIC':
      return anthropic('claude-3-5-sonnet-20240620');
      
    case 'COPILOT':
      // GitHub Copilot uses Azure OpenAI models. Using a GitHub PAT, we can access the 
      // copilot API endpoint natively, preserving the Vercel AI SDK tool-calling features 
      // (which the raw 'gh copilot cli' cannot do natively).
      const copilotProvider = createOpenAI({
        baseURL: process.env.COPILOT_API_BASE_URL || 'https://api.githubcopilot.com',
        apiKey: process.env.GITHUB_PAT || 'dummy_token',
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_PAT}`,
          'Editor-Version': 'vscode/1.84.0',
        }
      });
      // Use the model provided by the Copilot subscription
      return copilotProvider('gpt-4o');

    case 'OPENAI':
    default:
      return openai('gpt-4o');
  }
}
