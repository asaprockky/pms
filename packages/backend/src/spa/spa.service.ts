import { Injectable } from '@nestjs/common';

@Injectable()
export class SpaService {
  async getTreatments(hotelId: string) {
    return [
      { id: '1', name: 'Sample Treatment 1', category: 'massage', durationMin: 60, price: 200000 },
    ];
  }
}
