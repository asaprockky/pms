// The API lives under /api on the same origin as the SPA: in production one
// NestJS process serves both, and in dev Vite proxies /api to it (vite.config.ts).
// Same-origin also means no CORS preflight and no cookie/origin mismatch.
//
// VITE_API_BASE stays as an escape hatch for pointing a local build at another
// machine — e.g. testing on a phone against a dev box on the LAN.
const ORIGIN = ((import.meta.env?.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '');
const BASE = `${ORIGIN}/api`;

/** Root of the API, including the /api prefix. */
export const getApiBase = () => BASE;

/**
 * Absolute origin of this deployment, for URLs shown to a human or handed to a
 * third party. Not the same as getApiBase(): callbacks registered with external
 * providers (Payme, Telegram) are mounted at the root, outside /api.
 */
export const getPublicOrigin = () =>
  ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '');

let activeHotelId = localStorage.getItem('pos.hotelId') || 'h1';
export const setActiveHotel = (id: string) => {
  activeHotelId = id;
  localStorage.setItem('pos.hotelId', id);
};
export const getActiveHotel = () => activeHotelId;

let authToken: string | null = localStorage.getItem('atlas.token');
export const setToken = (token: string | null) => {
  authToken = token;
  if (token) localStorage.setItem('atlas.token', token);
  else localStorage.removeItem('atlas.token');
};
export const getToken = () => authToken;

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export const BOOKING_SOURCES = [
  'manual',
  'booking_com',
  'ostrovok',
  'channex',
  'booking_engine',
  'telegram',
] as const;

export const CHARGE_CATEGORIES = [
  'lodging',
  'restaurant',
  'minibar',
  'room_service',
  'spa',
  'transport',
  'laundry',
  'other',
] as const;

export const DOC_TYPES = [
  'passport',
  'id_card',
  'international',
  'local',
] as const;

export const SEGMENTS = [
  'vip',
  'loyal',
  'active',
  'at_risk',
  'win_back',
  'one_time',
  'lead',
] as const;

export const CAMPAIGN_TEMPLATES = [
  'comeback_offer',
  'special_offer',
  'vip_thanks',
  'newsletter',
] as const;

export const MESSAGE_CHANNELS = [
  'email',
  'telegram',
  'whatsapp',
  'sms',
] as const;

export interface Hotel {
  id: string;
  name: string;
  legalName?: string | null;
  stars: number;
  address?: string | null;
  city?: string | null;
  country: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  taxId?: string | null;
  currency: string;
  checkInTime: string;
  checkOutTime: string;
  description?: string | null;
  createdAt: string;
}

export interface Room {
  id: string;
  hotelId: string;
  number: string;
  type: string;
  pricePerNight: number;
  status: string;
  housekeepingStatus: string;
  floor?: string | null;
  capacity: number;
  createdAt: string;
}

export interface Guest {
  id: string;
  hotelId: string;
  fullName: string;
  phone: string;
  email?: string | null;
  dob?: string | null;
  docType: string;
  pinfl?: string | null;
  passportNo?: string | null;
  citizenship?: string | null;
  pdnConsent: boolean;
  consentAt?: string | null;
  consentSource?: string | null;
  anonymizedAt?: string | null;
  preferences: string;
  createdAt: string;
}

export interface Message {
  id: string;
  hotelId: string;
  guestId: string;
  reservationId?: string | null;
  campaignId?: string | null;
  channel: string;
  template: string;
  body: string;
  status: string;
  scheduledFor: string;
  sentAt?: string | null;
  createdAt: string;
  guest?: { fullName: string };
}

export interface FeedbackItem {
  id: string;
  hotelId: string;
  guestId: string;
  reservationId: string;
  rating: number;
  comment?: string | null;
  createdAt: string;
  guest?: { fullName: string };
}

export interface Campaign {
  id: string;
  hotelId: string;
  name: string;
  segment: string;
  template: string;
  channel: string;
  sentCount: number;
  createdAt: string;
}

export interface SegmentGuest {
  id: string;
  fullName: string;
  phone: string;
  staysCount: number;
  totalPaid: number;
  daysSinceLastStay: number | null;
}

export interface GuestNote {
  id: string;
  hotelId: string;
  guestId: string;
  text: string;
  createdAt: string;
}

export interface Reservation {
  id: string;
  hotelId: string;
  guestId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  status: string;
  source: string;
  emehmonStatus: string;
  emehmonSubmittedAt?: string | null;
  emehmonDeadline?: string | null;
  onlineCheckedIn?: boolean;
  keyCode?: string | null;
  guestCount?: number;
  extraGuestIds?: string | null;
  note?: string | null;
  groupBlockId?: string | null;
  createdAt: string;
}

// Per-guest E-Mehmon status within a reservation's group (primary + co-guests).
export interface GuestEmehmonEntry {
  guestId: string;
  isPrimary: boolean;
  status: string;
  submittedAt?: string | null;
  ref?: string | null;
}

export interface Charge {
  id: string;
  hotelId: string;
  reservationId: string;
  folioId?: string;
  description: string;
  category: string;
  outlet?: string;
  amount: number;
  taxRate?: number;
  staffId?: string;
  serviceTime?: string;
  createdAt: string;
}

export interface Receipt {
  id: string;
  hotelId: string;
  paymentId: string;
  fiscalSign: string;
  qrPayload: string;
  offline: boolean;
  createdAt: string;
}

export interface Payment {
  id: string;
  hotelId: string;
  reservationId: string;
  amount: number;
  method: string;
  cashier?: string | null;
  status: string;
  createdAt: string;
  receipt?: Receipt | null;
}

export interface Stay {
  id: string;
  hotelId: string;
  reservationId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  status: string;
  isPrimary: boolean;
  ratePerNight?: number | null;
  room?: Room;
}

export interface Folio {
  reservation: Reservation;
  stays?: Stay[];
  folioId?: string;
  folioStatus?: string;
  payments: Payment[];
  charges: Charge[];
  chargesTotal: number;
  grandTotal: number;
  totalPaid: number;
  balance: number;
}

export interface RatePlan {
  id: string;
  hotelId: string;
  name: string;
  roomType: string;
  baseRate: number;
  weekendMultiplier: number;
  kind: string;
  parentId?: string | null;
  adjustmentPct: number;
  visibility: string;
  companyId?: string | null;
  minLos: number;
  active: boolean;
  maxLos?: number | null;
  meal?: string | null;
  cancelPolicy?: string | null;
  /** JSON array of RATE_PLAN_CHANNELS keys; null/absent = sold on every channel. */
  channels?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  createdAt: string;
}

export interface PromoCode {
  id: string;
  hotelId: string;
  code: string;
  discountPct: number;
  validFrom?: string | null;
  validTo?: string | null;
  active: boolean;
  createdAt: string;
}

export interface PackagePlan {
  id: string;
  hotelId: string;
  name: string;
  roomType?: string | null;
  services: { description: string; amount: number }[];
  active: boolean;
  createdAt: string;
}

export interface RateRestriction {
  id: string;
  hotelId: string;
  roomType?: string | null;
  dateFrom: string;
  dateTo: string;
  type: string;
  value: number;
  createdAt: string;
}

export interface AiRecommendation {
  date: string;
  currentPrice: number;
  recommendedPrice: number;
  multiplier: number;
  confidence: number;
  reasoning: string;
}

export interface PricingRule {
  id: string;
  hotelId: string;
  name: string;
  dateFrom: string;
  dateTo: string;
  multiplier: number;
  active: boolean;
  roomType?: string | null;
  source: string;
  createdAt: string;
}

export interface Quote {
  roomId: string;
  ratePlanId: string | null;
  nights: { date: string; price: number; applied: string[] }[];
  total: number;
  roomTotal?: number;
  bookable?: boolean;
  violations?: string[];
}

export interface RoomBlock {
  id: string;
  hotelId: string;
  roomId: string;
  dateFrom: string;
  dateTo: string;
  reason: string;
  note?: string | null;
  createdAt: string;
  room?: Room;
}

export interface GroupBlock {
  id: string;
  hotelId: string;
  name: string;
  color: string;
  note?: string | null;
  createdAt: string;
  reservations: (Reservation & { guest: Guest; room: Room })[];
}

export interface OverbookingRisk {
  roomId: string;
  date: string;
  count: number;
  reservationIds: string[];
}

export interface RateHint {
  price: number;
  rules: string[];
}

export interface TapeChartGrid {
  rooms: Room[];
  reservations: (Reservation & { guest: Guest; room: Room; payments: Payment[]; charges: Charge[]; groupBlock: GroupBlock | null })[];
  blocks: (RoomBlock & { room: Room })[];
  groupBlocks: GroupBlock[];
  overbookingRisk: OverbookingRisk[];
  rateHints: Record<string, Record<string, RateHint>>;
}

export interface DragMoveResult {
  id: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  status: string;
  priceDiff: number;
  message?: string;
}

export interface TodayArrivals {
  arrivals: (Reservation & { guest: Guest; room: Room })[];
  departures: (Reservation & { guest: Guest; room: Room })[];
}

export interface GuestIncident {
  id: string;
  hotelId: string;
  guestId: string;
  title: string;
  detail?: string | null;
  severity: string;
  status: string;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface GuestProfile {
  guest: Guest & {
    notes: GuestNote[];
    messages: Message[];
    feedback: FeedbackItem[];
    incidents: GuestIncident[];
    tags: string[];
  };
  reservations: (Reservation & {
    room: Room;
    payments: Payment[];
    charges: Charge[];
    feedback?: FeedbackItem | null;
  })[];
  rfm: {
    recency: number;
    frequency: number;
    monetary: number;
    daysSinceLastStay: number | null;
    staysCount: number;
    totalPaid: number;
  };
  segment: string;
  metrics: {
    lifetimeValue: number;
    personalADR: number;
    nights: number;
    seasonality: number[];
  };
  spending: {
    roomRevenue: number;
    ancillaryRevenue: number;
    totalPaid: number;
    byMethod: Record<string, number>;
    byCategory: Record<string, number>;
  };
}

export interface DashboardStats {
  rooms: {
    total: number;
    occupied: number;
    available: number;
    dirty: number;
    maintenance: number;
    occupancyRate: number;
  };
  today: {
    arrivals: number;
    departures: number;
    inHouse: number;
    revenue: number;
  };
  revenue: {
    today: number;
    month: number;
    total: number;
    adr: number;
    series: { date: string; revenue: number }[];
    byMethod: Record<string, number>;
  };
  reservations: {
    total: number;
    pendingEmehmon: number;
    bySource: Record<string, number>;
  };
  guests: number;
  upcoming: {
    id: string;
    guestName: string;
    roomNumber: string;
    checkIn: string;
    checkOut: string;
    status: string;
    emehmonStatus: string;
    source: string;
  }[];
  vipInHouse: {
    id: string;
    guestName: string;
    roomNumber: string;
    roomType: string;
    checkOut: string;
    nights: number;
  }[];
  pickup: { date: string; count: number }[];
  finance: {
    currency: string;
    income: number;
    vat: number;
    net: number;
    paid: number;
  };
  team: { dept: string; open: number; overdue: number }[];
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) ?? {}),
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    if (res.status === 401) {
      setToken(null);
      onUnauthorized?.();
    }
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      message = Array.isArray(body.message)
        ? body.message.join(', ')
        : body.message || message;
    } catch {}
    throw new Error(message);
  }
  return res.json();
}

export const hp = (extra = '') =>
  `?hotelId=${encodeURIComponent(activeHotelId)}${extra}`;

export const getHotels = () => request<Hotel[]>('/hotels');
export const getHotel = (id: string) => request<Hotel>(`/hotels/${id}`);

// ── RFID Cards ─────────────────────────────────────────────────────────────
export interface RfidCard {
  id: string; uid: string; type: string; status: string;
  guestId: string | null; folioId: string | null; reservationId: string | null;
  cardRole: string; linkedCardIds: string; issuedBy: string | null;
  issuedAt: string; expiresAt: string | null; replacedBy: string | null;
  dailyLimitUsd: number | null; maxSingleTxUsd: number | null;
  barAccess: boolean; allowedZones: string; blockedZones: string;
  dailySpentToday: number; lastResetDate: string | null;
  offlineTrustLimit: number; createdAt: string; updatedAt: string;
  blockReason?: string | null;
  // Server-computed wallet balance over the FULL transaction history.
  balance?: number;
  // The list endpoint eager-loads recent transactions per card.
  transactions?: CardTransaction[];
}
export interface CardTransaction {
  id: string; cardId: string; hotelId: string; folioId: string | null;
  type: string; category: string; amountUsd: number; amountUzs: number;
  description: string | null; terminalId: string | null;
  operatorId: string | null; operatorName: string | null;
  status: string; declineReason: string | null; offline: boolean;
  syncedAt: string | null; createdAt: string;
}
export const getCards = (activeOnly?: boolean) =>
  request<RfidCard[]>(`/cards${hp()}${activeOnly ? '&active_only=true' : ''}`);
export const getCard = (id: string) =>
  request<RfidCard>(`/cards/${id}`);
export const createCard = (data: Partial<RfidCard>) =>
  request<RfidCard>('/cards', { method: 'POST', body: JSON.stringify(data) });
export const updateCard = (id: string, data: Partial<RfidCard>) =>
  request<RfidCard>(`/cards/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const blockCard = (id: string, reason?: string) =>
  request<RfidCard>(`/cards/${id}/block`, { method: 'PATCH', body: JSON.stringify({ reason }) });
export const authorizeCard = (data: { uid: string; terminalId?: string; zone?: string; amountUsd?: number; description?: string; operatorId?: string }) =>
  request<{ approved: boolean; transactionId?: string; folioBalance?: number; declineReason?: string }>('/cards/authorize', { method: 'POST', body: JSON.stringify(data) });
export const getCardTransactions = (id: string, from?: string, to?: string) =>
  request<CardTransaction[]>(`/cards/${id}/transactions${from || to ? `?${from ? `from=${from}` : ''}${from && to ? '&' : ''}${to ? `to=${to}` : ''}` : ''}`);
export const depositToCard = (id: string, amountUsd: number, method: string, cashierId?: string) =>
  request<CardTransaction>(`/cards/${id}/deposit`, { method: 'POST', body: JSON.stringify({ amountUsd, method, cashierId }) });
export const updateCardLimits = (id: string, data: any) =>
  request<RfidCard>(`/cards/${id}/limits`, { method: 'PATCH', body: JSON.stringify(data) });
export const syncOfflineTransactions = (transactions: any[]) =>
  request<CardTransaction[]>('/cards/sync', { method: 'POST', body: JSON.stringify({ transactions }) });
export const updateHotel = (id: string, data: Partial<Hotel>) =>
  request<Hotel>(`/hotels/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const getDashboard = () =>
  request<DashboardStats>(`/stats/dashboard${hp()}`);

export interface RevenueCockpit {
  window: string;
  horizon: number;
  metrics: {
    adr: number;
    revpar: number;
    occupancy: number;
    roomRevenue: number;
    roomNightsSold: number;
    totalRooms: number;
  };
  channels: { channel: string; revenue: number; bookings: number; pct: number }[];
  pace: {
    recent: number;
    prior: number;
    pickupPct: number;
    cancelledRecent: number;
    cancellationRate: number;
    pickupDrop: boolean;
    cancellationSpike: boolean;
  };
  forecast: {
    date: string;
    onBooks: number;
    projectedOccupancy: number;
    expectedRevenue: number;
  }[];
  summary: string;
}

export const getCockpit = (horizon = 30) =>
  request<RevenueCockpit>(`/revenue/cockpit${hp(`&horizon=${horizon}`)}`);

export const getRooms = () => request<Room[]>(`/rooms${hp()}`);

export const createRoom = (data: {
  number: string;
  type: string;
  pricePerNight: number;
  floor?: string;
  capacity?: number;
}) =>
  request<Room>('/rooms', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: activeHotelId }),
  });

