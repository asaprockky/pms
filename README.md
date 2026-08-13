# Atlas Suite — Operating System for Independent Resorts & Boutique Hotels

All-in-one Property Management System (PMS) and operating OS built specifically for independent resorts, park-hotels, and boutique properties in Central Asia (20–200 lodging units: rooms, cottages, villas, yurts, tents, capsules).

Unlike traditional hotel software designed only for room sales, Atlas Suite treats a resort as a **mini-city** — revenue comes from rooms, restaurant, bar, SPA, equipment rentals (ATVs, SUP boards, skis), banquets, transfers, and activities.

It exists to solve three critical industry pain points:
1. **Revenue leakage** past the cash register and unposted outlet spending.
2. **Opaque analytics** (P&L assembled manually at month-end).
3. **Regulatory fines** for late foreign guest registration (E-Mehmon) or missing fiscal receipts.

---

> **🏆 Award Submission & Architecture Showcase**  
> *This repository contains the architecture specification, TypeScript domain contracts, complete monorepo directory tree (899 files), and sample module implementations for award review.*  
> *Full proprietary binary builds and production secrets remain strictly protected.*

---

## 🏛️ Core Architectural Invariants

1. **Guest-Centric Single Source of Truth**:
   `Organization → Property → Guest → Reservation → Stay → Folio → Charge → Payment → Document`. Every fact exists once; modules reference, never copy.
2. **Unified Folio**:
   Every charge from any outlet (F&B POS, SPA, Rentals, Room Service) lands on a unified guest folio in real time and cannot be lost.
3. **Offline-First Resilience**:
   Front-desk and cash register operations keep working during internet outages (essential for mountain/rural resorts). SQLite acts as the offline edge store with automatic replay upon reconnection.
4. **Telegram & Messenger First**:
   Messengers (Telegram, WhatsApp) are the primary guest interaction channel, powered by an integrated AI Concierge.
5. **Government & Fiscal Compliance**:
   E-Mehmon registration, OFD fiscalization (Soliq QR receipts), Faktura.uz electronic invoices (ESF), and local data residency are built behind swappable adapters.
6. **Role-Scoped AI Copilot (`Atlas AI`)**:
   In-product AI chief-of-staff with function calling. Dynamic prompt language matching automatically responds in the language spoken by the user (Uzbek, Russian, English).
7. **RBAC & Immutable Audit Trail**:
   11 code-defined roles with least privilege access and append-only audit logging on every financial, PII, or privileged action.

---

## 🛠️ Stack & Monorepo Layout

```
atlas-suite/
├── packages/
│   ├── backend/         # NestJS 11 + Prisma ORM (SQLite DB-per-tenant) + AI Services + Offline Sync
│   ├── web/             # React 19 + Vite + TypeScript + TailwindCSS + Radix/shadcn UI
│   ├── mobile/          # Expo React Native guest app & NFC key reader
│   └── landing/         # Marketing landing page & product showcase
├── ARCHITECTURE.md      # System architecture reference & multi-tenant security model
└── PROJECT_TREE.md      # Complete file directory listing of all 899 codebase files
```

### Backend Domain Modules
`auth`, `database`, `audit`, `events`, `bootstrap`, `hotels`, `rooms`, `reservations`, `stays`, `payments`, `pricing`, `guests`, `crm`, `emehmon`, `companies`, `groups`, `tapechart`, `operations` (housekeeping, maintenance, tasks, night audit), `outlets` (F&B POS), `spa`, `rentals`, `reputation`, `marketing`, `inbox`, `assistant` (Atlas AI), `concierge`, `offline`, `stats`.

### Frontend Web Screens
Dashboard, Front Office (TapeChart / шахматка), Daily Ops, Check-in / Check-out, New Reservation, Guests, CRM, Groups (MICE), Revenue AI Cockpit, F&B Menu POS, SPA Services, Property Guide, Night Audit, Staff & RBAC, Integrations, Settings.

---

## 🤖 Role-Gated AI Copilot (`Atlas AI`)

Atlas AI acts as a digital chief-of-staff leaning over the desk:

- **Grounded Tool Execution**: Atlas cannot guess or invent figures. It must execute tools against the live tenant database before returning quantitative data.
- **Multilingual Adaptation**: Responds in whatever language the staff member uses (Uzbek, Russian, English), regardless of the UI chrome language setting.
- **Role-Scoped Access**: Enforces role boundaries (`owner`, `gm`, `front_desk`, `housekeeping`, `finance`, `outlet`, `sales`, `revenue`, `marketing`, `maintenance`, `reservations`).

---

## 📋 11 Core Role Identities

| Role | Target Persona | Primary Focus |
|---|---|---|
| `owner` | Owner / Investor | Big-picture occupancy, revenue, cross-department risks, P&L |
| `gm` | General Manager | Operational overview, arrivals, departures, guest issues, staff |
| `front_desk` | Front Desk / Reception | Arrivals, departures, room availability, guest check-in, folios |
| `housekeeping` | Housekeeping Supervisor | Room cleanliness board, maid assignments, turnover priority |
| `maintenance` | Chief Engineer | Technical work orders, ticket SLA, room maintenance blocks |
| `finance` | Finance / Cashier | Cash register, open balances, folios, payment approvals, fiscal slips |
| `outlet` | F&B / Room Service | POS orders, kitchen tickets, table reservations, room delivery |
| `sales` | Sales & Corporate | B2B deals, corporate accounts, group blocks, proposals |
| `revenue` | Revenue Manager | Occupancy, ADR, RevPAR, dynamic pricing, rate plan rules |
| `marketing` | Marketing Manager | Guest lifecycle, lead conversion, automated campaigns, public reviews |
| `reservations` | Reservations Desk | Pre-arrival pipeline, deposit cutoffs, waitlist management |

---

## 🗺️ Roadmap & Phase Progression

- **Phase A / Foundation**: Organization → Property multi-tenancy, DB-per-org routing, JWT + RBAC (11 roles), immutable audit logging, event backbone, Unified Folio, Stay lifecycle.
- **Phase 1 (Core PMS)**: TapeChart room grid with drag-and-drop, E-Mehmon automatic queue, Guest Digital Twin, Rate plans with MLOS/CTA restrictions, Group MICE booking, AI Dynamic Pricing.
- **Phase 2 (Fiscal & Cash)**: OFD fiscal receipts, Payme / Click / Uzum payment gateways, Offline cashier queue and auto-replay.
- **Phase 3 (AI & Revenue)**: Revenue Cockpit, DeepSeek AI pricing advisor, Channex Channel Manager integration, Booking Engine.
- **Phase 4 (Guest Experience)**: Unified Messenger Inbox, Telegram AI Concierge, Reputation review sentiment analyzer.
- **Phase 5 (Outlets & Resort OS)**: F&B POS catalog with IKPU/VAT/Images, SPA master & cabinet scheduling, Equipment rental engine.

---

## 📄 License & Repository Notice

This repository presents the architecture definition, domain models, TypeScript interfaces, and representative code contracts for **Atlas Suite** for award evaluation purposes.

*Copyright © 2026 Atlas Suite. All rights reserved.*