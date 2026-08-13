import { Injectable } from '@nestjs/common';

@Injectable()
export class OfflineService {
  async processOfflineQueue(hotelId: string) {
    return { syncedCount: 0, status: 'synced' };
  }
}