export const updateRoom = (id: string, data: Partial<Room>) =>
  request<Room>(`/rooms/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const getGuests = (search?: string) =>
  request<Guest[]>(
    `/guests${hp(search ? `&search=${encodeURIComponent(search)}` : '')}`,
  );

export const createGuest = (data: {
  fullName: string;
  phone: string;
  email?: string;
  dob?: string;
  docType: string;
  passportNo: string;
  citizenship: string;
  pinfl?: string;
  pdnConsent?: boolean;
}) =>
  request<Guest>('/guests', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: activeHotelId }),
  });

export const getGuestProfile = (id: string) =>
  request<GuestProfile>(`/guests/${id}/profile`);

export const addGuestNote = (id: string, text: string) =>
  request<GuestNote>(`/guests/${id}/notes`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });

// ── GDPR (P12.1): consent capture, data export (right to access), erasure ──
export const recordGuestConsent = (
  id: string,
  data: { source?: string; granted?: boolean },
) =>
  request(`/guests/${id}/consent`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const exportGuestData = (id: string) =>
  request<{ exportedAt: string; subject: unknown; reservations: unknown[] }>(
    `/guests/${id}/export`,
  );

export const eraseGuest = (id: string) =>
  request<{ erased: boolean }>(`/guests/${id}`, { method: 'DELETE' });

export const getReservations = (status?: string) =>
  request<Reservation[]>(
    `/reservations${hp(status ? `&status=${encodeURIComponent(status)}` : '')}`,
  );

export const checkAvailability = (
  roomId: string,
  checkIn: string,
  checkOut: string,
) =>
  request<{ available: boolean }>(
    `/reservations/availability?roomId=${encodeURIComponent(roomId)}&checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}`,
  );

export const createReservation = (data: {
  guestId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  source?: string;
  note?: string;
  guestCount?: number;
  extraGuestIds?: string[];
  extraRooms?: { roomId: string; totalPrice: number }[];
  status?: 'confirmed' | 'pending';
  depositAmount?: number;
  depositMethod?: string;
}) =>
  request<Reservation>('/reservations', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: activeHotelId }),
  });

export const moveReservation = (id: string, roomId: string) =>
  request<Reservation>(`/reservations/${id}/move`, {
    method: 'PATCH',
    body: JSON.stringify({ roomId }),
  });

// Extend/shorten a stay — validates room availability and recomputes
// totalPrice at the existing nightly rate.
export const changeReservationDates = (id: string, dto: { checkIn?: string; checkOut: string }) =>
  request<Reservation>(`/reservations/${id}/dates`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });

export const getReservationEmehmonGroup = (id: string) =>
  request<GuestEmehmonEntry[]>(`/reservations/${id}/emehmon-group`);

export const submitGuestEmehmon = (id: string, guestId: string) =>
  request<GuestEmehmonEntry[]>(`/reservations/${id}/guests/${guestId}/emehmon`, { method: 'POST' });

export const addCharge = (
  id: string,
  data: { description: string; category: string; amount: number },
) =>
  request<Charge>(`/reservations/${id}/charges`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const submitEmehmon = (id: string) =>
  request<Reservation>(`/reservations/${id}/emehmon`, { method: 'POST' });

// ─── E-Mehmon workstation ─────────────────────────────────────────────────
export interface EmehmonGuestRow {
  guestId: string;
  isPrimary: boolean;
  name: string;
  citizenship: string | null;
  docType: string | null;
  passportNo: string | null;
  dob: string | null;
  status: string;
  submittedAt: string | null;
  ref: string | null;
  missingDocs: string[];
}

export interface EmehmonQueueRow {
  id: string;
  status: string;
  checkIn: string;
  checkOut: string;
  roomNumber: string;
  roomType: string;
  emehmonStatus: string;
  deadline: string | null;
  guests: EmehmonGuestRow[];
}

export interface EmehmonHistoryRow {
  id: string;
  number: string | null;
  status: string;
  issuedAt: string;
  reservationId: string | null;
  guestId: string | null;
  guestName: string;
}

export interface EmehmonQueue {
  offline: boolean;
  queuedCount: number;
  rows: EmehmonQueueRow[];
  history: EmehmonHistoryRow[];
}

export const getEmehmonQueue = () => request<EmehmonQueue>(`/emehmon/queue${hp()}`);

export const flushEmehmonQueue = () =>
  request<{ flushed: number; stillOffline: boolean }>(`/emehmon/flush${hp()}`, { method: 'POST' });

export const checkIn = (id: string, opts: { earlyArrival?: boolean } = {}) =>
  request<Reservation>(`/reservations/${id}/check-in`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });

export const checkOut = (
  id: string,
  opts: { override?: boolean; lateCheckout?: boolean } = {},
) =>
  request<Reservation>(`/reservations/${id}/check-out`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });

export const onlineCheckIn = (id: string) =>
  request<Reservation>(`/reservations/${id}/online-checkin`, {
    method: 'POST',
  });

export const getOnlineQueue = () =>
  request<(Reservation & { guest: Guest; room: Room })[]>(
    `/reservations/online-queue${hp()}`,
  );

export const ocrPassport = (sample?: number) =>
  request<{
    fullName: string;
    dob: string;
    docType: string;
    passportNo: string;
    citizenship: string;
    demo: boolean;
  }>('/guests/ocr', {
    method: 'POST',
    body: JSON.stringify({ sample }),
  });

export const cancelReservation = (id: string) =>
  request<Reservation>(`/reservations/${id}/cancel`, { method: 'POST' });

export const confirmReservation = (id: string) =>
  request<Reservation>(`/reservations/${id}/confirm`, { method: 'POST' });

export const createPayment = (data: {
  reservationId: string;
  amount: number;
  method: string;
}) =>
  request<Payment>('/payments', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const getFolio = (id: string) =>
  request<Folio>(`/reservations/${id}/folio`);

export interface OpenFolioRow {
  id: string;
  guest: string;
  extraGuestNames: string[];
  vip: boolean;
  roomNumber: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  chargesTotal: number;
  grandTotal: number;
  totalPaid: number;
  balance: number;
}

export const getOpenFolios = (hotelId: string) =>
  request<OpenFolioRow[]>(`/reservations/open-folios?hotelId=${encodeURIComponent(hotelId)}`);

export const getAllFolios = (hotelId: string) =>
  request<
    {
      id: string;
      reservationId: string | null;
      groupBlockId: string | null;
      type: string;
      status: string;
      reservation: { id: string } | null;
      groupBlock: { id: string; name: string } | null;
    }[]
  >(`/reservations/all-folios?hotelId=${encodeURIComponent(hotelId)}`);

export const closeFolio = (reservationId: string, override = false) =>
  request<{ id: string; status: string }>(
    `/reservations/${reservationId}/folio/close`,
    { method: 'POST', body: JSON.stringify({ override }) },
  );

export const moveCharge = (
  chargeId: string,
  targetFolioId: string,
  targetReservationId?: string,
) =>
  request<Charge>(`/reservations/charges/${chargeId}/move`, {
    method: 'POST',
    body: JSON.stringify({ targetFolioId, targetReservationId }),
  });

export const splitPayment = (
  reservationId: string,
  splits: { amount: number; method: string; folioId?: string }[],
) =>
  request<Payment[]>(
    `/reservations/${reservationId}/split-payment`,
    { method: 'POST', body: JSON.stringify({ splits }) },
  );

// ---- Companies & Groups (MICE) ----
export interface Company {
  id: string;
  hotelId: string;
  name: string;
  legalName?: string | null;
  taxId?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  contractTerms?: string | null;
  /** Credit limit — how much they may owe before new business stops. */
  receivableLimit?: number;
  segment?: string | null;
  industry?: string | null;
  managerId?: string | null;
  contractNo?: string | null;
  contractDate?: string | null;
  contractTill?: string | null;
  deferralDays?: number;
  allotmentRooms?: number;
  allotmentCutoff?: number;
  agentRateType?: string | null;
  agentCommission?: number;
  contractCurrency?: string;
  tags?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface GroupBlock {
  id: string;
  hotelId: string;
  name: string;
  color: string;
  note?: string | null;
  companyId?: string | null;
  ownerId?: string | null;
  billing: string;
  depositPct: number;
  arrivalDate?: string | null;
  departureDate?: string | null;
  status: string;
  createdAt: string;
  company?: Company | null;
  _count?: { reservations: number };
  // Server-computed list rollup (members, rooms, money) — see GroupsService.list.
  rollup?: {
    members: number;
    checkedIn: number;
    rooms: number;
    contractTotal: number;
    paid: number;
    balanceDue: number;
  };
}

export interface GroupDetail {
  group: GroupBlock & { company?: Company | null };
  members: (Reservation & { guest: Guest; room: Room })[];
  masterFolio: { id: string; status: string; charges: Charge[]; payments: Payment[] };
  summary: {
    roomRevenue: number;
    masterCharges: number;
    groupTotal: number;
    paid: number;
    balance: number;
    deposit: number;
  };
  schedule: { label: string; amount: number; due: string | null; paid: boolean }[];
}

export interface GroupInvoice {
  number: string;
  issuedAt: string;
  company: Company | null;
  group: string;
  lines: { description: string; amount: number }[];
  net: number;
  vatRate: number;
  vat: number;
  total: number;
  paid: number;
  balance: number;
  esf: string;
}

export const getCompanies = () => request<Company[]>(`/companies${hp()}`);
export const createCompany = (data: {
  name: string;
  legalName?: string;
  taxId?: string;
  contactName?: string;
  phone?: string;
  email?: string;
}) =>
  request<Company>('/companies', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: getActiveHotel() }),
  });

export const getGroups = () => request<GroupBlock[]>(`/groups${hp()}`);
export const getGroup = (id: string) => request<GroupDetail>(`/groups/${id}`);
export const createGroup = (data: {
  name: string;
  companyId?: string;
  billing?: string;
  depositPct?: number;
  arrivalDate?: string;
  departureDate?: string;
  note?: string;
}) =>
  request<GroupBlock>('/groups', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: getActiveHotel() }),
  });

export const importRooming = (
  id: string,
  rows: {
    fullName: string;
    phone?: string;
    citizenship?: string;
    roomId: string;
    checkIn: string;
    checkOut: string;
    totalPrice?: number;
  }[],
) =>
  request<{ added: number }>(`/groups/${id}/rooming-list`, {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });

export const removeGroupMember = (id: string, reservationId: string) =>
  request<Reservation>(`/groups/${id}/members/${reservationId}`, {
    method: 'DELETE',
  });

export const addGroupCharge = (
  id: string,
  data: { description: string; category: string; outlet?: string; amount: number; taxRate?: number },
) =>
  request<Charge>(`/groups/${id}/charges`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const payGroup = (id: string, data: { amount: number; method: string }) =>
  request<Payment>(`/groups/${id}/payments`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const groupInvoice = (id: string) =>
  request<GroupInvoice>(`/groups/${id}/invoice`, { method: 'POST' });

export const getStays = (reservationId: string) =>
  request<Stay[]>(`/reservations/${reservationId}/stays`);

export const addStay = (
  reservationId: string,
  data: { roomId: string; checkIn: string; checkOut: string; ratePerNight?: number },
) =>
  request<Stay>(`/reservations/${reservationId}/stays`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const moveStay = (
  stayId: string,
  data: { roomId?: string; checkIn?: string; checkOut?: string },
) =>
  request<Stay>(`/stays/${stayId}/move`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const removeStay = (stayId: string) =>
  request<{ deleted: boolean }>(`/stays/${stayId}`, { method: 'DELETE' });

export const getTapeChart = (
  from: string,
  to: string,
  filters?: { type?: string; floor?: string; status?: string; source?: string; search?: string },
) => {
  let extra = `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  if (filters?.type) extra += `&typeFilter=${encodeURIComponent(filters.type)}`;
  if (filters?.floor) extra += `&floorFilter=${encodeURIComponent(filters.floor)}`;
  if (filters?.status) extra += `&statusFilter=${encodeURIComponent(filters.status)}`;
  if (filters?.source) extra += `&sourceFilter=${encodeURIComponent(filters.source)}`;
  if (filters?.search) extra += `&search=${encodeURIComponent(filters.search)}`;
  return request<TapeChartGrid>(`/tape-chart${hp(extra)}`);
};

export const dragMoveReservation = (data: {
  reservationId: string;
  targetRoomId?: string;
  targetCheckIn?: string;
  targetCheckOut?: string;
}) =>
  request<DragMoveResult>('/tape-chart/drag-move', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const createRoomBlock = (data: {
  roomId: string;
  dateFrom: string;
  dateTo: string;
  reason?: string;
  note?: string;
}) =>
  request<RoomBlock>('/tape-chart/blocks', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: getActiveHotel() }),
  });

export const deleteRoomBlock = (id: string) =>
  request<{ deleted: boolean }>(`/tape-chart/blocks/${id}`, {
    method: 'DELETE',
  });

export const createGroupBlock = (data: {
  name: string;
  color?: string;
  note?: string;
  reservationIds: string[];
}) =>
  request<GroupBlock>('/tape-chart/group-blocks', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: getActiveHotel() }),
  });

export const getGroupBlocks = () =>
  request<GroupBlock[]>(`/tape-chart/group-blocks${hp()}`);

export const deleteGroupBlock = (id: string) =>
  request<{ deleted: boolean }>(`/tape-chart/group-blocks/${id}`, {
    method: 'DELETE',
  });

export const getTodayArrivals = () =>
  request<TodayArrivals>(`/tape-chart/today${hp()}`);

export const getRatePlans = (roomType?: string, companyId?: string, all?: boolean) =>
  request<RatePlan[]>(
    `/rate-plans${hp(
      `${roomType ? `&roomType=${encodeURIComponent(roomType)}` : ''}` +
        `${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ''}` +
        `${all ? '&all=1' : ''}`,
    )}`,
  );

export const createRatePlan = (data: {
  name: string;
  roomType: string;
  baseRate: number;
  weekendMultiplier?: number;
  kind?: string;
  parentId?: string;
  adjustmentPct?: number;
  visibility?: string;
  companyId?: string;
  minLos?: number;
  maxLos?: number;
  meal?: string;
  cancelPolicy?: string;
  channels?: string[];
  validFrom?: string;
  validTo?: string;
}) =>
  request<RatePlan>('/rate-plans', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: activeHotelId }),
  });

export const getPromos = () => request<PromoCode[]>(`/pricing/promos${hp()}`);
export const createPromo = (data: {
  code: string;
  discountPct: number;
  validFrom?: string;
  validTo?: string;
}) =>
  request<PromoCode>('/pricing/promos', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: activeHotelId }),
  });

export const getPackages = () =>
  request<PackagePlan[]>(`/pricing/packages${hp()}`);
export const createPackage = (data: {
  name: string;
  roomType?: string;
  services: { description: string; amount: number }[];
}) =>
  request<PackagePlan>('/pricing/packages', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: activeHotelId }),
  });

export const getRestrictions = () =>
  request<RateRestriction[]>(`/pricing/restrictions${hp()}`);
export const createRestriction = (data: {
  roomType?: string;
  dateFrom: string;
  dateTo: string;
  type: string;
  value?: number;
}) =>
  request<RateRestriction>('/pricing/restrictions', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: activeHotelId }),
  });

export const aiRecommend = (data: {
  roomType: string;
  from: string;
  to: string;
  apply?: boolean;
  minMultiplier?: number;
  maxMultiplier?: number;
  maxDailyChangePct?: number;
  maxAdjustmentFromBase?: number;
  mode?: string;
}) =>
  request<{
    roomType: string;
    recommendations: AiRecommendation[];
    calendarEvents: Record<string, string[]>;
    guardRails: { minMultiplier: number; maxMultiplier: number; maxDailyChangePct: number; maxAdjustmentFromBase: number; mode: string };
    applied: number;
    note: string;
  }>(
    '/pricing/ai-recommend',
    { method: 'POST', body: JSON.stringify({ ...data, hotelId: activeHotelId }) },
  );

/**
 * Freshness of a cached AI payload. The model is never called on a read — the
 * backend serves the last computed result plus this metadata, and regenerating
 * is an explicit user action. See backend/src/common/ai-cache.service.ts.
 */
export interface AiMeta {
  computedAt: string | null;
  stale: boolean;
  computing: boolean;
  neverComputed: boolean;
  computeMs?: number | null;
}

export interface AiOverviewItem {
  id: string; date: string; dateFrom: string; dateTo: string; roomType: string; confidence: number;
  oldPrice: number; newPrice: number; pctChange: number; isIncrease: boolean;
  metrics: string; expectedEffect: number; tags: string[]; multiplier: number;
  /** Generated Russian one-liner built from `signals`. */
  summary?: string;
  /** Explained reasons behind the recommendation — see RevRecommendationSignal. */
  signals?: RevRecommendationSignal[];
}

type AiOverviewResponse = { items: AiOverviewItem[]; total?: number; summary?: unknown; meta: AiMeta };

/** Instant — returns the last computed overview, or empty if never computed. */
export const getAiOverview = (days?: number, limit?: number) =>
  request<AiOverviewResponse>(
    `/pricing/ai-overview${hp(`${days ? `&days=${days}` : ''}${limit ? `&limit=${limit}` : ''}`)}`,
  );

/** Regenerates the overview. Takes tens of seconds — always user-initiated. */
export const refreshAiOverview = (days?: number, limit?: number) =>
  request<AiOverviewResponse>(
    `/pricing/ai-overview/refresh${hp(`${days ? `&days=${days}` : ''}${limit ? `&limit=${limit}` : ''}`)}`,
    { method: 'POST' },
  );

/** Regenerates the dashboard's AI pricing recommendations. */
export const refreshAiRecommendations = () =>
  request<{ data: RevDashboard['recommendations']; computedAt: string; stale: boolean; computeMs: number }>(
    `/revenue/ai-recommendations/refresh${hp()}`,
    { method: 'POST' },
  );

export const getPricingRules = () =>
  request<PricingRule[]>(`/pricing/rules${hp()}`);

export const createPricingRule = (data: {
  name: string;
  dateFrom: string;
  dateTo: string;
  multiplier: number;
}) =>
  request<PricingRule>('/pricing/rules', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: activeHotelId }),
  });

