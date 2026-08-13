import { Injectable } from '@nestjs/common';

@Injectable()
export class ConciergeService {
  async handleGuestMessage(guestId: string, text: string) {
    return {
      reply: `Sample Concierge response to "${text}"`,
      status: 'success',
    };
  }
}
