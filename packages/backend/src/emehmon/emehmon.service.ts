import { Injectable } from '@nestjs/common';

@Injectable()
export class EmehmonService {
  async submitGuestRegistration(guestData: any) {
    return { status: 'submitted', referenceId: 'REG-SAMPLE-12345' };
  }
}