export const updateGuest = (
  id: string,
  data: { preferences?: string[]; tags?: string[]; phone?: string; email?: string },
) =>
  request<Guest>(`/guests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const addIncident = (
  id: string,
  data: { title: string; detail?: string; severity?: string },
) =>
  request<GuestIncident>(`/guests/${id}/incidents`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const resolveIncident = (incidentId: string) =>
  request<GuestIncident>(`/guests/incidents/${incidentId}/resolve`, {
    method: 'POST',
  });

export const mergeGuests = (survivorId: string, dupId: string) =>
  request<{ merged: boolean }>(`/guests/${survivorId}/merge/${dupId}`, {
    method: 'POST',
  });

export const getSegments = () =>
  request<Record<string, SegmentGuest[]>>(`/crm/segments${hp()}`);

export const getCampaigns = () => request<Campaign[]>(`/crm/campaigns${hp()}`);

export const createCampaign = (data: {
  name: string;
  segment: string;
  template: string;
  channel?: string;
}) =>
  request<Campaign>('/crm/campaigns', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: getActiveHotel() }),
  });

export const getMessages = (status?: string) =>
  request<Message[]>(
    `/crm/messages${hp(status ? `&status=${encodeURIComponent(status)}` : '')}`,
  );

export const sendMessage = (id: string) =>
  request<Message>(`/crm/messages/${id}/send`, { method: 'POST' });

export const addFeedback = (data: {
  reservationId: string;
  rating: number;
  comment?: string;
}) =>
  request<FeedbackItem>('/crm/feedback', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const getFeedbackSummary = () =>
  request<{ count: number; average: number; items: FeedbackItem[] }>(
    `/crm/feedback${hp()}`,
  );

/**
 * Must mirror ROLES in packages/backend/src/auth/roles.ts, which is canonical.
 * This array is what renders the role picker on the Staff screen, so a role
 * missing here cannot be assigned to anyone from the admin UI at all — which
 * is how `marketing` and `reservations` ended up unassignable after being
 * added everywhere else.
 */
export const ROLES = [
  'owner',
  'gm',
  'front_desk',
  'housekeeping',
  'finance',
  'outlet',
  'sales',
  'maintenance',
  'revenue',
  'marketing',
  'reservations',
] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export interface User {
  id: string;
  hotelId?: string | null;
  organizationId?: string | null;
  twoFactorRequired?: boolean;
  name: string;
  username: string;
  role: string;
  active: boolean;
  // false for roster-only people (recorded by name, no credentials, never sign in)
  canLogin?: boolean;
  telegramChatId?: string | null;
  createdAt: string;
}

export interface HkTask {
  id: string;
  hotelId: string;
  roomId: string;
  status: string;
  assignedToId?: string | null;
  note?: string | null;
  createdAt: string;
  completedAt?: string | null;
  room?: Room;
}

export const OBJECT_KINDS = ['room', 'villa', 'public', 'equipment'] as const;

export interface WorkOrderEvent {
  id: string;
  kind: string;
  text: string;
  byId?: string | null;
  createdAt: string;
}

export interface WorkOrder {
  id: string;
  hotelId: string;
  roomId?: string | null;
  title: string;
  description?: string | null;
  priority: string;
  status: string;
  assignedToId?: string | null;
  reportedById?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  objectKind: string;
  objectRef?: string | null;
  photoUrls?: string | null;
  resolutionNote?: string | null;
  blocksSale: boolean;
  /** Deadline stamped by the server at creation — not recomputed per client. */
  slaDueAt?: string | null;
  startedAt?: string | null;
  room?: { number: string; type?: string } | null;
  events?: WorkOrderEvent[];
}

export const getWorkOrder = (id: string) =>
  request<WorkOrder>(`/work-orders/${id}`);

export interface OpsTask {
  id: string;
  hotelId: string;
  category: string;
  title: string;
  note?: string | null;
  priority: string;
  status: string;
  assignedToId?: string | null;
  dueDate?: string | null;
  createdAt: string;
  doneAt?: string | null;
}

export interface DailyRes {
  id: string;
  guestName: string;
  guestId: string;
  roomId: string;
  roomNumber: string;
  checkIn: string;
  checkOut: string;
  status: string;
  source: string;
  emehmonStatus: string;
  totalPrice: number;
}

export interface DailyBoard {
  date: string;
  arrivals: DailyRes[];
  departures: DailyRes[];
  inHouse: DailyRes[];
}

export interface Alert {
  type: string;
  severity: string;
  message: string;
  refId?: string;
}

export interface NightAuditSnapshot {
  occupancyRate: number;
  roomsTotal: number;
  occupied: number;
  arrivals: number;
  departures: number;
  noShowCandidates: number;
  inHouse: number;
  revenue: number;
  pendingEmehmon: number;
  dirty: number;
}

export interface NightAuditRecord {
  id: string;
  hotelId: string;
  businessDate: string;
  runById?: string | null;
  createdAt: string;
  snapshot: NightAuditSnapshot;
}

export interface SessionResult {
  token: string;
  user: User;
}

/** Login may return a session, or a 2FA challenge/enrolment step (P12.1). */
export type LoginResult =
  | SessionResult
  | { twoFactorRequired: true; challengeToken: string }
  | {
      twoFactorEnroll: true;
      challengeToken: string;
      secret: string;
      otpauthUrl: string;
    };

export const login = (username: string, password: string) =>
  request<LoginResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

export const verifyTwoFactor = (challengeToken: string, code: string) =>
  request<SessionResult>('/auth/2fa/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeToken, code }),
  });

export const getUsers = () => request<User[]>(`/users${hp()}`);

// Omit username/password to record someone who never signs in (a maid on the
// housekeeping roster); the server mints a handle and leaves them credentialless.
export const createUser = (data: {
  name: string;
  username?: string;
  password?: string;
  role: string;
  telegramChatId?: string;
}) =>
  request<User>('/users', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: getActiveHotel() }),
  });

export const updateUser = (
  id: string,
  data: { name?: string; role?: string; password?: string; active?: boolean; telegramChatId?: string },
) =>
  request<User>(`/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

// ─── Telegram bot (per-property) ──────────────────────────────────────────
export interface TelegramConfig {
  connected: boolean;
  botUsername: string | null;
  groupChatId: string | null;
  usingGlobalFallback: boolean;
}

export const getTelegramConfig = () =>
  request<TelegramConfig>(`/telegram/config?propertyId=${encodeURIComponent(getActiveHotel())}`);

export const connectTelegram = (token: string) =>
  request<{ ok: boolean; username?: string; error?: string }>('/telegram/connect', {
    method: 'POST',
    body: JSON.stringify({ propertyId: getActiveHotel(), token }),
  });

export const disconnectTelegram = () =>
  request<{ ok: boolean }>('/telegram/disconnect', {
    method: 'POST',
    body: JSON.stringify({ propertyId: getActiveHotel() }),
  });

export const setTelegramGroup = (chatId: string) =>
  request<{ ok: boolean }>('/telegram/group', {
    method: 'POST',
    body: JSON.stringify({ propertyId: getActiveHotel(), chatId }),
  });

export const setTelegramWebhook = (baseUrl: string) =>
  request<{ ok: boolean; url?: string; description?: string; error?: string }>('/telegram/set-webhook', {
    method: 'POST',
    body: JSON.stringify({ propertyId: getActiveHotel(), baseUrl }),
  });

export const testTelegramNotify = () =>
  request<{ ok: boolean }>('/telegram/test-notify', {
    method: 'POST',
    body: JSON.stringify({ propertyId: getActiveHotel() }),
  });

// ─── Payme (per-property) ─────────────────────────────────────────────────
export interface PaymeConfig {
  configured: boolean;
  merchantId: string | null;
  testMode: boolean;
}

export const getPaymeConfig = () =>
  request<PaymeConfig>(`/payme/config?propertyId=${encodeURIComponent(getActiveHotel())}`);

export const savePaymeConfig = (data: { merchantId: string; key?: string; testMode: boolean }) =>
  request<PaymeConfig>('/payme/config', {
    method: 'POST',
    body: JSON.stringify({ propertyId: getActiveHotel(), ...data }),
  });

export const disconnectPayme = () =>
  request<{ ok: boolean }>('/payme/disconnect', {
    method: 'POST',
    body: JSON.stringify({ propertyId: getActiveHotel() }),
  });

// ─── 1C Accounting config (Integrations, mirrors Payme) ─────────────────────
export interface OneCConfig {
  enabled: boolean;
  url: string | null;
  login: string | null;
  autoExport: boolean;
  configured: boolean;
}
export const getOneCConfig = () =>
  request<OneCConfig>(`/onec/config?propertyId=${encodeURIComponent(getActiveHotel())}`);
export const saveOneCConfig = (data: { enabled: boolean; url?: string; login?: string; password?: string; autoExport: boolean }) =>
  request<OneCConfig>('/onec/config', { method: 'POST', body: JSON.stringify({ propertyId: getActiveHotel(), ...data }) });
export const disconnectOneC = () =>
  request<OneCConfig>('/onec/disconnect', { method: 'POST', body: JSON.stringify({ propertyId: getActiveHotel() }) });

// ─── Offline sync (P9.1/9.2) ────────────────────────────────────────────────
export interface OfflineStatus { pending: number; conflicts: number; failed: number; online: boolean }
export interface SyncLogRow { id: string; hotelId: string; action: string; refId?: string | null; status: string; detail?: string | null; createdAt: string }
export const getOfflineStatus = () => request<OfflineStatus>(`/offline/status${hp()}`);
export const getSyncLog = () => request<SyncLogRow[]>(`/offline/sync-log${hp()}`);
export const syncNow = () => request<{ ok: boolean }>('/offline/sync-now', { method: 'POST' });

// ─── Notifications (P10.1) ──────────────────────────────────────────────────
export interface Notification {
  id: string; hotelId: string; trigger: string; title: string; body?: string | null;
  roles: string[]; channels: string[]; priority: string; status: string;
  refId?: string | null; slaDeadline?: string | null; escalatedAt?: string | null; readAt?: string | null; createdAt: string;
}
export interface NotificationRule {
  trigger: string; enabled: boolean; roles: string[]; channels: string[]; priority: string; slaMinutes: number;
}
export const getNotifications = () => request<{ unread: number; notifications: Notification[] }>(`/notifications${hp()}`);
export const markNotificationRead = (id: string) => request<Notification>(`/notifications/${id}/read`, { method: 'POST' });
export const markAllNotificationsRead = () => request<{ ok: boolean }>('/notifications/read-all', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel() }) });
export const getNotificationConfig = () => request<NotificationRule[]>(`/notifications/config${hp()}`);
export const saveNotificationConfig = (trigger: string, dto: Partial<NotificationRule>) =>
  request<any>('/notifications/config', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), trigger, ...dto }) });
export const testNotification = (trigger: string) =>
  request<any>('/notifications/test', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), trigger }) });

// ─── Multi-property portfolio (P11.1) ───────────────────────────────────────
export type PortfolioProperty = Hotel;
export interface PropertyMetrics {
  hotelId: string; hotelName: string; currency: string; rooms: number; roomNights: number;
  revenue: number; occupancy: number; adr: number; revpar: number;
  vsAvgOccupancyPts: number; vsAvgRevparPct: number; lagging: boolean;
}
export interface PortfolioSummary {
  windowDays: number;
  properties: PropertyMetrics[];
  totals: { revenue: number; rooms: number; occupancy: number; revpar: number; properties: number };
  comparison: { avgOccupancy: number; avgRevpar: number; best: { hotelId: string; hotelName: string; revpar: number } | null; worst: { hotelId: string; hotelName: string; revpar: number } | null } | null;
}
// Properties this user may switch into (org + role scoped). No hotelId param —
// the server scopes to the authenticated user's organization.
export const getMyProperties = () => request<PortfolioProperty[]>('/portfolio/properties');
export const getPortfolioSummary = () => request<PortfolioSummary>('/portfolio/summary');
export const getOrgGuest = (phone: string) => request<any>(`/portfolio/guest?phone=${encodeURIComponent(phone)}`);
export const assignProperties = (userId: string, propertyIds: string[]) =>
  request<any>('/portfolio/assign', { method: 'POST', body: JSON.stringify({ userId, propertyIds }) });

// ─── Financial close (P8.3): P&L, reconciliation, night audit, 1C export ────
export interface OutletPnl {
  from: string; to: string; currency: string;
  outlets: { outlet: string; income: number; vat: number; expense: number; net: number; lines: number }[];
  totalIncome: number; totalVat: number; totalNet: number;
}
export interface Reconciliation {
  from: string; to: string; currency: string;
  byMethod: { method: string; count: number; amount: number; fiscalized: number; unfiscalized: number }[];
  totalPayments: number; fiscalRevenue: number; unfiscalized: number; chargesPosted: number;
  hasDiscrepancy: boolean; discrepancies: { type: string; amount: number; note: string }[];
}
const fhp = (from?: string, to?: string) =>
  `${hp()}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`;
export const getFinancePnl = (from?: string, to?: string) => request<OutletPnl>(`/finance/pnl${fhp(from, to)}`);
export const getFinanceReconciliation = (from?: string, to?: string) => request<Reconciliation>(`/finance/reconciliation${fhp(from, to)}`);
export const getFinanceNightAudit = (date?: string) => request<any>(`/finance/night-audit${hp()}${date ? `&date=${date}` : ''}`);
export const build1CExport = (from?: string, to?: string) => request<any>(`/finance/export-1c${fhp(from, to)}`);
export const export1C = (from?: string, to?: string) =>
  request<{ documentId: string; export: any; pushed: { ok: boolean; error?: string } | null }>('/finance/export-1c', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), from, to }) });
export const closeDay = () => request<any>('/finance/close', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel() }) });

// ─── Guest Intelligence (P8.2) ─────────────────────────────────────────────
export const getCohorts = () => request<any>(`/analytics/cohorts${hp()}`);
export const getNpsTrends = (months?: number) => request<any>(`/analytics/nps-trends${hp(months ? `&months=${months}` : '')}`);
export const getSourceBySegment = () => request<any>(`/analytics/source-by-segment${hp()}`);
export const getCampaignSuggestions = () => request<any>(`/analytics/campaign-suggestions${hp()}`);

export const buildPaymeLink = (data: { amount: number; reservationId?: string }) =>
  request<{ ok: boolean; link?: string; error?: string }>('/payme/link', {
    method: 'POST',
    body: JSON.stringify({ propertyId: getActiveHotel(), ...data }),
  });

export const sendPaymeCheque = (data: { amount: number; phone: string; reservationId?: string }) =>
  request<{ ok: boolean; receiptId?: string; error?: string }>('/payme/send-cheque', {
    method: 'POST',
    body: JSON.stringify({ propertyId: getActiveHotel(), ...data }),
  });

export const getHousekeeping = () =>
  request<{ rooms: Room[]; tasks: HkTask[] }>(`/housekeeping${hp()}`);

// Rich per-room housekeeping view powering the keeper "Номера"/"Виллы" screens.
export type HkStatusCode = 'ooo' | 'occupied' | 'in_progress' | 'inspected' | 'dirty' | 'clean';
export interface HkRoom {
  id: string;
  number: string;
  type: string;
  floor: string;
  statusCode: HkStatusCode;
  occupied: boolean;
  dailyDone: boolean;
  checkoutTime: string | null;
  arrivalTime: string | null;
  deadline: string | null;
  overdue: boolean;
  vip: boolean;
  guestNotes: string[];
  assignedTo: string | null;
  assignedToId: string | null;
  taskId: string | null;
}
export const getHkRooms = () =>
  request<{ rooms: HkRoom[] }>(`/housekeeping/rooms${hp()}`);

export const toggleHkDailyClean = (roomId: string, done: boolean) =>
  request<{ ok: boolean; done: boolean }>('/housekeeping/daily-clean', {
    method: 'POST',
    body: JSON.stringify({ hotelId: getActiveHotel(), roomId, done }),
  });

export const assignHkRoom = (roomId: string, userId: string | null) =>
  request<HkTask>('/housekeeping/assign', {
    method: 'POST',
    body: JSON.stringify({ hotelId: getActiveHotel(), roomId, userId }),
  });

export const createHkTask = (roomId: string, note?: string) =>
  request<HkTask>('/housekeeping', {
    method: 'POST',
    body: JSON.stringify({ hotelId: getActiveHotel(), roomId, note }),
  });

export const updateHkTask = (
  id: string,
  data: { status?: string; assignedToId?: string; note?: string },
) =>
  request<HkTask>(`/housekeeping/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const getWorkOrders = (status?: string) =>
  request<WorkOrder[]>(
    `/work-orders${hp(status ? `&status=${encodeURIComponent(status)}` : '')}`,
  );

export const createWorkOrder = (data: {
  roomId?: string;
  title: string;
  description?: string;
  priority?: string;
  reportedById?: string;
  objectKind?: string;
  objectRef?: string;
  assignedToId?: string;
  blocksSale?: boolean;
}) =>
  request<WorkOrder>('/work-orders', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: getActiveHotel() }),
  });

export const updateWorkOrder = (
  id: string,
  data: {
    status?: string;
    priority?: string;
    assignedToId?: string;
    resolutionNote?: string;
    blocksSale?: boolean;
  },
) =>
  request<WorkOrder>(`/work-orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const getTasks = (category?: string) =>
  request<OpsTask[]>(
    `/tasks${hp(category ? `&category=${encodeURIComponent(category)}` : '')}`,
  );

export const createTask = (data: {
  title: string;
  category?: string;
  note?: string;
  priority?: string;
  createdById?: string;
}) =>
  request<OpsTask>('/tasks', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: getActiveHotel() }),
  });

export const updateTask = (
  id: string,
  data: { status?: string; priority?: string; assignedToId?: string },
) =>
  request<OpsTask>(`/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const getDailyBoard = (date?: string) =>
  request<DailyBoard>(
    `/ops/daily${hp(date ? `&date=${encodeURIComponent(date)}` : '')}`,
  );

export const getAlerts = () =>
  request<{ count: number; alerts: Alert[] }>(`/ops/alerts${hp()}`);

export const getNightAuditPreview = () =>
  request<NightAuditSnapshot>(`/ops/night-audit/preview${hp()}`);

export const getNightAuditHistory = () =>
  request<NightAuditRecord[]>(`/ops/night-audit${hp()}`);

export const runNightAudit = (runById?: string) =>
  request<NightAuditRecord>('/ops/night-audit', {
    method: 'POST',
    body: JSON.stringify({ hotelId: getActiveHotel(), runById }),
  });

export const aiChat = (message: string, lang?: string) =>
  request<{ reply: string }>('/pricing/ai-chat', {
    method: 'POST',
    body: JSON.stringify({ hotelId: getActiveHotel(), message, lang }),
  });

// ─── Channel Manager ──────────────────────────────────────────────────────
export interface ChannelConnection {
  id: string;
  hotelId: string;
  channel: string;
  apiKey?: string | null;
  apiSecret?: string | null;
  hotelCode?: string | null;
  status: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  mappings?: ChannelMapping[];
  stats?: { nn: number; gross: number; net: number; commissionPct: number };
}

export interface ChannelMapping {
  id: string;
  hotelId: string;
  channel: string;
  roomType: string;
  channelRoomId?: string | null;
  ratePlanId?: string | null;
  channelRateCode?: string | null;
  active: boolean;
  createdAt: string;
}

export interface ChannelSyncLog {
  id: string;
  hotelId: string;
  channel: string;
  direction: string;
  action: string;
  status: string;
  message?: string | null;
  detail?: string | null;
  createdAt: string;
}

export const getChannelConnections = () =>
  request<(ChannelConnection & { mappings: ChannelMapping[] })[]>(`/channels${hp()}`);

export const connectChannel = (channel: string) =>
  request<ChannelConnection>('/channels', {
    method: 'POST',
    body: JSON.stringify({ hotelId: getActiveHotel(), channel }),
  });

export const syncChannels = (channel?: string) =>
  request<{ ok: boolean; message: string }>('/channels/sync', {
    method: 'POST',
    body: JSON.stringify({ hotelId: getActiveHotel(), channel }),
  });

export const updateChannelConnection = (id: string, data: { apiKey?: string; apiSecret?: string; hotelCode?: string; status?: string }) =>
  request<ChannelConnection>(`/channels/${id}`, {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: getActiveHotel() }),
  });

export const getChannelSyncLog = () =>
  request<ChannelSyncLog[]>(`/channels/sync-log${hp()}`);

export const getChannelMappings = (channel?: string) =>
  request<ChannelMapping[]>(`/channels/mappings${hp( channel ? `&channel=${encodeURIComponent(channel)}` : '' )}`);

export const createChannelMapping = (data: {
  channel: string;
  roomType: string;
  channelRoomId?: string;
  ratePlanId?: string;
  channelRateCode?: string;
}) =>
  request<ChannelMapping>('/channels/mappings', {
    method: 'POST',
    body: JSON.stringify({ ...data, hotelId: getActiveHotel() }),
  });

export const deleteChannelMapping = (id: string) =>
  request<{ id: string }>(`/channels/mappings/${id}${hp()}`, { method: 'DELETE' });

// ─── Booking Engine Widget ────────────────────────────────────────────────
export const bookingSearch = (hotelId: string, checkIn: string, checkOut: string, roomType?: string, promoCode?: string) => {
  let url = `${BASE}/booking/search?hotelId=${encodeURIComponent(hotelId)}&checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}`;
  if (roomType) url += `&roomType=${encodeURIComponent(roomType)}`;
  if (promoCode) url += `&promoCode=${encodeURIComponent(promoCode)}`;
  return fetch(url).then(r => r.json());
};

export const bookingCreate = (data: { hotelId: string; fullName: string; phone: string; email?: string; roomType: string; checkIn: string; checkOut: string; ratePlanId?: string; promoCode?: string; packageId?: string }) =>
  fetch(`${BASE}/booking/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json());

