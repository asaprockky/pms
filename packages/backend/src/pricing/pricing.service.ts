import { Injectable } from '@nestjs/common';

@Injectable()
export class PricingService {
  async getPricingRecommendation(query: string, lang?: string) {
    return {
      reply: `Sample pricing recommendation for query: ${query}`,
    };
  }
}