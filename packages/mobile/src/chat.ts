import { Ionicons } from '@expo/vector-icons';

/**
 * The guest's message channels.
 *
 * Only two exist, and that is deliberate. An earlier version of this list also
 * carried "Spa & Wellness" and "In-Room Dining" rows: both showed a fabricated
 * last message and an unread badge, and opening either gave a thread with one
 * hardcoded sentence and no way to send anything — there is no backend channel
 * behind them (see `guest-app.controller.ts`, which exposes messages only per
 * stay). Spa and dining are real features in this app, but they live in
 * Services as booking and ordering flows, not as chat threads that cannot
 * receive a reply.
 */
export type ChannelId = 'frontdesk' | 'ai';

export interface Channel {
  id: ChannelId;
  name: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Avatar background. Front desk wears the hotel's own dark identity. */
  tone: string;
  badge?: string;
  /** Whether this thread reaches a real person through the PMS. */
  live: boolean;
}

export const CHANNELS: Channel[] = [
  {
    id: 'frontdesk',
    name: 'Front Desk',
    subtitle: 'Reception · replies in person',
    icon: 'business',
    tone: '#0E1A2B',
    live: true,
  },
  {
    id: 'ai',
    name: 'Atlas AI',
    subtitle: 'Instant answers, any hour',
    icon: 'sparkles',
    tone: '#5B4BD6',
    badge: 'AI',
    live: false,
  },
];

export const channelById = (id: string): Channel | undefined =>
  CHANNELS.find((ch) => ch.id === id);