export const bookingPay = (bookingId: string, method: string) =>
  fetch(`${BASE}/booking/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId, method }),
  }).then(r => r.json());

export const bookingStatus = (id: string) =>
  fetch(`${BASE}/booking/status/${id}`).then(r => r.json());

// ─── Leads / Pipeline ─────────────────────────────────────────────────────
export interface Lead {
  id: string;
  hotelId: string;
  fullName: string;
  phone: string;
  email?: string | null;
  source: string;
  stage: string;
  ownerId?: string | null;
  guestId?: string | null;
  note?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  roomType?: string | null;
  budget?: number | null;
  createdAt: string;
  updatedAt: string;
  respondedAt?: string | null;
  qualifiedAt?: string | null;
  proposalSentAt?: string | null;
  proposalExpiresAt?: string | null;
  proposalAmount?: number | null;
  fitScore?: number | null;
  suggestedUpsell?: string | null;
  followUpStage: number;
  lostReason?: string | null;
  handoffDealId?: string | null;
}

export interface LeadActivity {
  id: string;
  leadId: string;
  kind: string;
  body: string;
  createdAt: string;
}

export interface LeadCard extends Lead {
  fitReasons: string[];
  history: { visits: number; ltv: number; lastStay: string | null } | null;
  activities: LeadActivity[];
  proposalExpired: boolean;
}

export interface LeadStats {
  total: number;
  byStage: Record<string, number>;
  bySource: Record<string, number>;
  stages: string[];
  sources: string[];
  funnel: { contact: number; qualified: number; proposal: number; deposit: number };
  conversion: number;
  awaitingReply: number;
  slaBreached: number;
  expiringProposals: number;
  expiredProposals: number;
}

export interface MarketingSettings {
  hotelId: string;
  nudgeAfterHours: number;
  urgencyAfterHours: number;
  winBackAfterDays: number;
  proposalExpiryHours: number;
  autoLoseAfterDays: number;
}

export const LEAD_SOURCES = ['instagram', 'telegram', 'whatsapp', 'site_form', 'phone_call', 'maps', 'referral', 'ota'] as const;
export const LEAD_STAGES = ['new', 'in_progress', 'proposal', 'booking', 'won', 'lost', 'handoff'] as const;

export const getLeads = (stage?: string, source?: string) =>
  request<Lead[]>(`/leads${hp(
    (stage ? `&stage=${encodeURIComponent(stage)}` : '') + (source ? `&source=${encodeURIComponent(source)}` : ''),
  )}`);

export const createLead = (data: { fullName: string; phone: string; email?: string; source: string; note?: string; checkIn?: string; checkOut?: string; roomType?: string; budget?: number }) =>
  request<Lead>('/leads', { method: 'POST', body: JSON.stringify({ ...data, hotelId: getActiveHotel() }) });

export const updateLead = (id: string, data: { stage?: string; ownerId?: string; note?: string; guestId?: string }) =>
  request<Lead>(`/leads/${id}`, { method: 'POST', body: JSON.stringify(data) });

export const getLeadStats = () => request<LeadStats>(`/leads/stats${hp()}`);

export const getLeadCard = (id: string) => request<LeadCard>(`/leads/${id}/card`);

export const sendLeadProposal = (id: string, data: { amount?: number; expiresHours?: number; comment?: string }) =>
  request<Lead>(`/leads/${id}/proposal`, { method: 'POST', body: JSON.stringify(data) });

export const handoffLead = (id: string, comment?: string) =>
  request<Lead>(`/leads/${id}/handoff`, { method: 'POST', body: JSON.stringify({ comment }) });

export const loseLead = (id: string, reason: string) =>
  request<Lead>(`/leads/${id}/lose`, { method: 'POST', body: JSON.stringify({ reason }) });

export const getMarketingSettings = () => request<MarketingSettings>(`/leads/settings${hp()}`);

export const updateMarketingSettings = (data: Partial<Omit<MarketingSettings, 'hotelId'>>) =>
  request<MarketingSettings>(`/leads/settings${hp()}`, { method: 'PATCH', body: JSON.stringify(data) });

// ─── Reservations (pre-arrival pipeline) ──────────────────────────────────
export interface PipelineReservation {
  id: string;
  guestId: string;
  guestName: string;
  phone: string;
  roomNumber: string | null;
  roomType: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: string;
  source: string;
  totalPrice: number;
  depositAmount: number;
  depositDueAt: string | null;
  depositPaidAt: string | null;
  depositOverdue: boolean;
  groupBlockId: string | null;
  cancelReason: string | null;
  noShowAt: string | null;
  createdAt: string;
}

export interface ReservationStats {
  total: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  depositOverdue: number;
  waitlist: number;
}

export interface WaitlistEntry {
  id: string;
  guestId: string | null;
  guestName: string;
  phone: string;
  email: string | null;
  fromDate: string;
  toDate: string;
  roomType: string;
  partySize: number;
  capturedVia: string;
  status: string;
  note: string | null;
  notifiedAt: string | null;
  reservationId: string | null;
  createdAt: string;
  position: number | null;
  isVip: boolean;
  pastVisits: number;
  lifetimeValue: number;
}

export interface Amendment {
  id: string;
  reservationId: string;
  kind: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string | null;
  actorName: string | null;
  createdAt: string;
  guestName?: string;
  roomNumber?: string | null;
}

export interface DepositRow {
  id: string;
  guestName: string;
  phone: string;
  roomNumber: string | null;
  roomType: string | null;
  checkIn: string;
  totalPrice: number;
  depositAmount: number;
  depositDueAt: string | null;
  hoursToCutoff: number | null;
  overdue: boolean;
  source: string;
}

export interface ReservationSettings {
  hotelId: string;
  cutoffAction: 'remind' | 'release' | 'manual';
  depositLeadHours: number;
  depositPercent: number;
  waitlistExpiryDays: number;
  forfeitOnNoShow: boolean;
}

export interface GroupHold {
  id: string;
  name: string;
  companyName: string | null;
  color: string;
  arrivalDate: string | null;
  departureDate: string | null;
  cutoffDate: string | null;
  daysToCutoff: number | null;
  cutoffPassed: boolean;
  roomingStatus: string;
  depositStatus: string;
  status: string;
  namedRooms: number;
  hallName: string | null;
}

const ra = (path: string, extra = '') => `/reservations-admin/${path}${hp(extra)}`;

export const getPipeline = (f: {
  status?: string; source?: string; roomType?: string; from?: string; to?: string; search?: string;
} = {}) => {
  const q = Object.entries(f)
    .filter(([, v]) => v)
    .map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`)
    .join('');
  return request<PipelineReservation[]>(ra('list', q));
};

export const getPipelineStats = () => request<ReservationStats>(ra('stats'));

export const getWaitlist = (status?: string) =>
  request<WaitlistEntry[]>(ra('waitlist', status ? `&status=${encodeURIComponent(status)}` : ''));

export const addWaitlist = (data: {
  guestName: string; phone: string; email?: string; fromDate: string; toDate: string;
  roomType: string; partySize?: number; capturedVia?: string; note?: string;
}) => request<WaitlistEntry>(ra('waitlist'), {
  method: 'POST', body: JSON.stringify({ ...data, hotelId: getActiveHotel() }),
});

export const updateWaitlist = (id: string, data: { status?: string; note?: string; reservationId?: string }) =>
  request<WaitlistEntry>(`/reservations-admin/waitlist/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const getRecentAmendments = (kind?: string) =>
  request<Amendment[]>(ra('amendments', kind ? `&kind=${encodeURIComponent(kind)}` : ''));

export const getAmendments = (id: string) =>
  request<Amendment[]>(`/reservations-admin/${id}/amendments`);

export const amendReservation = (id: string, data: {
  kind: string; checkIn?: string; checkOut?: string; roomId?: string;
  totalPrice?: number; guestCount?: number; reason?: string;
}) => request<PipelineReservation>(`/reservations-admin/${id}/amend`, { method: 'POST', body: JSON.stringify(data) });

export const cancelPipelineReservation = (id: string, reason?: string) =>
  request<{ correctiveReceiptRequired: boolean }>(`/reservations-admin/${id}/cancel`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });

export const markNoShow = (id: string, reason?: string) =>
  request<PipelineReservation>(`/reservations-admin/${id}/no-show`, { method: 'POST', body: JSON.stringify({ reason }) });

export const getDeposits = () =>
  request<{ settings: ReservationSettings; rows: DepositRow[] }>(ra('deposits'));

export const markDepositPaid = (id: string) =>
  request<PipelineReservation>(`/reservations-admin/${id}/deposit-paid`, { method: 'POST' });

export const releaseReservation = (id: string, reason?: string) =>
  request<PipelineReservation>(`/reservations-admin/${id}/release`, { method: 'POST', body: JSON.stringify({ reason }) });

export const remindDeposit = (id: string) =>
  request<{ sent: boolean; body: string }>(`/reservations-admin/${id}/remind`, { method: 'POST' });

export const getGroupHolds = () => request<GroupHold[]>(ra('group-holds'));

export const getReservationSettings = () => request<ReservationSettings>(ra('settings'));

export const updateReservationSettings = (data: Partial<Omit<ReservationSettings, 'hotelId'>>) =>
  request<ReservationSettings>(ra('settings'), { method: 'PATCH', body: JSON.stringify(data) });

// ─── Marketing Automation ─────────────────────────────────────────────────
export interface MarketingScenario {
  id: string;
  hotelId: string;
  name: string;
  trigger: string;
  delayHours: number;
  templateRu: string;
  templateUz: string;
  templateEn: string;
  channel: string;
  segment?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export const getScenarios = () =>
  request<MarketingScenario[]>(`/marketing/scenarios${hp()}`);

export const createScenario = (data: { name: string; trigger: string; delayHours: number; templateRu: string; templateUz: string; templateEn: string; channel: string; segment?: string }) =>
  request<MarketingScenario>('/marketing/scenarios', { method: 'POST', body: JSON.stringify({ ...data, hotelId: getActiveHotel() }) });

export const updateScenario = (id: string, data: any) =>
  request<MarketingScenario>(`/marketing/scenarios/${id}`, { method: 'POST', body: JSON.stringify(data) });

export const deleteScenario = (id: string) =>
  request<{ id: string }>(`/marketing/scenarios/${id}`, { method: 'DELETE' });

export const seedScenarios = () =>
  request<{ count: number }>('/marketing/seed', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel() }) });

export const getMarketingEffects = () =>
  request<{ id: string; scenarioId: string; scenarioName: string; sentCount: number; openedCount: number; reactedCount: number; revenueGenerated: number }[]>(`/marketing/effects${hp()}`);

export interface MarketingMessage {
  id: string;
  guestName: string;
  channel: string;
  template: string;
  body: string;
  status: string;
  scheduledFor: string;
  sentAt?: string | null;
}

export const getMarketingMessages = (status?: string) =>
  request<MarketingMessage[]>(`/marketing/messages${hp(status ? `&status=${encodeURIComponent(status)}` : '')}`);

// ─── Inbox ─────────────────────────────────────────────────────────────────
export interface InboxThread {
  id: string; hotelId: string; channel: string; contactId?: string | null;
  contactName?: string | null; guestId?: string | null; ownerId?: string | null;
  lastMessageAt: string; status: string; slaBreachedAt?: string | null;
  createdAt: string; updatedAt: string;
  messages?: InboxMessage[]; guestName?: string | null; guestPhone?: string | null;
  lastMessage?: { text?: string } | null; slaBreached?: boolean; unread?: boolean;
}
export interface InboxMessage {
  id: string; threadId: string; direction: string; channel: string;
  text: string; contentType: string; payload?: string | null;
  sentById?: string | null; createdAt: string;
}

// Enriched conversation shape returned by the inbox endpoints (derived server-side).
export interface InboxConversation {
  id: string;
  channel: 'telegram' | 'whatsapp' | 'ota';
  guestName: string;
  guestInitials: string;
  guestPhone?: string | null;
  guestId?: string | null;
  ownerId?: string | null;
  status: 'in-house' | 'pre-arrival' | 'post-stay' | 'lead';
  threadState: string;
  roomNumber?: string;
  roomType?: string;
  bookingRef?: string;
  bookingReservationId?: string;
  checkIn?: string;
  checkOut?: string;
  totalNights?: number;
  stayProgressPercent?: number;
  isVip: boolean;
  guestPreferences?: string | null;
  lastMessage?: { text?: string } | null;
  lastMessageAt: string;
  unreadCount: number;
  slaMinutesRemaining: number | null;
  isUrgent: boolean;
  totalSpendUsd?: number;
  previousStays?: number;
  folioBalanceUsd?: number;
  messages?: InboxMessage[];
  /** Department queue this conversation currently sits in. */
  department: string;
  transferredFrom?: string | null;
  transferredAt?: string | null;
}
export interface InboxTemplate { id: string; name: string; text: string; category?: string }

/** One inbox, many queues — a role only sees the departments it staffs. */
export const INBOX_DEPARTMENTS = [
  'front_desk', 'reservations', 'housekeeping', 'maintenance',
  'fnb', 'spa', 'finance', 'sales', 'marketing',
] as const;

export const DEPARTMENT_LABEL: Record<string, string> = {
  front_desk: 'Стойка',
  reservations: 'Бронирование',
  housekeeping: 'Хозслужба',
  maintenance: 'Тех. служба',
  fnb: 'F&B',
  spa: 'SPA',
  finance: 'Финансы',
  sales: 'Продажи',
  marketing: 'Маркетинг',
};

export const getInboxThreads = (department?: string) =>
  request<InboxConversation[]>(`/inbox/threads${hp(department ? `&department=${encodeURIComponent(department)}` : '')}`);

export const getInboxDepartments = () =>
  request<{ counts: Record<string, number>; visible: string[] }>(`/inbox/departments${hp()}`);

export const transferInboxThread = (id: string, department: string, note?: string) =>
  request<InboxThread>(`/inbox/threads/${id}/transfer`, {
    method: 'POST', body: JSON.stringify({ department, note }),
  });
export const getInboxThread = (id: string) => request<InboxConversation>(`/inbox/threads/${id}`);
export const sendInboxMessage = (threadId: string, text: string) =>
  request<InboxMessage>('/inbox/send', { method: 'POST', body: JSON.stringify({ threadId, text }) });
export const sendInboxPaymentLink = (threadId: string, amount: number) =>
  request<InboxMessage>('/inbox/pay-link', { method: 'POST', body: JSON.stringify({ threadId, amount }) });
export const closeInboxThread = (id: string) =>
  request<InboxThread>(`/inbox/threads/${id}/close`, { method: 'POST' });
export const assignInboxThread = (id: string, userId: string) =>
  request<InboxThread>(`/inbox/threads/${id}/assign`, { method: 'POST', body: JSON.stringify({ userId }) });
export const markInboxRead = (id: string) =>
  request<{ ok: boolean }>(`/inbox/threads/${id}/read`, { method: 'POST' });
export const translateInboxText = (text: string) =>
  request<{ translation: string | null }>('/inbox/translate', { method: 'POST', body: JSON.stringify({ text }) });
export const getInboxAiNote = (threadId: string) =>
  request<{ note: string | null }>(`/inbox/threads/${threadId}/ai-note`);
export const getInboxTemplates = () => request<InboxTemplate[]>(`/inbox/templates`);
export const seedInboxDemo = () => request<{ seeded: number }>(`/inbox/seed-demo${hp()}`, { method: 'POST' });
export const getInboxSlaReport = () =>
  request<any>(`/inbox/sla${hp()}`);

// ─── Reputation ────────────────────────────────────────────────────────────
export interface PlatformReview {
  id: string; hotelId: string; platform: string; platformId?: string | null;
  guestName?: string | null; guestId?: string | null; rating: number;
  text?: string | null; textRu?: string | null; sentiment: string;
  status: string; aiReplyDraft?: string | null; aiReplyStatus: string;
  replyText?: string | null; repliedAt?: string | null; ticketId?: string | null;
  routeTo?: string | null; category?: string | null; language?: string | null;
  createdAt: string; updatedAt: string;
}

export interface ReviewStats {
  total: number;
  replied: number;
  replyRate: number;
  avgRating: number;
  unansweredNegative: number;
  byPlatform: { platform: string; count: number; avgRating: number }[];
  bySentiment: Record<string, number>;
  byCategory: { category: string; count: number; negative: number }[];
}

export const getReviews = (platform?: string, status?: string, sentiment?: string, category?: string) =>
  request<PlatformReview[]>(`/reputation${hp(`${platform ? `&platform=${encodeURIComponent(platform)}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}${sentiment ? `&sentiment=${encodeURIComponent(sentiment)}` : ''}${category ? `&category=${encodeURIComponent(category)}` : ''}`)}`);
export const getReviewStats = () => request<ReviewStats>(`/reputation/stats${hp()}`);
export const importReview = (data: any) => request<PlatformReview>('/reputation/import', { method: 'POST', body: JSON.stringify({ ...data, hotelId: getActiveHotel() }) });
export const aiDraftReply = (id: string) => request<{ draft: string }>(`/reputation/${id}/ai-draft`, { method: 'POST' });
export const approveReviewReply = (id: string, replyText: string) =>
  request<PlatformReview>(`/reputation/${id}/approve`, { method: 'POST', body: JSON.stringify({ replyText }) });

// ─── Marketing Analytics ──────────────────────────────────────────────────
export const getMarketingAnalytics = () =>
  request<{
    summary: { totalLeads: number; totalBookings: number; totalConversions: number; totalRevenue: number; totalCost: number; overallRoi: number; overallConversion: number; avgRevenuePerBooking: number };
    sources: { source: string; channel: string; leads: number; conversions: number; conversionRate: number; costPerLead: number; totalCost: number; bookings: number; revenue: number; avgTicket: number; roi: number; nights: number }[];
    channelComparison: { channel: string; leads: number; bookings: number; revenue: number; cost: number; roi: number; conversionRate: number; avgTicket: number; costPerBooking: number }[];
    alerts: { type: string; severity: string; message: string }[];
  }>(`/analytics/marketing-channels${hp()}`);

// ─── Front Desk Workstation ───────────────────────────────────────────────
export const getFrontDeskWorkstation = () =>
  request<{
    date: string;
    stats: { arrivals: number; departures: number; inHouse: number; openTasks: number; rooms: number; available: number; occupied: number; cleaning: number; maintenance: number; dirty: number };
    arrivals: FrontDeskArrival[];
    departures: { id: string; guestId: string; guestName: string; roomNumber: string; roomType: string; checkIn: string; checkOut: string; balance: number }[];
    inHouse: { id: string; guestId: string; guestName: string; roomNumber: string; roomType: string; checkIn: string; checkOut: string; keyCode?: string | null; emehmonStatus: string }[];
    vipArrivals: FrontDeskArrival[];
    vipGuestIds: string[];
    handover: { tasks: { id: string; title: string; note?: string | null }[]; note: string };
    roomReadiness: { available: number; occupied: number; cleaning: number; maintenance: number; dirty: number };
    roomGrid: { id: string; number: string; floor?: string | null; type: string; readiness: 'clean' | 'dirty' | 'cleaning' | 'occupied' | 'ooo' }[];
  }>(`/frontdesk${hp()}`);

export interface FrontDeskArrival {
  id: string; guestId: string; guestName: string; guestPhone: string;
  roomId: string; roomNumber: string; roomType: string;
  checkIn: string; checkOut: string; totalPrice: number; source: string;
  preferences: string[]; tags: string; emehmonStatus: string; online: boolean;
  vip: boolean; vipScore: number; ltv: number; stays: number;
}

export type FrontDeskWorkstation = Awaited<ReturnType<typeof getFrontDeskWorkstation>>;

// ─── Housekeeping Maid ────────────────────────────────────────────────────
export interface HousekeepingMaidView {
  rooms: Room[];
  tasks: (HkTask & { room?: Room })[];
  floors: { floor: string; rooms: Room[]; dirty: number; clean: number; total: number }[];
  maidId?: string;
}

export const getHousekeepingMaid = (userId?: string, floor?: string) =>
  request<HousekeepingMaidView>(`/housekeeping/maid${hp(userId ? `&userId=${encodeURIComponent(userId)}` : '')}${floor ? `&floor=${encodeURIComponent(floor)}` : ''}`);

export interface HkFloor {
  floor: string;
  total: number;
  dirty: number;
  cleaning: number;
  clean: number;
  inspected: number;
  maintenance: number;
  rooms: { id: string; number: string; type: string; status: string; housekeepingStatus: string }[];
}

export const getHkFloors = () => request<HkFloor[]>(`/housekeeping/floors${hp()}`);

export const escalateHkTask = (id: string, description: string) =>
  request<{ ok: boolean; message: string }>(`/housekeeping/${id}/escalate`, { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), description }) });

export const getQuote = (
  roomId: string,
  checkIn: string,
  checkOut: string,
  ratePlanId?: string,
) =>
  request<Quote>(
    `/pricing/quote?roomId=${encodeURIComponent(roomId)}&checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}${ratePlanId ? `&ratePlanId=${encodeURIComponent(ratePlanId)}` : ''}`,
  );

// ─── Onboarding (tenant provisioning) ─────────────────────────────────────
export interface OnboardPayload {
  orgName: string;
  slug?: string;
  region?: string;
  property: {
    name: string;
    legalName?: string;
    stars?: number;
    address?: string;
    city?: string;
    phone?: string;
    email?: string;
  };
  owner: { name: string; username: string; password: string };
  roomTypes?: { type: string; count: number; price: number; capacity?: number }[];
}

export interface OnboardResult {
  organization: { id: string; name: string; slug: string; region: string };
  property: { id: string; name: string };
  owner: { id: string; username: string; role: string };
  seeded: { rooms: number; ratePlans: number };
}

export const provisionTenant = (data: OnboardPayload) =>
  request<OnboardResult>('/onboarding', { method: 'POST', body: JSON.stringify(data) });

// ─── Corporate CRM ────────────────────────────────────────────────────────
export interface CorporatesCompany {
  id: string; hotelId: string; name: string; legalName?: string | null;
  taxId?: string | null; phone?: string | null; email?: string | null;
  address?: string | null; contractFile?: string | null;
  contractTerms?: string | null; receivableLimit: number;
  createdAt: string; updatedAt: string;
  totalGroups?: number; totalRevenue?: number; totalNights?: number;
  openBalance?: number; lastStay?: string | null; contactCount?: number;
}

