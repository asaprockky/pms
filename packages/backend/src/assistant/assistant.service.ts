import { Injectable } from '@nestjs/common';

export interface AssistantMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AssistantOptions {
  lang?: string;
  context?: string;
}

@Injectable()
export class AssistantService {
  async processRequest(messages: AssistantMessage[], opts: AssistantOptions = {}) {
    const lang = opts.lang || 'en';
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
    
    return {
      reply: `Sample AI Assistant response to: "${lastUserMsg?.content || ''}" [Lang: ${lang}]`,
      usedAi: true,
    };
  }

  private buildSystemPrompt(role: string, lang: string): string {
    return `System Assistant Role: ${role}. Respond in user language. Default: ${lang}.`;
  }
}
