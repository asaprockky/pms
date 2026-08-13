export interface Room {
  id: string;
  number: string;
  type: string;
  price: number;
}

export interface Guest {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

export interface Reservation {
  id: string;
  guestId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  status: string;
}

export const getRooms = async (): Promise<Room[]> => {
  return [];
};

export const getGuests = async (): Promise<Guest[]> => {
  return [];
};