export interface CompanyContact {
  id: string; companyId: string; name: string; position?: string | null;
  phone?: string | null; email?: string | null; isPrimary: boolean; createdAt: string;
}

export interface Receivable {
  id: string; hotelId: string; companyId: string;
  reservationId?: string | null; description: string;
  amount: number; paid: number; dueDate: string; status: string;
  note?: string | null; remindedAt?: string | null; createdAt: string;
  company?: { name: string; legalName?: string | null };
}

export const getCorporates = () => request<CorporatesCompany[]>(`/corporate${hp()}`);
export const getCorporateProfile = (id: string) => request<{ company: CorporatesCompany; contacts: CompanyContact[]; groups: any[]; receivables: Receivable[]; rates: CompanyRate[] }>(`/corporate/${id}`);
/** Replace the negotiated rate card. These are the floor a quote is checked against. */
export const setCorporateRates = (
  id: string,
  rates: { category: string; rate: number; meal?: string }[],
) => request<CompanyRate[]>(`/corporate/${id}/rates`, { method: 'POST', body: JSON.stringify({ rates }) });
/** Commercial terms of the contract — partial: untouched keys stay as they are. */
export const saveCorporateContract = (id: string, data: Record<string, unknown>) => request<CorporatesCompany>(`/corporate/${id}/contract`, { method: 'POST', body: JSON.stringify(data) });
export const addCorporateContact = (id: string, data: { name: string; position?: string; phone?: string; email?: string; isPrimary?: boolean }) => request<CompanyContact>(`/corporate/${id}/contacts`, { method: 'POST', body: JSON.stringify(data) });
export const deleteCorporateContact = (contactId: string) => request<{ id: string }>(`/corporate/contacts/${contactId}`, { method: 'DELETE' });
export const getReceivables = (status?: string) => request<Receivable[]>(`/corporate/receivables${hp(status ? `&status=${encodeURIComponent(status)}` : '')}`);
export const recordReceivable = (data: { companyId: string; description: string; amount: number; dueDate: string }) => request<Receivable>('/corporate/receivables', { method: 'POST', body: JSON.stringify({ ...data, hotelId: getActiveHotel() }) });
export const payReceivable = (id: string, amount: number) => request<Receivable>(`/corporate/receivables/${id}/pay`, { method: 'POST', body: JSON.stringify({ amount }) });
export const remindReceivable = (id: string) => request<Receivable>(`/corporate/receivables/${id}/remind`, { method: 'POST' });
export const rebookCorporateDeal = (reservationId: string) => request<any>(`/corporate/rebook/${reservationId}`, { method: 'POST' });

// ─── AI Prediction / Risk ─────────────────────────────────────────────────
export interface PredictionRisk {
  id: string; hotelId: string; type: string; severity: string;
  title: string; detail: string; source: string;
  proposedAction?: string | null; actionTaken?: string | null;
  autoResolved: boolean; resolvedAt?: string | null; createdAt: string;
}

export const getPredictionRisks = (status?: string) =>
  request<PredictionRisk[]>(`/prediction/risks${hp(status ? `&status=${encodeURIComponent(status)}` : '')}`);

export const takePredictionAction = (id: string, action: string) =>
  request<{ action: string; alternativeRoom?: any }>(`/prediction/risks/${id}/action`, { method: 'POST', body: JSON.stringify({ action }) });

export const dismissPredictionRisk = (id: string) =>
  request<PredictionRisk>(`/prediction/risks/${id}/dismiss`, { method: 'POST' });

export const scanPredictionRisks = () =>
  request<PredictionRisk[]>(`/prediction/scan${hp()}`, { method: 'POST' });

// MICE Studio removed — the screen is gone and the backend module it called
// (/api/mice) is unregistered, so every wrapper here would have 404'd.

// ─── Rentals / Activities (P7.3) ───────────────────────────────────────────
export const getRentalItems = (type?: string) =>
  request<any[]>(`/rentals${hp(type ? `&type=${encodeURIComponent(type)}` : '')}`);
export const createRentalItem = (data: { name: string; type: string; description?: string; pricePerHour?: number; priceFlat?: number; capacity?: number; tags?: string[] }) =>
  request<any>('/rentals', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), ...data }) });
export const getRentalBookings = (date?: string) =>
  request<any[]>(`/rentals/bookings${hp(date ? `&date=${encodeURIComponent(date)}` : '')}`);
export const bookRental = (data: { itemId: string; startTime: string; hours?: number; reservationId?: string; guestName?: string; guestPhone?: string }) =>
  request<any>('/rentals/bookings', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), ...data }) });
export const getRentalUpsell = () => request<any[]>(`/rentals/upsell${hp()}`);

// ─── SPA ───────────────────────────────────────────────────────────────────

export const SPA_BOOKING_STATUSES = ['requested', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'] as const;
export const SPA_PAYMENT_METHODS = ['room_charge', 'rfid', 'cash', 'card'] as const;
/** Methods that settle against a folio instead of taking money at the desk. */
export const SPA_FOLIO_METHODS = ['room_charge', 'rfid'] as const;
export const SPA_ROOM_TYPES = ['massage', 'sauna', 'pool', 'nail', 'facial', 'multi'] as const;
export const SPA_SPECIALTIES = ['massage', 'facial', 'nail', 'sauna', 'body'] as const;
export const SPA_GUEST_TYPES = ['in_house', 'external'] as const;

/** Per-day working window: { mon: ["09:00","18:00"], … }. Absent day = day off. */
export type SpaShift = Record<string, [string, string]>;

export interface SpaTherapist {
  id: string; hotelId: string; name: string;
  specialties: string[];
  shiftSchedule: SpaShift | null;
  phone?: string | null;
  color: string;
  active: boolean;
  createdAt: string;
}

export interface SpaRoom {
  id: string; hotelId: string; name: string;
  type: string; capacity: number; status: string; active: boolean;
}

export interface SpaTreatment {
  id: string; hotelId: string; name: string; category: string;
  durationMin: number; price: number; description?: string | null;
  vatPercent: number; ikpuCode?: string | null;
  requiredSpecialty: string; requiredRoomType: string;
  isCouple: boolean; bufferBeforeMin: number; bufferAfterMin: number;
  active: boolean;
}

export interface SpaBooking {
  id: string; hotelId: string;
  guestName: string; guestPhone?: string | null;
  guestType: string; guestId?: string | null;
  reservationId?: string | null; folioId?: string | null; chargeId?: string | null;
  treatmentId?: string | null; therapistId?: string | null;
  secondTherapistId?: string | null; roomId?: string | null;
  startTime: string; endTime: string;
  status: string; paymentMethod?: string | null; source: string;
  priceSnapshot: number; vatSnapshot: number; durationSnapshot: number;
  notes?: string | null; cancelReason?: string | null;
  completedAt?: string | null; createdAt: string;
  therapist?: { id: string; name: string; color?: string } | null;
  secondTherapist?: { id: string; name: string } | null;
  room?: { id: string; name: string; type?: string } | null;
  treatment?: { id: string; name: string; category?: string; isCouple?: boolean } | null;
}

export interface SpaSlot {
  start: string; end: string;
  therapistIds: string[];
  roomId: string; roomName: string;
}

export interface SpaAvailability {
  date: string;
  slots: SpaSlot[];
  /** Why there is nothing to offer — far more useful than an empty list. */
  reason: string | null;
  therapists: { id: string; name: string }[];
  rooms: { id: string; name: string }[];
  durationMin?: number;
  needed?: number;
}

export interface SpaSummary {
  todayRevenue: number; inHouseRevenue: number; externalRevenue: number;
  completedCount: number; bookingsToday: number; requestedCount: number;
  noShows: number; avgTicket: number;
  masters: number; rooms: number; treatments: number;
  avgUtilisation: number;
  utilisation: { id: string; name: string; bookedMin: number; capacityMin: number; pct: number }[];
  upcoming: {
    id: string; guestName: string; guestType: string; status: string;
    startTime: string; endTime: string;
    treatmentName: string | null; therapistName: string | null; roomName: string | null;
  }[];
  alerts: { kind: string; severity: string; message: string; bookingId?: string }[];
}

export interface SpaReports {
  range: { from: string; to: string };
  totals: {
    revenue: number; bookings: number; completed: number; cancelled: number;
    noShow: number; noShowRate: number; avgTicket: number;
    inHouseRevenue: number; externalRevenue: number; inHousePct: number;
  };
  series: { date: string; revenue: number }[];
  topServices: { name: string; count: number; revenue: number; category: string }[];
  byMaster: { id: string; name: string; count: number; revenue: number; minutes: number; utilisationPct: number }[];
  roomsCount: number;
}

const sq = (params: Record<string, string | number | boolean | undefined>) =>
  hp(Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '' && v !== false)
    .map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`)
    .join(''));
const spaPost = <T,>(path: string, data?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), ...(data as object ?? {}) }) });
const spaPatch = <T,>(path: string, data?: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify({ hotelId: getActiveHotel(), ...(data as object ?? {}) }) });

/* Masters */
export const getSpaTherapists = (includeInactive = false) =>
  request<SpaTherapist[]>(`/spa/therapists${sq({ all: includeInactive })}`);
export const createSpaTherapist = (data: {
  name: string; specialties?: string[]; phone?: string; shiftSchedule?: SpaShift; color?: string;
}) => spaPost<SpaTherapist>('/spa/therapists', data);
export const updateSpaTherapist = (id: string, data: {
  name?: string; specialties?: string[]; phone?: string; shiftSchedule?: SpaShift | null; color?: string; active?: boolean;
}) => spaPatch<SpaTherapist>(`/spa/therapists/${id}`, data);

/* Cabinets */
export const getSpaRooms = (includeInactive = false) =>
  request<SpaRoom[]>(`/spa/rooms${sq({ all: includeInactive })}`);
export const createSpaRoom = (data: { name: string; type?: string; capacity?: number }) =>
  spaPost<SpaRoom>('/spa/rooms', data);
export const updateSpaRoom = (id: string, data: Partial<SpaRoom>) =>
  spaPatch<SpaRoom>(`/spa/rooms/${id}`, data);

/* Service catalog */
export const getSpaTreatments = (includeInactive = false) =>
  request<SpaTreatment[]>(`/spa/treatments${sq({ all: includeInactive })}`);
export const createSpaTreatment = (data: Partial<SpaTreatment> & { name: string }) =>
  spaPost<SpaTreatment>('/spa/treatments', data);
export const updateSpaTreatment = (id: string, data: Partial<SpaTreatment>) =>
  spaPatch<SpaTreatment>(`/spa/treatments/${id}`, data);

/* Scheduling */
export const getSpaAvailability = (treatmentId: string, date: string) =>
  request<SpaAvailability>(`/spa/availability${sq({ treatmentId, date })}`);

export const getSpaBookings = (opts: {
  date?: string; from?: string; to?: string; status?: string;
  therapistId?: string; guestType?: string; search?: string;
} = {}) => request<SpaBooking[]>(`/spa/bookings${sq(opts)}`);

export const getSpaBooking = (id: string) => request<SpaBooking>(`/spa/bookings/${id}${hp()}`);

export const bookSpa = (data: {
  treatmentId: string; startTime: string; guestName: string;
  therapistIds: string[]; roomId: string;
  guestType?: string; guestPhone?: string; reservationId?: string; guestId?: string;
  durationMin?: number; notes?: string; source?: string; status?: string;
}) => spaPost<SpaBooking>('/spa/bookings', data);

export const setSpaBookingStatus = (id: string, status: string, reason?: string) =>
  spaPatch<SpaBooking>(`/spa/bookings/${id}/status`, { status, reason });

export const completeSpaBooking = (id: string, data: { paymentMethod: string; reservationId?: string }) =>
  spaPost<SpaBooking & { fiscalized: boolean }>(`/spa/bookings/${id}/complete`, data);

export const cancelSpaBooking = (id: string, reason?: string) =>
  setSpaBookingStatus(id, 'cancelled', reason);

/* Dashboard & reports */
export const getSpaSummary = () => request<SpaSummary>(`/spa/summary${hp()}`);
export const getSpaReports = (opts: { from?: string; to?: string } = {}) =>
  request<SpaReports>(`/spa/reports${sq(opts)}`);

// ─── AI Upsell Graph (P7.4) ────────────────────────────────────────────────
export const getUpsellScores = (filter?: string) =>
  request<any[]>(`/upsell${hp(filter ? `&filter=${encodeURIComponent(filter)}` : '')}`);
export const getUpsellEffectiveness = () => request<{ total: number; totalRevenue: number; byType: Record<string, { sent: number; accepted: number; revenue: number }> }>(`/upsell/effectiveness${hp()}`);
export const getUpsellThresholds = () => request<Record<string, number>>('/upsell/thresholds');
export const setUpsellThreshold = (offerType: string, threshold: number) =>
  request<any>('/upsell/thresholds', { method: 'POST', body: JSON.stringify({ offerType, threshold }) });
export const runUpsellScoring = () => request<any>(`/upsell/score${hp()}`, { method: 'POST' });

// ─── F&B / Outlets ─────────────────────────────────────────────────────────

export const OUTLET_TYPES = ['restaurant', 'bar', 'cafe', 'room_service'] as const;
export const FB_ORDER_STATUSES = ['open', 'preparing', 'served', 'payment_pending', 'closed', 'void'] as const;
export const FB_PAYMENT_METHODS = ['cash', 'card', 'room_charge', 'rfid'] as const;
/** Methods that settle against a folio instead of taking money at the table. */
export const FB_FOLIO_METHODS = ['room_charge', 'rfid'] as const;
export const FB_TABLE_STATUSES = ['free', 'occupied', 'reserved', 'dirty', 'blocked'] as const;
export const FB_DELIVERY_STATUSES = ['preparing', 'in_delivery', 'delivered'] as const;
export const FB_RESERVATION_STATUSES = ['requested', 'confirmed', 'seated', 'no_show', 'cancelled'] as const;
export const FB_MENU_CATEGORIES = ['food', 'drink', 'alcohol', 'dessert', 'other'] as const;

export interface Outlet {
  id: string; hotelId: string; name: string; type: string;
  fiscalized: boolean; active: boolean; createdAt: string;
  outletCode: string; defaultVatPercent: number; defaultIkpu?: string | null;
  /** JSON string: { mon: ["09:00","23:00"], ... } */
  workingHours?: string | null;
  serviceChargePct: number;
  tableCount: number; menuCount: number; openOrderCount: number;
}

export interface FbTable {
  id: string; hotelId: string; outletId: string; number: string;
  zone?: string | null; capacity: number; status: string;
  currentOrderId?: string | null; mergedInto?: string | null; active: boolean;
  currentOrder?: { id: string; total: number; covers: number; status: string; createdAt: string } | null;
}

export interface FbMenuItem {
  id: string; hotelId: string; outletId: string; name: string; description?: string | null; imageUrl?: string | null; category: string;
  price: number; vatPercent: number; ikpuCode?: string | null;
  halal: boolean; stopList: boolean; sortOrder: number; active: boolean;
}

export interface FbOrderItem {
  id: string; orderId: string; name: string; qty: number; price: number; category: string;
  menuItemId?: string | null; vatPercent: number; ikpuCode?: string | null;
  status: string; voidedBy?: string | null; voidReason?: string | null; voidedAt?: string | null;
}

export interface FbOrder {
  id: string; hotelId: string; outletId: string;
  reservationId?: string | null; guestId?: string | null; folioId?: string | null;
  tableId?: string | null; tableNumber?: string | null;
  status: string; covers: number;
  subtotal: number; taxTotal: number; serviceTotal: number; total: number;
  paymentMethod?: string | null; chargeId?: string | null; fiscalizedAt?: string | null;
  deliveryLocation?: string | null; deliveryStatus?: string | null;
  note?: string | null; voidReason?: string | null;
  createdAt: string; closedAt?: string | null;
  items: FbOrderItem[];
  outlet: { id: string; name: string; type: string };
}

export interface FbTableReservation {
  id: string; hotelId: string; outletId: string;
  guestId?: string | null; guestName?: string | null; phone?: string | null;
  partySize: number; date: string; time: string;
  tableId?: string | null; tableNumber?: string | null;
  status: string; source: string; notes?: string | null;
}

export interface FbSummary {
  todayRevenue: number; avgCheck: number; covers: number; closedCount: number;
  openOrders: number; openTotal: number;
  folioRevenue: number; directRevenue: number; folioPct: number;
  outlets: number; tablesTotal: number; tablesOccupied: number; tablesDirty: number;
  stopListCount: number;
  byOutlet: Record<string, { count: number; total: number }>;
  alerts: { kind: string; severity: string; message: string; orderId?: string }[];
}

export interface FbReports {
  range: { from: string; to: string };
  totals: {
    revenue: number; orders: number; covers: number; avgCheck: number; avgPerCover: number;
    folioRevenue: number; directRevenue: number; folioPct: number; voidedValue: number;
  };
  byOutlet: { outletId: string; name: string; orders: number; covers: number; revenue: number }[];
  series: { date: string; revenue: number }[];
  topItems: { name: string; qty: number; revenue: number; category: string }[];
}

const oq = (params: Record<string, string | number | boolean | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '' && v !== false)
    .map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`);
  return hp(parts.join(''));
};
const post = <T,>(path: string, data?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), ...(data as object ?? {}) }) });
const patch = <T,>(path: string, data?: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify({ hotelId: getActiveHotel(), ...(data as object ?? {}) }) });

/* Outlets */
export const getOutlets = () => request<Outlet[]>(`/outlets${hp()}`);
/**
 * workingHours goes over the wire as a plain object and is stored as JSON, so
 * it is omitted from Partial<Outlet> (where it is the serialized string) before
 * being widened — an intersection alone would keep the stricter `string`.
 */
type OutletInput = Omit<Partial<Outlet>, 'workingHours'> & { workingHours?: unknown };
export const createOutlet = (data: OutletInput & { name: string }) =>
  post<Outlet>('/outlets', data);
export const updateOutlet = (id: string, data: OutletInput) =>
  patch<Outlet>(`/outlets/${id}`, data);

/* Tables */
export const getFbTables = (outletId?: string) =>
  request<FbTable[]>(`/outlets/tables${oq({ outletId })}`);
export const createFbTable = (data: { outletId: string; number: string; zone?: string; capacity?: number }) =>
  post<FbTable>('/outlets/tables', data);
export const updateFbTable = (id: string, data: Partial<FbTable>) =>
  patch<FbTable>(`/outlets/tables/${id}`, data);
export const deleteFbTable = (id: string) =>
  request<FbTable>(`/outlets/tables/${id}${hp()}`, { method: 'DELETE' });
export const mergeFbTables = (leaderId: string, tableIds: string[]) =>
  post<FbTable[]>(`/outlets/tables/${leaderId}/merge`, { tableIds });
export const unmergeFbTable = (id: string) => post<FbTable[]>(`/outlets/tables/${id}/unmerge`);

/* Menu */
export const getFbMenu = (outletId?: string, opts: { category?: string; search?: string } = {}) =>
  request<FbMenuItem[]>(`/outlets/menu${oq({ outletId, ...opts })}`);
export const createFbMenuItem = (data: Partial<FbMenuItem> & { outletId: string; name: string }) =>
  post<FbMenuItem>('/outlets/menu', data);
export const updateFbMenuItem = (id: string, data: Partial<FbMenuItem>) =>
  patch<FbMenuItem>(`/outlets/menu/${id}`, data);
export const deleteFbMenuItem = (id: string) =>
  request<FbMenuItem>(`/outlets/menu/${id}${hp()}`, { method: 'DELETE' });

