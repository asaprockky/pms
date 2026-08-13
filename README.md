# Atlas Suite — Operating System for Independent Resorts & Boutique Hotels

> **Award Submission & Architecture Showcase**  
> *This repository contains the architecture spec, TypeScript domain contracts, complete directory structure, and sample module implementations for Atlas Suite.*

---

## Overview

**Atlas Suite** is an all-in-one Property Management System (PMS) and operating OS built specifically for independent resorts, park-hotels, and boutique properties in Central Asia (20–200 lodging units: rooms, cottages, villas, yurts, tents, capsules).

Unlike traditional hotel software designed only for room sales, Atlas Suite treats a resort as a **mini-city**: revenue comes from rooms, restaurants, bars, SPA, equipment rentals (ATVs, SUP boards, skis), banquets, transfers, and activities.

---

## Core Capabilities

1. **Role-Gated AI Chief-of-Staff (`Atlas AI`)**:
   - In-product copilot with function-calling capabilities.
   - Dynamic prompt language matching — replies in whatever language the staff member speaks (Uzbek, Russian, English).
   - Grounded tool execution (only reports real DB state, never invents figures).

2. **Telegram AI Concierge**:
   - Automated guest assistant running 24/7 on Telegram.
   - Handles room service orders, SPA bookings, late check-out requests, and local recommendations.

3. **Multi-Outlet F&B POS & SPA Management**:
   - Fiscal-ready F&B menu with IKPU codes, VAT rates, halal tags, descriptions, and high-res imagery.
   - SPA scheduling: masters, shifts, cabinet assignments, treatments, and duration buffers.

4. **Offline-First Cashier & Sync Engine**:
   - Dedicated local queue for front-desk operations during internet outages.
   - Automatically replays transactions and issues fiscal receipts upon reconnection.

5. **Government Compliance & E-Mehmon Integration**:
   - Automated guest registration submission for foreign and domestic travellers with regulatory audit trails.

6. **Dynamic Pricing & Revenue Management**:
   - AI-assisted demand forecasting, rate plan multipliers, and automated recommendation signals.

---

## Monorepo Structure

```
atlas-suite/
├── packages/
│   ├── backend/         # NestJS 11 + Prisma ORM + AI Services + Offline Sync
│   ├── web/             # React 19 + Vite + TailwindCSS + Glassmorphic UI
│   ├── mobile/          # Expo React Native guest app & NFC door key reader
│   └── landing/         # Marketing landing page & product showcase
├── ARCHITECTURE.md      # System architecture reference & security model
└── PROJECT_TREE.md      # Complete file directory listing of the codebase
```

---

## Technology Stack

- **Backend**: NestJS, TypeScript, Prisma ORM, SQLite (Multi-tenant isolated DB per tenant), DeepSeek AI / Gemini API, EventEmitter2.
- **Frontend**: React 19, Vite, Lucide Icons, Sonner toasts, Vanilla CSS / Tailwind design tokens.
- **Mobile**: Expo, React Native, NFC & QR reader integrations.
- **Compliance & Payments**: E-Mehmon (Uzbekistan Tourism Board), Payme, Soliq OFD fiscalization.

---

## Repository Notice

*This repository is created for award review purposes to showcase the system design, API contracts, TypeScript definitions, and module implementations of Atlas Suite without distributing production database keys or proprietary business assets.*