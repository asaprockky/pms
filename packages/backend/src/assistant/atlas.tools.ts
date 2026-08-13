import { Role } from '../auth/roles';

/**
 * Atlas's tool catalogue, with the access rules attached to each tool.
 *
 * The catalogue is the security boundary, not a convenience: a housekeeper must
 * never be able to talk Atlas into reading a guest's folio balance or the
 * month's revenue. So every tool declares the roles allowed to call it, the
 * catalogue handed to the model is filtered per request, and dispatch checks the
 * same list again — a model that hallucinates a tool name it was never offered
 * gets refused rather than served.
 */

const EVERYONE: Role[] = [
  'owner', 'gm', 'front_desk', 'housekeeping', 'finance', 'outlet', 'sales', 'maintenance', 'revenue',
];
const LEADERSHIP: Role[] = ['owner', 'gm'];
/** Desk-side roles that work with guests and bookings. */
const FRONT: Role[] = [...LEADERSHIP, 'front_desk', 'sales'];
/** Roles that may see a guest's money (the desk settles folios at check-out). */
export const GUEST_MONEY_ROLES: Role[] = [...LEADERSHIP, 'front_desk', 'finance'];
/** Roles that may see business-level money: revenue, ADR, outstanding totals. */
export const BUSINESS_MONEY_ROLES: Role[] = [...LEADERSHIP, 'finance', 'revenue'];
const HOUSEKEEPING: Role[] = [...LEADERSHIP, 'housekeeping'];
const TECH: Role[] = [...LEADERSHIP, 'maintenance'];

export interface AtlasTool {
  /** Roles permitted to call this tool. Everything else is refused. */
  roles: Role[];
  description: string;
  parameters: Record<string, unknown>;
}

const noArgs = { type: 'object', properties: {} };