/* Orders */
export const getOutletOrders = (
  opts: { status?: string; outletId?: string; paymentMethod?: string; roomService?: boolean; search?: string } = {},
) => request<FbOrder[]>(`/outlets/orders${oq(opts)}`);
export const getOutletOrder = (id: string) => request<FbOrder>(`/outlets/orders/${id}${hp()}`);
export const createOutletOrder = (data: {
  outletId: string; tableId?: string; reservationId?: string; guestId?: string;
  covers?: number; note?: string; deliveryLocation?: string;
}) => post<FbOrder>('/outlets/orders', data);
export const addOutletOrderItem = (
  orderId: string,
  item: { menuItemId?: string; name?: string; qty?: number; price?: number; category?: string; vatPercent?: number },
) => post<FbOrder>(`/outlets/orders/${orderId}/items`, item);
export const voidOutletOrderItem = (itemId: string, reason: string) =>
  post<FbOrder>(`/outlets/orders/items/${itemId}/void`, { reason });
export const setOutletItemStatus = (itemId: string, status: string) =>
  patch<FbOrder>(`/outlets/orders/items/${itemId}`, { status });
export const setOutletOrderStatus = (id: string, status: string) =>
  patch<FbOrder>(`/outlets/orders/${id}/status`, { status });
export const setOutletDeliveryStatus = (id: string, status: string) =>
  patch<FbOrder>(`/outlets/orders/${id}/delivery`, { status });
export const voidOutletOrder = (id: string, reason: string) =>
  post<FbOrder>(`/outlets/orders/${id}/void`, { reason });
export const closeOutletOrder = (id: string, data: { paymentMethod: string; reservationId?: string }) =>
  post<FbOrder>(`/outlets/orders/${id}/close`, data);

/* Table reservations */
export const getFbReservations = (opts: { from?: string; to?: string; outletId?: string; status?: string } = {}) =>
  request<{ range: { from: string; to: string }; reservations: FbTableReservation[] }>(
    `/outlets/reservations${oq(opts)}`,
  );
export const createFbReservation = (data: {
  outletId: string; date: string; time: string; partySize?: number;
  guestId?: string; guestName?: string; phone?: string; tableId?: string; notes?: string; source?: string;
}) => post<FbTableReservation>('/outlets/reservations', data);
export const updateFbReservation = (id: string, data: Partial<FbTableReservation>) =>
  patch<FbTableReservation>(`/outlets/reservations/${id}`, data);

/* Dashboard & reports */
export const getOutletSummary = () => request<FbSummary>(`/outlets/summary${hp()}`);
export const getFbReports = (opts: { from?: string; to?: string; outletId?: string } = {}) =>
  request<FbReports>(`/outlets/reports${oq(opts)}`);

// ─── Corporate deal funnel ─────────────────────────────────────────────────
export const DEAL_STAGES = [
  'lead',
  'proposal',
  'approval',
  'contract',
  'execution',
  'closing_documents',
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export interface Deal {
  id: string;
  hotelId: string;
  title: string;
  stage: string;
  status: string; // open | won | lost
  ownerId?: string | null;
  companyId?: string | null;
  miceEventId?: string | null;
  groupBlockId?: string | null;
  value: number;
  depositAmount: number;
  depositPaid: boolean;
  contractSigned: boolean;
  actSigned: boolean;
  currency: string;
  probabilityOverride?: number | null;
  expectedCloseDate?: string | null;
  lostReason?: string | null;
  note?: string | null;
  lastMovedAt: string;
  remindedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  source?: string | null;
  nextStep?: string | null;
  nextStepAt?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  roomsCount: number;
  cutoffAt?: string | null;
  cutoffRemindedAt?: string | null;
  cutoffReleasedAt?: string | null;
  requiresGmApproval: boolean;
  gmApprovedAt?: string | null;
  gmApprovedById?: string | null;
  // server-attached extras
  companyName?: string | null;
  groupName?: string | null;
  probability?: number;
  weightedValue?: number;
  stuck?: boolean;
  daysIdle?: number;
}

export interface DealActivity {
  id: string; dealId: string; type: string;
  fromStage?: string | null; toStage?: string | null;
  message?: string | null; amount?: number | null;
  documentId?: string | null; userId?: string | null; createdAt: string;
}

export interface DealBlockRow {
  id: string; dealId: string; category: string;
  nights: number; qty: number; rate: number; createdAt: string;
}

export interface DealPayment {
  id: string; dealId: string; label: string; amount: number;
  dueAt?: string | null; status: string; paidAt?: string | null; createdAt: string;
}

export interface CompanyRate {
  id: string; companyId: string; category: string; rate: number; meal?: string | null;
}

export interface DealCard {
  deal: Deal;
  company: (Company & { rates?: CompanyRate[] }) | null;
  group: any | null;
  // The legacy /deals module still joins and returns this (the Prisma model is
  // untouched), but MICE Studio is gone from the product so there is no typed
  // shape to point at any more. Left as unknown rather than dropped, so the
  // type keeps matching what the endpoint actually sends.
  miceEvent: unknown | null;
  activities: DealActivity[];
  documents: DocumentRow[];
  blockRows: DealBlockRow[];
  payments: DealPayment[];
}

export interface DealFunnel {
  stages: { stage: string; count: number; sum: number; conversion: number }[];
  lost: { count: number; sum: number };
  won: { count: number; sum: number };
}

export interface DealForecast {
  currency: string;
  openCount: number;
  openValue: number;
  weightedValue: number;
  commit: number;
  wonValue: number;
  wonCount: number;
  byStage: { stage: string; count: number; value: number; weighted: number }[];
  byMonth: { month: string; count: number; value: number; weighted: number }[];
}

export const getDeals = (status?: string) =>
  request<Deal[]>(`/deals${hp(status ? `&status=${encodeURIComponent(status)}` : '')}`);
export const getDealForecast = () => request<DealForecast>(`/deals/forecast${hp()}`);
export const getDeal = (id: string) => request<DealCard>(`/deals/${id}`);
export const createDeal = (data: {
  hotelId?: string; title: string; ownerId?: string; companyId?: string;
  miceEventId?: string; groupBlockId?: string; value?: number; expectedCloseDate?: string; note?: string;
}) => request<Deal>('/deals', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), ...data }) });
export const updateDeal = (id: string, data: Partial<Deal>) =>
  request<Deal>(`/deals/${id}`, { method: 'POST', body: JSON.stringify(data) });
export const moveDeal = (id: string, stage: string, lostReason?: string) =>
  request<Deal>(`/deals/${id}/move`, { method: 'POST', body: JSON.stringify({ stage, lostReason }) });
export const addDealNote = (id: string, message: string) =>
  request<DealActivity>(`/deals/${id}/note`, { method: 'POST', body: JSON.stringify({ message }) });
export const dealDeposit = (id: string, amount: number) =>
  request<Deal>(`/deals/${id}/deposit`, { method: 'POST', body: JSON.stringify({ amount }) });
export const dealSign = (id: string, kind: 'contract' | 'act') =>
  request<Deal>(`/deals/${id}/sign`, { method: 'POST', body: JSON.stringify({ kind }) });
export const generateDealProposal = (id: string) =>
  request<DealCard>(`/deals/${id}/proposal`, { method: 'POST' });
export const getDealFunnel = (days = 90) =>
  request<DealFunnel>(`/deals/funnel${hp(`&days=${days}`)}`);
export const setDealBlock = (
  id: string,
  rows: { category: string; nights?: number; qty?: number; rate?: number }[],
  cutoffAt: string | null,
) => request<Deal>(`/deals/${id}/block`, { method: 'POST', body: JSON.stringify({ rows, cutoffAt }) });
export const setDealPayments = (
  id: string,
  payments: { label: string; amount?: number; dueAt?: string | null; status?: string }[],
) => request<DealPayment[]>(`/deals/${id}/payments`, { method: 'POST', body: JSON.stringify({ payments }) });
export const approveDealGm = (id: string) =>
  request<Deal>(`/deals/${id}/approve`, { method: 'POST' });

// ─── Auto-proposals (P6.4) ─────────────────────────────────────────────────
export interface Proposal {
  id: string; hotelId: string; title: string;
  companyId?: string | null; leadId?: string | null; miceEventId?: string | null;
  lang: string; template: string;
  bodyRu?: string | null; bodyUz?: string | null; bodyEn?: string | null;
  conditions?: string | null;
  totalCost: number; deposit: number;
  signStatus: string; signToken?: string | null;
  sentVia?: string | null; sentAt?: string | null; approvedAt?: string | null;
  esfNumber?: string | null; actNumber?: string | null;
  createdAt: string; updatedAt: string;
}

export const assembleProposal = (miceEventId: string, lang?: string, template?: string, companyId?: string, leadId?: string) =>
  request<Proposal>('/proposals/assemble', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), miceEventId, lang, template, companyId, leadId }) });
export const getProposals = () => request<Proposal[]>(`/proposals${hp()}`);
export const getProposal = (id: string) => request<Proposal>(`/proposals/${id}`);
export const signProposal = (id: string) => request<Proposal>(`/proposals/${id}/sign`, { method: 'POST' });
export const sendProposal = (id: string, via: string, chatId?: string) =>
  request<Proposal>(`/proposals/${id}/send`, { method: 'POST', body: JSON.stringify({ via, chatId }) });
export const approveProposal = (id: string) => request<Proposal>(`/proposals/${id}/approve`, { method: 'POST' });

// ─── Wristband / QR ────────────────────────────────────────────────────────
export interface Wristband {
  id: string; hotelId: string; reservationId: string; guestId: string; folioId: string;
  code: string; status: string; type: string; spendingLimit: number;
  restrictedCategories: string; note?: string | null;
  issuedAt: string; deactivatedAt?: string | null; createdAt: string;
  totalSpent?: number; scanCount?: number;
}

export interface WristbandScan {
  id: string; hotelId: string; wristbandId: string; outlet: string;
  description: string; amount: number; category: string;
  staffId?: string | null; chargeId?: string | null;
  status: string; createdAt: string;
}

export const issueWristband = (reservationId: string, guestId: string, opts?: { type?: string; spendingLimit?: number; restrictedCategories?: string[] }) =>
  request<Wristband & { qrPayload: string; scanUrl: string }>('/wristband/issue', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), reservationId, guestId, ...opts }) });

export const scanWristband = (code: string, data: { outlet: string; description: string; amount: number; category?: string; staffId?: string }) =>
  request<{ ok: boolean; blocked?: boolean; message?: string; charge?: any; scan?: WristbandScan }>(`/wristband/scan/${code}`, { method: 'POST', body: JSON.stringify(data) });

export const getWristband = (code: string) => request<Wristband & { scans: WristbandScan[] }>(`/wristband/${code}`);

export const getWristbands = (status?: string) => request<Wristband[]>(`/wristband${hp(status ? `&status=${encodeURIComponent(status)}` : '')}`);

export const deactivateWristband = (code: string) => request<Wristband>(`/wristband/${code}/deactivate`, { method: 'POST' });

export const deactivateReservationWristbands = (reservationId: string) => request<{ count: number }>(`/wristband/reservation/${reservationId}/deactivate`, { method: 'POST' });

// ─── Antifraud ─────────────────────────────────────────────────────────────
export interface FraudReport {
  windowDays: number;
  signals: { type: string; severity: 'high' | 'medium'; staffId?: string; staffName?: string; outlet?: string; message: string; value: number; threshold: number; refIds?: string[] }[];
  staffRisk: { staffId: string; staffName: string; refundTotal: number; refundCount: number; zeroCount: number; score: number }[];
  outletRisk: { outlet: string; refundTotal: number; zeroCount: number }[];
  stats: { charges: number; refunds: number; zeroed: number; voided: number; cancelled: number; reservations: number };
}

export const getFraudReport = (days = 30) =>
  request<FraudReport>(`/antifraud${hp(`&days=${days}`)}`);

// ─── Documents ─────────────────────────────────────────────────────────────
export interface DocumentRow {
  id: string; hotelId: string; type: string; status: string; number?: string | null;
  folioId?: string | null; paymentId?: string | null; reservationId?: string | null;
  guestId?: string | null; url?: string | null; issuedAt: string;
}

export const getDocuments = (filters: { type?: string; reservationId?: string; guestId?: string; folioId?: string } = {}) =>
  request<DocumentRow[]>(`/documents${hp(
    `${filters.type ? `&type=${encodeURIComponent(filters.type)}` : ''}` +
    `${filters.reservationId ? `&reservationId=${encodeURIComponent(filters.reservationId)}` : ''}` +
    `${filters.guestId ? `&guestId=${encodeURIComponent(filters.guestId)}` : ''}` +
    `${filters.folioId ? `&folioId=${encodeURIComponent(filters.folioId)}` : ''}`,
  )}`);

// ─── Owner dashboard ─────────────────────────────────────────────────────
export const getOwnerMetrics = () => request<any>(`/owner/metrics${hp()}`);
export const getOwnerPnL = () => request<any>(`/owner/pnl${hp()}`);
export const getOwnerVip = () => request<any>(`/owner/vip${hp()}`);
export const getOwnerPortfolio = (orgId?: string) => request<any>(`/owner/portfolio${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''}`);

// ─── Compliance: residency manifest, registry, backups & DR (P12.1) ───────
export interface ResidencyManifest {
  residency: { piiLocation: string; backupLocation: string; appLayer: string };
  registry: { piiRegistryId: string | null; registeredAt: string | null; registered: boolean };
  classification: {
    localOnly: { class: string; examples: string[]; reason: string }[];
    cloudAllowed: { class: string; examples: string[]; reason: string }[];
  };
}

export interface BackupRun {
  id: string;
  database: string;
  kind: string;
  status: string;
  sizeBytes: number;
  primaryPath: string | null;
  replicaPath: string | null;
  restoreOk: boolean;
  detail: string | null;
  createdAt: string;
}

export interface BackupStatus {
  health: {
    healthy: boolean;
    controlUp: boolean;
    tenantsChecked: number;
    tenantsDown: number;
    lastBackupAt: string | null;
    lastBackupAgeHours: number | null;
    problems: string[];
  };
  retentionDays: number;
  primaryLocation: string;
  replicaLocation: string;
  recent: BackupRun[];
}

export const getComplianceManifest = () =>
  request<ResidencyManifest>('/compliance/manifest');

