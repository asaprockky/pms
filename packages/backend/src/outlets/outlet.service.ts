import { Injectable } from '@nestjs/common';

@Injectable()
export class OutletService {
  async getMenu(outletId: string) {
    return [
      { id: '1', name: 'Sample Item 1', category: 'food', price: 50000 },
      { id: '2', name: 'Sample Item 2', category: 'drink', price: 20000 },
    ];
  }
}