export const ATLAS_TOOLS: Record<string, AtlasTool> = {
  /* ─── Read: property state ──────────────────────────────────────────────── */
  get_snapshot: {
    roles: EVERYONE,
    description:
      "Live property snapshot: occupancy %, today's arrivals and departures, in-house count, free rooms. Outstanding balance is included only for roles that may see money.",
    parameters: noArgs,
  },
  list_arrivals: {
    roles: [...FRONT, 'revenue'],
    description: 'Guests arriving today with their room and room type.',
    parameters: noArgs,
  },
  list_departures: {
    roles: FRONT,
    description:
      'Guests departing today with their room. Outstanding balance is included only for roles that may see guest money.',
    parameters: noArgs,
  },
  find_guest: {
    roles: FRONT,
    description:
      'Search guests by name or phone; returns their current or upcoming stay. Balance is included only for roles that may see guest money.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  check_availability: {
    roles: [...FRONT, 'revenue'],
    description: 'Free rooms for a date range with prices. Dates are YYYY-MM-DD.',
    parameters: {
      type: 'object',
      properties: {
        check_in: { type: 'string' },
        check_out: { type: 'string' },
        guests: { type: 'integer' },
      },
      required: ['check_in', 'check_out'],
    },
  },

  /* ─── Read: department boards ───────────────────────────────────────────── */
  housekeeping_board: {
    roles: HOUSEKEEPING,
    description:
      'Housekeeping status of every room: clean / dirty / in progress / inspected / occupied / out of order, who it is assigned to, and whether it is overdue.',
    parameters: noArgs,
  },
  list_work_orders: {
    roles: [...TECH, 'housekeeping'],
    description: 'Maintenance tickets (work orders) with priority, status and room.',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['open', 'in_progress', 'resolved'] } },
    },
  },
  list_messages: {
    roles: FRONT,
    description:
      'Guest conversations from the Inbox (Telegram, WhatsApp, etc). Returns each thread with its latest message, who it is from, the channel, how long it has been waiting for a reply, whether the guest is still waiting on us, and whether its SLA is breached — everything needed to rank them by urgency.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'closed'] },
        limit: { type: 'integer', description: 'How many threads, default 20' },
      },
    },
  },
  list_tasks: {
    roles: EVERYONE,
    description: 'Open tasks and to-do items for the property.',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['open', 'done'] } },
    },
  },
  revenue_summary: {
    roles: BUSINESS_MONEY_ROLES,
    description:
      'Business performance: revenue collected today and over the last 7 days, ADR, occupancy and total outstanding balance.',
    parameters: noArgs,
  },
  get_revenue_forecast: {
    roles: [...LEADERSHIP, 'revenue'],
    description:
      'Demand and revenue outlook: projected occupancy and expected revenue for the coming days, based on current bookings on the books.',
    parameters: noArgs,
  },
  get_occupancy_forecast: {
    roles: [...LEADERSHIP, 'revenue'],
    description:
      'Projected occupancy for the coming days based on confirmed bookings on the books.',
    parameters: noArgs,
  },
  get_guest_folio: {
    roles: GUEST_MONEY_ROLES,
    description:
      'A guest\'s folio: their charges, completed payments and current balance. Resolve the guest by name or phone.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Guest name or phone' } },
      required: ['query'],
    },
  },
  get_room_status: {
    roles: [...HOUSEKEEPING, ...TECH],
    description:
      'Detailed status of a single room: cleanliness, occupancy, housekeeping assignment and any open work order.',
    parameters: {
      type: 'object',
      properties: { room_number: { type: 'string' } },
      required: ['room_number'],
    },
  },
  list_housekeeping_staff: {
    roles: HOUSEKEEPING,
    description: 'The housekeeping team on shift, so you can see who is available to assign rooms to.',
    parameters: noArgs,
  },
  get_work_order_detail: {
    roles: [...TECH, 'housekeeping'],
    description:
      'Full detail of a single maintenance ticket by its title or room number: description, priority, status and when it was opened.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  list_today_events: {
    roles: [...FRONT, 'sales'],
    description:
      'Groups and events in-house or arriving today, so the team knows what is happening on the property.',
    parameters: noArgs,
  },
  list_leads: {
    roles: [...LEADERSHIP, 'sales'],
    description: 'Open sales leads that have not been converted yet, so the team can follow up.',
    parameters: noArgs,
  },
  list_deals: {
    roles: [...LEADERSHIP, 'sales'],
    description:
      'The sales pipeline: open deals with their stage, value, owner, next step and expected close date, so the team can see what is moving and what is stuck.',
    parameters: {
      type: 'object',
      properties: { stage: { type: 'string', description: 'Filter by stage, e.g. lead, negotiation, won' } },
    },
  },
  get_deal_detail: {
    roles: [...LEADERSHIP, 'sales'],
    description:
      'Full detail of a single deal by its title: stage, value, deposit, next step, expected close, room block and payment schedule.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  list_proposals: {
    roles: [...LEADERSHIP, 'sales'],
    description:
      'Proposals sent to clients with their sign status, so the team can follow up on unsigned ones.',
    parameters: {
      type: 'object',
      properties: { sign_status: { type: 'string', enum: ['unsigned', 'signed', 'approved'] } },
    },
  },
  list_group_blocks: {
    roles: [...FRONT, 'sales'],
    description:
      'Group room blocks with their arrival/departure dates and status, so the team knows what groups are on the books.',
    parameters: noArgs,
  },
  list_mice_events: {
    roles: [...FRONT, 'sales'],
    description:
      'MICE / event bookings with their status and total cost, so the team can prepare for upcoming events.',
    parameters: noArgs,
  },
  list_campaigns: {
    roles: [...LEADERSHIP, 'sales'],
    description: 'Marketing campaigns that have been run, with their segment, channel and how many were sent.',
    parameters: noArgs,
  },
  list_spa_bookings: {
    roles: [...FRONT, 'outlet'],
    description:
      'Spa appointments for a given day with guest, treatment, therapist and status, so the team can manage the spa diary.',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD; defaults to today' } },
    },
  },
  list_spa_treatments: {
    roles: [...FRONT, 'outlet'],
    description: 'The spa treatment menu with prices and durations, so the team can quote a guest.',
    parameters: noArgs,
  },
  list_outlet_orders: {
    roles: [...LEADERSHIP, 'outlet'],
    description:
      'Open F&B / outlet orders with their total and table, so the outlet team can see what is live on the floor.',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['open', 'closed'] } },
    },
  },
  list_wristbands: {
    roles: [...FRONT, 'finance'],
    description:
      'Active wristbands with their code, spending limit and status, so the desk can manage guest charging.',
    parameters: noArgs,
  },
  list_reviews: {
    roles: [...LEADERSHIP, 'front_desk'],
    description:
      'Recent guest reviews with rating, sentiment and reply status, so the team can respond to feedback.',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['new', 'replied'] } },
    },
  },
  list_risks: {
    roles: [...LEADERSHIP, 'revenue'],
    description:
      'Predicted operational risks (overbooking, no-shows, cash gaps, etc) with severity and proposed action, so leadership can act before problems hit.',
    parameters: {
      type: 'object',
      properties: { severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] } },
    },
  },


  /* ─── Act ───────────────────────────────────────────────────────────────── */

  create_reservation: {
    roles: FRONT,
    description:
      'Create a confirmed booking immediately. Resolve the guest with guest_query (existing guest) or guest_name (+ optional guest_phone) to create a new profile. Optionally target room_number or room_type. Dates are YYYY-MM-DD.',
    parameters: {
      type: 'object',
      properties: {
        guest_query: { type: 'string' },
        guest_name: { type: 'string' },
        guest_phone: { type: 'string' },
        room_number: { type: 'string' },
        room_type: { type: 'string' },
        check_in: { type: 'string' },
        check_out: { type: 'string' },
        guests: { type: 'integer' },
      },
      required: ['check_in', 'check_out'],
    },
  },
  assign_housekeeping: {
    roles: HOUSEKEEPING,
    description:
      'Assign a room to a housekeeper by room number and staff name, or pass clear=true to remove the assignment.',
    parameters: {
      type: 'object',
      properties: {
        room_number: { type: 'string' },
        staff_name: { type: 'string' },
        clear: { type: 'boolean' },
      },
      required: ['room_number'],
    },
  },
  create_work_order: {
    // Anyone can report something broken — that is how a breakage reaches the
    // technical team in the first place.
    roles: EVERYONE,
    description: 'Report a breakage / raise a maintenance ticket for the technical team.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        room_number: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      },
      required: ['title'],
    },
  },
  resolve_work_order: {
    roles: TECH,
    description: 'Mark a maintenance ticket as in progress or resolved, by its title or room number.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        status: { type: 'string', enum: ['in_progress', 'resolved'] },
      },
      required: ['query', 'status'],
    },
  },
  create_checklist: {
    roles: EVERYONE,
    description:
      'Create a to-do list / checklist / shift handout. Each item becomes a real task in the platform so it can be tracked and exported. Use this whenever the user asks for a list of things to do, a handover, or a checklist.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['title', 'items'],
    },
  },
  complete_task: {
    roles: EVERYONE,
    description: 'Mark a task or checklist item as done, found by its title.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  notify_staff: {
    roles: EVERYONE,
    description: 'Leave a note or reminder for the team as a single task.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        note: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: ['title'],
    },
  },
};

export const canUseTool = (role: Role, name: string): boolean =>
  !!ATLAS_TOOLS[name]?.roles.includes(role);

/** The OpenAI-compatible catalogue this role is allowed to see. */
export function toolsForRole(role: Role) {
  return Object.entries(ATLAS_TOOLS)
    .filter(([, t]) => t.roles.includes(role))
    .map(([name, t]) => ({
      type: 'function',
      function: { name, description: t.description, parameters: t.parameters },
    }));
}

export const canSeeGuestMoney = (role: Role) => GUEST_MONEY_ROLES.includes(role);
export const canSeeBusinessMoney = (role: Role) => BUSINESS_MONEY_ROLES.includes(role);