export const updateComplianceRegistry = (data: {
  piiRegistryId?: string;
  dataResidency?: string;
  backupResidency?: string;
  registeredAt?: string;
}) =>
  request<ResidencyManifest>('/compliance/registry', {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const getBackupStatus = () =>
  request<BackupStatus>('/compliance/backups/status');

export const runBackupNow = () =>
  request<unknown[]>('/compliance/backups/run', { method: 'POST' });

export const restoreTestBackup = (id: string) =>
  request<{ ok: boolean; detail?: string }>(
    `/compliance/backups/${id}/restore-test`,
    { method: 'POST' },
  );

// ─── Above-limit approvals — GM confirmation (P12.1) ──────────────────────
export interface ApprovalRequest {
  id: string;
  hotelId: string;
  action: string;
  amount: number;
  reason: string | null;
  payload: string;
  status: string;
  requestedByName: string | null;
  requestedByRole: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  resultRef: string | null;
  createdAt: string;
}

export const requestApproval = (data: {
  action: string;
  amount: number;
  reservationId: string;
  reason?: string;
  method?: string;
  note?: string;
  urgent?: boolean;
}) =>
  request<{ requiresApproval: boolean; executed: boolean; request?: ApprovalRequest; resultRef?: string }>(
    '/approvals/request',
    { method: 'POST', body: JSON.stringify(data) },
  );

export const getApprovals = (status?: string) =>
  request<ApprovalRequest[]>(`/approvals${hp(status ? `&status=${encodeURIComponent(status)}` : '')}`);

export const approveRequest = (id: string, note?: string) =>
  request<ApprovalRequest>(`/approvals/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });

export const rejectRequest = (id: string, note?: string) =>
  request<ApprovalRequest>(`/approvals/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });

export const getApprovalLimits = () =>
  request<Record<string, number>>(`/approvals/limits${hp()}`);

export const updateApprovalLimits = (limits: Record<string, number>) =>
  request<Record<string, number>>(`/approvals/limits${hp()}`, {
    method: 'PUT',
    body: JSON.stringify({ limits }),
  });

// ─── Database operations console (per-org DB ops) ─────────────────────────
export interface DbOverviewRow {
  database: string;
  orgId: string | null;
  name: string;
  reachable: boolean;
  sizeBytes: number;
  lastBackupAt: string | null;
  lastBackupAgeHours: number | null;
  lastBackupStatus: string | null;
  lastRestoreOk: boolean | null;
  missed: boolean;
  schemaVersion: string | null;
  schemaStatus: string | null;
  onCurrentSchema: boolean;
}

export interface DbOverview {
  region: string;
  healthy: boolean;
  currentSchemaVersion: string;
  schema: { onCurrent: number; behind: number; failed: number };
  problems: string[];
  databases: DbOverviewRow[];
}

export interface SchemaMigrationRow {
  scope: string;
  orgName: string | null;
  version: string;
  target: string;
  status: string;
  error: string | null;
  durationMs: number;
  attempts: number;
  appliedAt: string;
}

export interface RestoreTestRow {
  id: string;
  database: string;
  backupId: string | null;
  ok: boolean;
  rowsProbed: number;
  sizeBytes: number;
  detail: string | null;
  createdAt: string;
}

export const getDbOverview = () => request<DbOverview>('/dbops/overview');

export const getDbMigrations = () =>
  request<{ currentVersion: string; onCurrent: number; behind: number; failed: number; databases: SchemaMigrationRow[] }>(
    '/dbops/migrations',
  );

export const runDbMigrations = () =>
  request<unknown>('/dbops/migrations/run', { method: 'POST' });

export const runDbBackup = () =>
  request<unknown[]>('/dbops/backups/run', { method: 'POST' });

export const getDbRestoreTests = () =>
  request<RestoreTestRow[]>('/dbops/restore-tests');

export const runDbRestoreVerify = () =>
  request<unknown[]>('/dbops/restore-tests/run', { method: 'POST' });

export const getDbRecoveryPoints = (database: string) =>
  request<{ id: string; database: string; createdAt: string; sizeBytes: number }[]>(
    `/dbops/recovery-points?database=${encodeURIComponent(database)}`,
  );

export const restoreDbPoint = (backupId: string) =>
  request<{ database: string; pointInTime: string; restored: boolean; rowsProbed: number; detail?: string }>(
    `/dbops/recovery-points/${backupId}/restore`,
    { method: 'POST' },
  );

// ─── Lego Access Builder (visual permission system) ───────────────────────
export interface PermissionDef { key: string; action: string; label: string; risk: string; legalRequired?: boolean }
export interface AccessBlock { module: string; label: string; icon: string; category: string; children: PermissionDef[] }
export interface PolicyTypeDef { type: string; label: string; hint: string; config: Record<string, unknown> }
export interface AccessTemplate { id: string; name: string; baseRole: string | null; color: string; icon: string; description: string }
export interface AccessCatalog { blocks: AccessBlock[]; policyTypes: PolicyTypeDef[]; templates: AccessTemplate[] }

export interface GrantPolicy { id?: string; type: string; config: Record<string, unknown> }
export interface RoleGrant { permission: string; effect: 'allow' | 'deny'; policies: GrantPolicy[] }
export interface AccessRoleSummary {
  id: string; key: string; name: string; description: string | null; color: string; icon: string | null;
  isSystem: boolean; baseRole: string | null; template: string | null;
  allows: number; denies: number; inherits: string[]; members: number;
}
export interface AccessRoleDetail {
  id: string; key: string; name: string; description: string | null; color: string; icon: string | null;
  isSystem: boolean; baseRole: string | null; template: string | null; inherits: string[]; grants: RoleGrant[];
}
export interface EffectiveEntry { allowed: boolean; policies: GrantPolicy[] }
export interface RoleConflict { permission: string; message: string }
export interface ApprovalRuleRow {
  id?: string; name: string; trigger: string; comparator: string; threshold: number;
  approverRole: string; chainOrder?: number; active?: boolean;
}

export const getAccessCatalog = () => request<AccessCatalog>('/access/catalog');
export const getMyEffective = () => request<{ effective: Record<string, EffectiveEntry> }>('/access/effective/me');
export const getAccessRoles = () => request<AccessRoleSummary[]>('/access/roles');
export const getAccessRole = (id: string) => request<AccessRoleDetail>(`/access/roles/${id}`);
export const createAccessRole = (data: { name: string; template?: string; color?: string; icon?: string; description?: string }) =>
  request<{ id: string }>('/access/roles', { method: 'POST', body: JSON.stringify(data) });
export const updateAccessRole = (id: string, data: { name?: string; color?: string; icon?: string; description?: string }) =>
  request(`/access/roles/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteAccessRole = (id: string) => request(`/access/roles/${id}`, { method: 'DELETE' });
export const saveRoleGrants = (id: string, grants: RoleGrant[]) =>
  request<AccessRoleDetail>(`/access/roles/${id}/grants`, { method: 'PUT', body: JSON.stringify({ grants }) });
export const saveRoleInheritance = (id: string, parents: string[]) =>
  request<AccessRoleDetail>(`/access/roles/${id}/inheritance`, { method: 'PUT', body: JSON.stringify({ parents }) });
export const getRoleEffective = (id: string) =>
  request<{ effective: Record<string, EffectiveEntry>; conflicts: RoleConflict[] }>(`/access/roles/${id}/effective`);
export const assignAccessRole = (userId: string, roleId: string | null) =>
  request('/access/assign', { method: 'POST', body: JSON.stringify({ userId, roleId }) });
export const getApprovalRules = () => request<ApprovalRuleRow[]>('/access/approval-rules');
export const saveApprovalRules = (rules: ApprovalRuleRow[]) =>
  request<ApprovalRuleRow[]>('/access/approval-rules', { method: 'PUT', body: JSON.stringify({ rules }) });

// ─── Front Office Workspace ───────────────────────────────────────────────
export interface WsAction { id: string; urgency: 'critical' | 'high' | 'medium'; kind: string; title: string; detail: string; refId?: string; widget: string }
export interface ShiftTaskRow { id: string; kind: string; label: string; refId: string | null; done: boolean; order: number }
export interface WsShift { id: string; userName: string; role: string; status: string; startedAt: string; tasks: ShiftTaskRow[] }
export interface WsQueues {
  arrivals: { id: string; guest: string; eta: string; roomNumber: string; roomType: string; status: string; vip: boolean; due: boolean; online: boolean }[];
  departures: { id: string; guest: string; checkOut: string; roomNumber: string; balance: number; folioStatus: string }[];
  inbox: { id: string; guest: string; channel: string; waitingMin: number; slaBreached: boolean }[];
  emehmon: { id: string; guest: string; roomNumber: string; status: string; stage: string }[];
  folios: { id: string; guest: string; roomNumber: string; checkOut: string; balance: number }[];
  requests: { id: string; title: string; note: string | null; priority: string; createdAt: string }[];
  vip: { id: string; guest: string; roomNumber: string; roomType: string; eta: string; score: number; preferences: string[]; suggestions: { id: string; label: string }[] }[];
  rooms: { available: number; occupied: number; cleaning: number; maintenance: number; dirty: number };
  handover: { tasks: { id: string; title: string; note: string | null }[]; note: string };
}
export interface WsOverview {
  queues: WsQueues;
  actions: WsAction[];
  counts: Record<string, number>;
  shift: WsShift | null;
}
export interface WidgetLayoutItem { id: string; enabled: boolean; span: number }
export interface WidgetCatalogItem { id: string; name: string; desc: string }

export const getWorkspace = () => request<WsOverview>(`/workspace${hp()}`);
export const getWidgetCatalog = () => request<WidgetCatalogItem[]>('/workspace/widgets');
export const startShift = () => request<WsShift>(`/workspace/shift/start${hp()}`, { method: 'POST' });
export const toggleShiftTask = (id: string, done: boolean) =>
  request<ShiftTaskRow>(`/workspace/shift/tasks/${id}`, { method: 'POST', body: JSON.stringify({ done }) });
export const endShift = (id: string, handoverNote?: string) =>
  request<WsShift>(`/workspace/shift/${id}/end`, { method: 'POST', body: JSON.stringify({ handoverNote }) });
export const getWorkspaceLayout = () => request<WidgetLayoutItem[]>('/workspace/layout');
export const saveWorkspaceLayout = (widgets: WidgetLayoutItem[]) =>
  request<WidgetLayoutItem[]>('/workspace/layout', { method: 'PUT', body: JSON.stringify({ widgets }) });

// Shift handover log — writable by any staff member, visible to every role.
export interface HandoverEntry { id: string; author: string; note: string; createdAt: string }
export const getHandover = () => request<HandoverEntry[]>(`/workspace/handover${hp()}`);
export const addHandoverNote = (note: string) =>
  request<HandoverEntry[]>('/workspace/handover', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), note }) });

// ─── Housekeeping dashboard (supervisor role) ─────────────────────────────
export interface HkDashboard {
  kpis: { cleaned: number; inProgress: number; waiting: number; ooo: number; planned: number };
  progress: number;
  shiftDeadline: string;
  roomStatus: { inspected: number; occupied: number; dirty: number; cleaning: number; clean: number; ooo: number };
  priorityRooms: { number: string; type: string; status: string; guest: string; vip: boolean; eta: string; ready: boolean }[];
  maids: { id: string; name: string; done: number; total: number; rooms: string[] }[];
  specialRequests: { room: string; guest: string; request: string; vip: boolean }[];
  lostFound: { id: string; description: string; foundRoom: string | null; foundBy: string | null; status: string; guestInHouse: boolean; createdAt: string }[];
  oooRooms: string[];
}
export const getHkDashboard = () => request<HkDashboard>(`/housekeeping/dashboard${hp()}`);

// ─── Revenue manager dashboard ────────────────────────────────────────────
/**
 * One reason behind a price recommendation, in plain language.
 * `detail` explains what was observed and why it moves the price — see
 * buildRecommendationSignals() in backend/src/revenue/revenue.service.ts.
 */
export interface RevRecommendationSignal {
  key: 'occupancy' | 'pace' | 'event' | 'weekend' | 'leadTime';
  label: string;
  detail: string;
  direction: 'up' | 'down' | 'neutral';
}

export interface RevRecommendation {
  id?: string;
  kind: 'raise' | 'lower' | 'promo';
  dateRange?: string;
  /** ISO date the recommendation applies to. */
  date?: string;
  roomType?: string;
  oldPrice?: number;
  newPrice?: number;
  pctChange?: number;
  confidencePct?: number;
  /** Raw model note (often English) — kept for traceability, not primary copy. */
  reason?: string;
  /** Generated Russian one-liner — what the card shows. */
  summary?: string;
  signals?: RevRecommendationSignal[];
  impactAmount?: number;
  /** Rooms already sold on that date — the multiplier behind impactAmount. */
  roomsOnDate?: number;
  roomsOfType?: number;
  otbPct?: number;
  applyAmountUzs?: number;
  normPct?: number;
}

export interface RevDashboard {
  /** The window the KPI strip / cancel rate / channel mix were actually computed over. */
  range?: { from: string; to: string };
  kpis: {
    adr: number; adrDelta: number; adrSoldNights?: number;
    revpar: number; revparDelta: number;
    occupancy: number; occupancyDelta?: number; occupancyOccupied: number; occupancyTotal: number;
    pickupYesterday?: number; pickupYesterdayDelta?: number; pickupLookaheadDays?: number;
    pickupToday?: number; pickupDelta?: number;
    cancelRate: number; cancelNorm: number; cancelRateDelta?: number;
  };
  otb: {
    date: string; dayOfWeek?: string; pct: number; sold: number; total: number;
    statusCode: 'sold_out' | 'high' | 'good' | 'normal' | 'low'; star: boolean;
  }[];
  forecast: {
    revenue: number; budgetRevenue?: number; revenueVar: number;
    occupancy: number; targetOccupancy?: number; occupancyVar: number;
    adr: number; budgetAdr?: number; adrVar: number;
  };
  recommendations: RevRecommendation[];
  /** Age/status of the cached recommendations above — see AiMeta. */
  recommendationsMeta?: AiMeta;
  pickup: {
    date: string; dayOfWeek?: string; sold: number; revenue?: number; adr?: number;
    isAboveAvg?: boolean; avgPickup?: number; pct?: number; statusCode?: string;
  }[];
  channels: {
    channel: string; label?: string; roomNights?: number; revenue?: number;
    sharePct?: number; commissionPct?: number; adr?: number; color?: string;
    bookings?: number; pct?: number;
  }[];
  channelSummary?: {
    totalGrossRevenue: number;
    avgCommissionPct: number;
  };
  events: {
    id: string; title?: string; dateRange?: string; statusText?: string;
    daysAway?: number; description?: string; configured?: boolean; actionLabel?: string;
    tone?: string; days?: number; date?: string;
  }[];
  alerts: {
    id?: string; type?: 'critical' | 'warning'; title?: string; detail?: string;
    badgeText?: string; badgeType?: 'danger' | 'warning';
    kind?: string; dot?: string; cls?: string; pickupYesterday?: number; pickupToday?: number;
    cancelRate?: number; cancelNorm?: number; date?: string; pct?: number; remaining?: number;
  }[];
}
export const getRevenueDashboard = (from?: string, to?: string) =>
  request<RevDashboard>(`/revenue/dashboard${hp(from && to ? `&from=${from}&to=${to}` : '')}`);
export const applyAiRecommendation = (id: string, roomType?: string, newPrice?: number) =>
  request<{
    ok: boolean; recId: string; roomType: string;
    planId: string; planName: string;
    previousRate: number; newRate: number; appliedAt: string;
  }>(`/revenue/ai-recommendations/${id}/apply${hp()}`, {
    method: 'POST',
    body: JSON.stringify({ roomType, newPrice }),
  });

// ─── Availability-first booking flow ──────────────────────────────────────
export interface AvailableRoom {
  id: string; number: string; type: string; floor: string | null; capacity: number;
  pricePerNight: number; total: number; perNight: number; nights: number; bookable: boolean;
}
export interface AvailabilitySearch {
  checkIn: string; checkOut: string; nights: number; guests: number;
  total: number; available: number; rooms: AvailableRoom[];
}
export const searchAvailableRooms = (checkIn: string, checkOut: string, guests = 1) =>
  request<AvailabilitySearch>(
    `/reservations/available-rooms${hp(`&checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}&guests=${guests}`)}`,
  );
export const checkGuestDuplicate = (phone?: string, passportNo?: string) =>
  request<{ match: Guest | null }>(
    `/guests/duplicate${hp(`${phone ? `&phone=${encodeURIComponent(phone)}` : ''}${passportNo ? `&passportNo=${encodeURIComponent(passportNo)}` : ''}`)}`,
  );

// ─── Atlas (AI staff copilot) ─────────────────────────────────────────────
export type AtlasMessage = { role: 'user' | 'assistant'; content: string };

export type AtlasCard =
  | { kind: 'booking'; guest: string; room: string; checkIn: string; checkOut: string; nights: number; total: number; code: string }
  | { kind: 'guest'; name: string; phone: string; stay?: string; balance?: number; vip?: boolean }
  | { kind: 'availability'; checkIn: string; checkOut: string; rooms: { number: string; type: string; total: number }[] }
  // dueBalance is omitted for roles that may not see money.
  | { kind: 'snapshot'; occupancy: number; arrivals: number; departures: number; inHouse: number; free: number; dueBalance?: number }
  | { kind: 'checklist'; title: string; items: { id: string; title: string }[]; due?: string };

export interface AtlasResult {
  reply: string;
  card?: AtlasCard;
  usedAi: boolean;
}

export const askAtlas = (
  messages: AtlasMessage[],
  opts: { hotelName?: string; lang?: string; screen?: string } = {},
) =>
  request<AtlasResult>('/assistant/ask', {
    method: 'POST',
    body: JSON.stringify({ hotelId: getActiveHotel(), messages, ...opts }),
  });

export interface AtlasSuggestions {
  role: string;
  persona: string;
  suggestions: string[];
}

/**
 * Role-scoped suggested prompts shown when the panel opens empty. The backend
 * derives them from the authenticated role, so a user can never request another
 * role's suggestions.
 */
export const getAtlasSuggestions = () =>
  request<AtlasSuggestions>('/assistant/suggestions');


/**
 * Streaming variant: `onDelta` fires with the running text as Atlas writes it,
 * and the promise resolves with the final result (reply + card). Falls back to
 * the blocking endpoint if the stream can't be opened.
 */
export async function askAtlasStream(
  messages: AtlasMessage[],
  opts: { hotelName?: string; lang?: string; screen?: string } = {},
  onDelta?: (text: string) => void,
): Promise<AtlasResult> {
  const res = await fetch(`${BASE}/assistant/ask/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ hotelId: getActiveHotel(), messages, ...opts }),
  });
  if (!res.ok || !res.body) return askAtlas(messages, opts);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: AtlasResult | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      let evt: { type: string; text?: string; message?: string } & Partial<AtlasResult>;
      try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (evt.type === 'delta') onDelta?.(evt.text ?? '');
      else if (evt.type === 'done') final = { reply: evt.reply ?? '', card: evt.card, usedAi: !!evt.usedAi };
      else if (evt.type === 'error') throw new Error(evt.message || 'Atlas stream failed');
    }
  }
  if (!final) throw new Error('Atlas stream ended without a result');
  return final;
}

/* ── What's-new state (per person, server-side) ───────────────────────────── */
export const getSeenRelease = () =>
  request<{ version: string | null }>('/users/me/release');

export const markSeenRelease = (version: string) =>
  request<{ version: string | null }>('/users/me/release', {
    method: 'POST',
    body: JSON.stringify({ version }),
  });

/* ── Rate calendar grid ──────────────────────────────────────────────────── */
export interface RateGridCell {
  date: string; rate: number; free: number; total: number;
  stopSell: boolean; cta: boolean; ctd?: boolean; mlos: number; dirty: boolean;
  occupancyPct?: number; pickup?: number;
}
export interface RateGridType {
  type: string; total: number; baseRate: number; weekendMultiplier: number; rows: RateGridCell[];
}
export interface RateGrid {
  from: string; to: string;
  days: { date: string; dow: number; isWeekend: boolean }[];
  roomTypes: RateGridType[];
  lastPushedAt: string | null;
}
/**
 * `ratePlanId` prices the grid against one plan instead of each type's active
 * BAR, and narrows it to that plan's room type. Derived plans resolve against
 * their parent server-side.
 */
export const getRateGrid = (roomTypes: string[] | undefined, from: string, to: string, ratePlanId?: string) =>
  request<RateGrid>(`/pricing/grid${hp(
    `&from=${from}&to=${to}`
    + (roomTypes?.length ? `&roomTypes=${roomTypes.map(encodeURIComponent).join(',')}` : '')
    + (ratePlanId ? `&ratePlanId=${encodeURIComponent(ratePlanId)}` : ''),
  )}`);

export const BULK_ACTIONS = ['set_rate', 'increase_pct', 'decrease_pct', 'stop_sell', 'clear_stop_sell', 'set_mlos'] as const;
export interface BulkEditResult { preview: boolean; affectedDates: number; applied?: number; runs?: [string, string][]; roomTypes: string[]; }
export const bulkEditRates = (data: {
  dateFrom: string; dateTo: string; daysOfWeek?: number[]; roomTypes: string[];
  action: string; value?: number; apply?: boolean;
}) => request<BulkEditResult>('/pricing/grid/bulk-edit', {
  method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), ...data }),
});

export const toggleRateCell = (data: { roomType: string; date: string; type: string; value?: number }) =>
  request<{ on: boolean }>('/pricing/grid/toggle-cell', {
    method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), ...data }),
  });

export const pushRatesToChannels = () =>
  request<{ ok: boolean }>('/pricing/push-to-channels', {
    method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel() }),
  });

export interface RateChangeEntry {
  id: string; at: string; source: string; kind: 'rate' | 'stop_sell' | 'cta' | 'ctd' | 'mlos' | string;
  what: string; roomType?: string | null; from?: string; to?: string; multiplier?: number; value?: number;
  field?: string; oldValue?: string; newValue?: string; author?: string; dates?: string; timeStr?: string;
}
export const getRateChangeLog = (limit = 30) =>
  request<RateChangeEntry[]>(`/pricing/change-log${hp(`&limit=${limit}`)}`);

export const getSeasons = () => request<PricingRule[]>(`/pricing/seasons${hp()}`);
export const toggleSeason = (id: string, active: boolean) =>
  request<PricingRule>(`/pricing/seasons/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });

/* ── Demand calendar ─────────────────────────────────────────────────────── */
export interface DemandDay {
  date: string;
  events: { name: string; kind: string; priority: string; source: 'uz_calendar' | 'manual'; id?: string; effectPct?: number }[];
}
export const getDemandEvents = (from: string, to: string) =>
  request<{ from: string; to: string; days: DemandDay[]; customCount: number }>(`/revenue-ext/demand-events${hp(`&from=${from}&to=${to}`)}`);
export const createDemandEvent = (data: { name: string; kind?: string; priority?: string; dateFrom: string; dateTo: string; effectPct?: number; note?: string }) =>
  request<unknown>('/revenue-ext/demand-events', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), ...data }) });
export const deleteDemandEvent = (id: string) =>
  request<{ ok: boolean }>(`/revenue-ext/demand-events/${id}`, { method: 'DELETE' });

export interface DemandYearMonth { month: number; intensity: number; short: string; season: string | null; }
export interface DemandYearRow { year: number; months: DemandYearMonth[]; }
export const getDemandYearCalendar = (years: number[]) =>
  request<{ rows: DemandYearRow[] }>(`/revenue-ext/demand-calendar${hp(`&years=${years.join(',')}`)}`);

/* ── Competitors ──────────────────────────────────────────────────────────── */
export interface Competitor { id: string; hotelId: string; name: string; source: string; active: boolean; createdAt: string; }
export const getCompetitors = () => request<Competitor[]>(`/revenue-ext/competitors${hp()}`);
export const createCompetitor = (name: string) =>
  request<Competitor>('/revenue-ext/competitors', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), name }) });
export const deleteCompetitor = (id: string) =>
  request<{ ok: boolean }>(`/revenue-ext/competitors/${id}`, { method: 'DELETE' });
export const setCompetitorRates = (id: string, rates: { date: string; rate: number }[]) =>
  request<unknown>(`/revenue-ext/competitors/${id}/rates`, { method: 'POST', body: JSON.stringify({ rates }) });

export interface CompSet {
  roomType: string; ourRate: number; ourAvg?: number; ourRates?: Record<string, number>; days: string[];
  rows: { id: string; name: string; source: string; sourceText?: string; cells: { date: string; rate: number | null; diff: number | null }[]; avg: number | null; avgDiff: number | null }[];
}
export const getCompSet = (roomType: string, from: string, to: string) =>
  request<CompSet>(`/revenue-ext/comp-set${hp(`&roomType=${encodeURIComponent(roomType)}&from=${from}&to=${to}`)}`);

/* ── Budget ───────────────────────────────────────────────────────────────── */
export interface BudgetMonth {
  month: number; revenue: number; occupancyPct: number; adr: number;
  otbRevenue: number; otbOccupancy: number; otbAdr: number; deltaPct: number;
}
export const getBudget = (year: number) => request<{ year: number; months: BudgetMonth[] }>(`/revenue-ext/budget${hp(`&year=${year}`)}`);
export const saveBudget = (year: number, rows: { month: number; revenue: number; occupancyPct: number; adr: number }[], label?: string) =>
  request<{ year: number; months: BudgetMonth[] }>('/revenue-ext/budget', {
    method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), year, rows, label }),
  });
export interface BudgetVersion { id: string; hotelId: string; year: number; label: string; rows: string; createdAt: string; createdById?: string | null; }
export const getBudgetVersions = (year: number) => request<BudgetVersion[]>(`/revenue-ext/budget/versions${hp(`&year=${year}`)}`);
export const restoreBudgetVersion = (id: string) =>
  request<{ year: number; months: BudgetMonth[] }>(`/revenue-ext/budget/versions/${id}/restore`, { method: 'POST' });

export const getRevenueForecast = () =>
  request<{
    dailyOtbData: { date: string; otb: number; forecast: number; budget: number }[];
    weeklyOtbData: { date: string; otb: number; forecast: number; budget: number }[];
    monthlyForecastData: { month: string; otb: number; forecast: number; budget: number; delta: number; confidence: number }[];
  }>(`/revenue-ext/forecast${hp()}`);

/* ── Reports ──────────────────────────────────────────────────────────────── */
export interface ReportDef { key: string; group: string; name: string; desc: string; }
export const getReportCatalog = () => request<ReportDef[]>('/revenue-ext/reports/catalog');
// Row/totalRow values are positional — tableCols[i] pairs with row[`c${i}`] —
// so one generic renderer can display any of the 12 report keys identically.
export interface ReportDataRow { [key: `c${number}`]: string | number; }
export const getReportData = (key: string, from?: string, to?: string, segment?: string) =>
  request<{
    title: string;
    bars: { name: string; valueStr: string; amount: number; maxAmount: number; isDark?: boolean }[];
    tableCols: string[];
    rows: ReportDataRow[];
    totalRow: ReportDataRow | null;
  }>(`/revenue-ext/reports/data${hp(`&key=${key}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}${segment ? `&segment=${segment}` : ''}`)}`);
export const generateReport = (key: string, from: string, to: string) =>
  request<{ key: string; csv: string }>(`/revenue-ext/reports/generate${hp(`&key=${key}&from=${from}&to=${to}`)}`);
export interface ReportExport { id: string; hotelId: string; reportKey: string; periodFrom: string; periodTo: string; format: string; sizeBytes: number; createdAt: string; }
export const getReportExports = () => request<ReportExport[]>(`/revenue-ext/reports/exports${hp()}`);
export interface ReportSchedule { id: string; hotelId: string; reportKey: string; frequency: string; channel: string; recipients: string[]; active: boolean; lastSentAt?: string | null; createdAt: string; }
export const getReportSchedules = () => request<ReportSchedule[]>(`/revenue-ext/reports/schedules${hp()}`);
export const createReportSchedule = (data: { reportKey: string; frequency?: string; channel?: string; recipients: string[] }) =>
  request<ReportSchedule>('/revenue-ext/reports/schedules', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), ...data }) });
export const deleteReportSchedule = (id: string) =>
  request<{ ok: boolean }>(`/revenue-ext/reports/schedules/${id}`, { method: 'DELETE' });

/* ── Sales Dashboard ──────────────────────────────────────────────────────── */
export interface SalesAlert {
  severity: 'critical' | 'warning';
  badgeText: 'критично' | 'внимание';
  kind: string;
  message: string;
  actionLabel: string;
  target: { type: 'deal' | 'group' | 'company' | 'receivable' | 'inbox'; id: string };
}

export interface SalesKpis {
  openDeals: number;
  openDealsDiffText: string;
  pipeline: number;
  weightedPipeline: number;
  closedThisMonth: number;
  closedPlan: number;
  closedPlanPct: number;
  conversionPct: number;
  conversionWindow: string;
  avgCycleDays: number;
  avgCycleSub: string;
}

export interface SalesFunnelStage {
  stage: string;
  stageLabel: string;
  count: number;
  sum: number;
  probability: number;
  conversionPct: number | null;
}

export interface SalesAttentionDeal {
  id: string;
  title: string;
  company: string | null;
  companyId: string | null;
  stage: string;
  value: number;
  currency: string;
  rooms: number;
  checkIn: string | null;
  checkOut: string | null;
  cutoffAt: string | null;
  nextStep: string | null;
  nextStepAt: string | null;
  manager: string | null;
  source: string | null;
  daysInStage: number;
}

export interface SalesTask {
  id: string;
  title: string;
  company: string;
  time: string;
  category: string;
  done: boolean;
  urgent: boolean;
}

export interface UpcomingEvent {
  id: string;
  name: string;
  company: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
  hall: string | null;
  depositStatus: string | null;
  status: string;
}

export interface UnprocessedLead {
  id: string;
  channel: string;
  contactName: string;
  text: string;
  waitTimeText: string;
}

export interface SalesDashboardData {
  usdExchangeRate: number;
  kpis: SalesKpis;
  funnel: SalesFunnelStage[];
  lost: {
    countThisMonth: number;
    sumThisMonth: number;
    reasons: { reason: string; count: number; sum: number }[];
  };
  alerts: SalesAlert[];
  attention: SalesAttentionDeal[];
  tasks: SalesTask[];
  unprocessedLeads: UnprocessedLead[];
  upcoming: UpcomingEvent[];
  stuckDays: number;
}

export const getSalesDashboard = (stuckDays?: number) =>
  request<SalesDashboardData>(`/sales/dashboard${hp(stuckDays ? `&stuckDays=${stuckDays}` : '')}`);

/* ── Sales Module API Exports ─────────────────────────────────────────────── */
export const SALES_STAGES = ['lead', 'qualification', 'proposal_sent', 'contract', 'deposit', 'execution', 'closed'] as const;
export const SALES_LOSS_REASONS = ['price_too_high', 'dates_unavailable', 'competitor_won', 'canceled_event', 'no_response', 'other'] as const;
export type SalesLossReason = typeof SALES_LOSS_REASONS[number];

export interface SalesDealCard {
  id: string;
  title: string;
  company: any;
  companyId: string | null;
  stage: string;
  value: number;
  currency: string;
  rooms: number;
  checkIn: string | null;
  checkOut: string | null;
  cutoffAt: string | null;
  nextStep: string | null;
  nextStepAt: string | null;
  manager: string | null;
  source: string | null;
  daysInStage: number;
  requiresGmApproval?: boolean;
  lostReason?: string | null;
  probability: number;
  gmApprovedAt?: string | null;
  [key: string]: any;
}

export interface DealsData {
  stuckDays?: number;
  kpis: { openPipeline: number; weightedPipeline: number; openCount: number; stuckCount: number };
  columns: { stage: string; probability: number; count: number; sum: number; cards: SalesDealCard[] }[];
  lost: SalesDealCard[];
  rows: SalesDealCard[];
  [key: string]: any;
}

export interface DealDetail extends SalesDealCard {
  note?: string | null;
  transitions: any[];
  blockRows: any[];
  proposals: any[];
  documents?: any;
  activities: any[];
  finance?: any;
  payments: any[];
}

/** Serialise a filter object into `&k=v` pairs, skipping empty values. */
const qsOf = (filters?: Record<string, unknown>) =>
  Object.entries(filters ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`)
    .join('');

// Every filter here is a real query param on GET /sales/deals. They used to be
// declared in the signature but only `search` was ever appended to the URL, so
// passing a manager or a source silently returned the unfiltered list.
export const getSalesDeals = (filters?: { search?: string; stage?: string; manager?: string; source?: string; stuckDays?: number }) =>
  request<DealsData>(`/sales/deals${hp(qsOf(filters))}`);

export const getSalesDeal = (id: string) =>
  request<DealDetail>(`/sales/deals/${id}${hp()}`);

export const moveDealStage = (id: string, stage: string) =>
  request<{ ok: boolean }>(`/sales/deals/${id}/stage`, { method: 'PATCH', body: JSON.stringify({ hotelId: getActiveHotel(), stage }) });

export const loseDeal = (id: string, reason: string, note?: string) =>
  request<{ ok: boolean }>(`/sales/deals/${id}/lose`, { method: 'PATCH', body: JSON.stringify({ hotelId: getActiveHotel(), reason, note }) });

export interface CompanyRow {
  id: string;
  name: string;
  legalName?: string | null;
  segment?: string | null;
  taxId?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  contractTill?: string | null;
  activeDealsCount?: number;
  openReceivablesCount?: number;
  totalSpent?: number;
  companies?: any[];
  [key: string]: any;
}

export interface CompanyDetail extends CompanyRow {
  contract?: any;
  stats?: any;
  industry?: any;
  manager?: any;
  address?: any;
  note?: any;
  rates: any[];
  deals: any[];
  groups: any[];
  receivables: any[];
  contacts: any[];
}

// Same shape as GET /sales/companies returns.
export interface SalesCompanyRow {
  id: string; name: string; segment: string | null; taxId: string | null;
  industry: string | null; manager: string | null; isAgency: boolean;
  revenue12m: number; dealCount: number; avgDeal: number;
  outstanding: number; overdue: boolean; contractTill: string | null;
}

// `segment` and `overdueOnly` are real server-side filters; they were declared
// here but never appended to the URL, so the server always got an unfiltered
// request and the toggles did nothing.
export const getSalesCompanies = (filters?: { search?: string; segment?: string; overdueOnly?: boolean }) =>
  request<{ companies: SalesCompanyRow[] }>(`/sales/companies${hp(qsOf(filters))}`);

export const getSalesCompany = (id: string) =>
  request<CompanyDetail>(`/sales/companies/${id}${hp()}`);

export interface SalesGroupRow {
  id: string; name: string; company: string | null; companyId: string | null;
  arrivalDate: string | null; departureDate: string | null; nights: number;
  roomsSold: number; pax: number;
  cutoffDate: string | null; daysToCutoff: number | null;
  depositStatus: string | null; depositPct: number;
  roomingStatus: string; status: string;
  hall: string | null; manager: string | null; billing: string;
}
export interface SalesGroupsKpis {
  groupsThisMonth: number; roomNights: number; cutoffSoon: number; roomingMissing: number;
}

/** One row of getGroup()'s `blockRows` — the room mix as actually reserved,
 *  not a separately-tracked "planned" allotment (there is no such field). */
export interface SalesGroupBlockRow {
  category: string; qty: number; nights: number; revenue: number;
}
/** One guest on the rooming list, with the E-Mehmon gate already evaluated
 *  server-side (`blocksEmehmon`) — the UI only needs to render the flag. */
export interface SalesRoomingGuest {
  reservationId: string; guestId: string; name: string;
  citizenship: string | null; docNumber: string | null;
  room: string; category: string; checkIn: string; checkOut: string; guestCount: number;
  foreign: boolean; blocksEmehmon: boolean; emehmonStatus: string | null;
}
export interface SalesGroupDetail {
  id: string; name: string;
  company: { id: string; name: string; taxId: string | null } | null;
  arrivalDate: string | null; departureDate: string | null; nights: number;
  cutoffDate: string | null; daysToCutoff: number | null;
  status: string; hall: string | null; manager: string | null; billing: string;
  note: string | null; depositStatus: string | null; roomingStatus: string;
  blockRows: SalesGroupBlockRow[];
  roomsSold: number; pax: number;
  rooming: SalesRoomingGuest[];
  emehmon: { foreignCount: number; blockedCount: number; submitted: number };
  finance: { total: number; net: number; vat: number; deposit: number; depositPct: number; outstanding: number };
  /** Id of the one folio billed to the company instead of N per-guest folios
   *  — null until that folio is actually created (no auto-creation exists yet). */
  masterFolioId: string | null;
}

// GET /sales/groups takes no filters server-side (only hotelId) — the `search`
// param this used to send was silently ignored. Filtering happens client-side.
export const getSalesGroups = () =>
  request<{ groups: SalesGroupRow[]; kpis: SalesGroupsKpis }>(`/sales/groups${hp()}`);

export const getSalesGroup = (id: string) =>
  request<SalesGroupDetail>(`/sales/groups/${id}${hp()}`);

// These five were declared as POST but the controller mounts them as PATCH, so
// every one of them 404'd. Method and body now match the controller exactly.
export const releaseGroupBlock = (id: string) =>
  request<{ ok: boolean }>(`/sales/groups/${id}/release`, { method: 'PATCH', body: JSON.stringify({ hotelId: getActiveHotel() }) });

export const submitGroupRooming = (id: string) =>
  request<{ ok: boolean }>(`/sales/groups/${id}/rooming`, { method: 'PATCH', body: JSON.stringify({ hotelId: getActiveHotel() }) });

export const extendGroupCutoff = (id: string, cutoffDate: string) =>
  request<{ ok: boolean }>(`/sales/groups/${id}/cutoff`, { method: 'PATCH', body: JSON.stringify({ hotelId: getActiveHotel(), cutoffDate }) });

export interface ProposalRow {
  id: string;
  number?: string;
  dealId?: string | null;
  dealTitle?: string | null;
  companyName?: string | null;
  company?: string | null;
  version?: number;
  totalCost?: number;
  amount: number;
  currency?: string;
  lang: string;
  manager?: string;
  title?: string;
  status: string;
  createdAt: string;
  sentAt?: string | null;
  validUntil?: string | null;
  finance?: any;
  versions: any[];
  conditions?: any;
  [key: string]: any;
}

export interface ProposalDetail extends ProposalRow {
  items?: { description: string; qty: number; price: number; amount: number }[];
}

export interface ProposalsData {
  proposals: ProposalRow[];
  [key: string]: any;
}

export interface SalesProposalRow {
  id: string; number: string | null; company: string | null; companyId: string | null;
  type: string | null; version: number; totalCost: number; currency: string; lang: string;
  validUntil: string | null; status: string; manager: string | null;
  sentAt: string | null; signStatus: string | null;
}

// status/manager/search are real server-side filters — this used to drop all
// of them on the floor (`hp()` with no args).
export const getSalesProposals = (filters?: { status?: string; manager?: string; search?: string }) =>
  request<{ proposals: SalesProposalRow[] }>(`/sales/proposals${hp(qsOf(filters))}`);

export const getSalesProposal = (id: string) =>
  request<ProposalDetail>(`/sales/proposals/${id}${hp()}`);

export const createSalesProposal = (data: any) =>
  request<ProposalDetail>('/sales/proposals', { method: 'POST', body: JSON.stringify({ hotelId: getActiveHotel(), ...data }) });

// PATCH, not POST (see the group endpoints above). `via` is required by the
// controller signature — omitting it sent `undefined` as the delivery channel.
export const sendSalesProposal = (id: string, via: string) =>
  request<{ ok: boolean }>(`/sales/proposals/${id}/send`, { method: 'PATCH', body: JSON.stringify({ hotelId: getActiveHotel(), via }) });

export const acceptSalesProposal = (id: string) =>
  request<{ ok: boolean }>(`/sales/proposals/${id}/accept`, { method: 'PATCH', body: JSON.stringify({ hotelId: getActiveHotel() }) });

export interface SalesReceivableRow {
  id: string;
  companyName: string;
  companyId: string;
  description: string;
  amount: number;
  paid: number;
  dueDate: string;
  overdueDays: number;
  status: string;
  [key: string]: any;
}

export interface SalesReceivablesData {
  totals: any;
  buckets: any[];
  receivables: SalesReceivableRow[];
  topDebtors: any[];
  [key: string]: any;
}

export const getSalesReceivables = (filters?: { companyId?: string; manager?: string; bucket?: string; search?: string }) =>
  request<SalesReceivablesData>(`/sales/receivables${hp(qsOf(filters))}`);

export const remindSalesReceivable = (id: string) =>
  request<{ ok: boolean }>(`/sales/receivables/${id}/remind`, { method: 'PATCH', body: JSON.stringify({ hotelId: getActiveHotel() }) });









/* ── Restrictions grid (Тарифы и ограничения → Ограничения) ───────────────── */

/** Rule rows of the grid, in display order. */
export const RESTRICTION_TYPES = ['stop_sell', 'cta', 'ctd', 'mlos', 'maxlos', 'release'] as const;
export type RestrictionType = (typeof RESTRICTION_TYPES)[number];

export interface RestrictionsGrid {
  roomType: string;
  dates: { date: string; day: string; dow: string; weekend: boolean; today: boolean }[];
  rows: {
    type: RestrictionType;
    /** mlos/maxlos/release hold a number; the rest are on/off flags. */
    numeric: boolean;
    cells: {
      date: string; on: boolean; value: number; id: string | null;
      /** Part of a multi-day rule — not editable as a single cell. */
      spansRange: boolean;
    }[];
  }[];
}

export const getRestrictionsGrid = (roomType: string, days = 30, from?: string) =>
  request<RestrictionsGrid>(
    `/pricing/restrictions/grid${hp(`&roomType=${encodeURIComponent(roomType)}&days=${days}${from ? `&from=${from}` : ''}`)}`,
  );

/** Toggle a flag cell, or set a numeric one (value 0 clears it). */
export const setRestrictionCell = (data: {
  roomType: string; date: string; type: RestrictionType; value?: number;
}) =>
  request<{ ok: boolean; cleared: boolean }>('/pricing/restrictions/cell', {
    method: 'POST',
    body: JSON.stringify({ hotelId: getActiveHotel(), ...data }),
  });

/* ─── Guest mobile access (front desk) ────────────────────────────────────── */

export interface GuestAppAccess {
  hasPhone: boolean;
  phone?: string;
  account: {
    id: string;
    login: string;
    /** True once the guest has chosen their own password. */
    hasPassword: boolean;
    lastLoginAt: string | null;
    blocked: boolean;
    lockedUntil: string | null;
    createdAt: string;
  } | null;
  /** An activation code that has been issued but not yet used. */
  pending: { expiresAt: string; attempts: number } | null;
}

export const getGuestAppAccess = (guestId: string) =>
  request<GuestAppAccess>(`/guest-access/${guestId}`);

/**
 * Creates or re-arms the account and returns the activation code ONCE. Only
 * the hash is stored, so this response is the single moment the code exists in
 * readable form — the desk must read it out now.
 */
export const createGuestAppAccount = (guestId: string, login?: string) =>
  request<{ created: boolean; login?: string; code?: string; expiresAt?: string; reason?: string }>(
    `/guest-access/${guestId}/create`,
    { method: 'POST', body: JSON.stringify({ login }) },
  );

/** Clears the password and issues a fresh code so the guest sets a new one. */
export const resetGuestAppPassword = (guestId: string) =>
  request<{ reset: boolean; login?: string; code?: string; expiresAt?: string; reason?: string }>(
    `/guest-access/${guestId}/reset`,
    { method: 'POST' },
  );

export const changeGuestAppLogin = (guestId: string, login: string) =>
  request<{ ok: boolean; login?: string; reason?: string }>(`/guest-access/${guestId}/login`, {
    method: 'POST',
    body: JSON.stringify({ login }),
  });

export const setGuestAppBlocked = (guestId: string, blocked: boolean) =>
  request<{ ok: boolean; blocked: boolean }>(`/guest-access/${guestId}/block`, {
    method: 'POST',
    body: JSON.stringify({ blocked }),
  });
