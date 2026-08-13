# Atlas Suite — Architecture Reference

## 1. High-Level Overview

**Atlas Suite** is a **Property Management System (PMS)** for independent resorts and boutique hotels in Uzbekistan (20–200 units). Deployed as a monorepo with two packages:

```
hotelpms/
├── packages/backend/    # NestJS 11 + Prisma 6 (SQLite) — REST API
├── packages/web/       # React 18 + Vite + Tailwind 4 + Radix/shadcn UI — SPA
└── (root)              # README.md, ARCHITECTURE.md, build plans
```

## 2. Backend Architecture (`packages/backend/`)

### 2.1 Stack
| Layer | Technology |
|-------|-----------|
| Framework | NestJS 11 |
| ORM | Prisma 6 (SQLite) |
| Auth | bcryptjs + JWT (12h expiry) |
| Events | `@nestjs/event-emitter` |
| Guards | JwtAuthGuard → RolesGuard → PermissionsGuard (chained) |
| Validation | class-validator + class-transformer (global `ValidationPipe`) |

### 2.2 Multi-Tenancy (Critical!)

The system uses **one SQLite database per organization**:

```
prisma/
├── schema.prisma        # Canonical schema model
├── schema.sql           # SQL dump → used to provision new tenant DBs
├── control.db           # Control-plane: Organization, Property, User, AuditLog
├── migrations/          # Prisma migration history
└── tenants/
    └── <orgId>.db       # One per organization (lazily provisioned)
```

- **`PrismaService`** → routes queries to the **tenant DB** (operational data)
- **`ControlPrismaService`** → queries the **control DB** (registry data)
- **`TenantMiddleware`** → reads JWT → extracts org ID → sets `AsyncLocalStorage` context → tenant routing

**Schema change workflow** (must do both):
1. `npx prisma migrate dev --name <x>`
2. `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/schema.sql`

### 2.3 Authentication & Authorization

**3-layered guard chain** (applied globally via `APP_GUARD`):
1. `JwtAuthGuard` — validates Bearer JWT token (skipped on `@Public()` routes)
2. `RolesGuard` — checks legacy role (`@Roles('gm','owner')`)
3. `PermissionsGuard` — checks new Lego-style permissions from `AccessRole`/`PermissionGrant`

**8 built-in roles**: `owner`, `gm`, `front_desk`, `housekeeping`, `finance`, `outlet`, `sales`, `maintenance`

**Lego Access Builder** (custom roles): `AccessRole` → `PermissionGrant` → `AccessPolicy` + `RoleInheritance`. Configurable per-organization.

### 2.4 Data Model (Core Entity Chain)

```
Organization → Property → Guest → Reservation → Stay → Room → Folio (→ Charge, Payment)
```

Key entities:
- **Organization** — top-level tenant (has `piiRegistryId`, `dataResidency` for P12.1 compliance)
- **Property** (mapped to `Hotel`) — each hotel property with config (check-in/out times, integrations, approval limits)
- **Room** — physical unit with status, housekeeping status, capacity
- **Guest** — digital twin with PII consent tracking, preferences, tags, RFM analytics
- **Reservation** — booking with source (manual, OTA, booking engine, telegram), group block membership, multi-guest support
- **Stay** — actual room occupancy (Reservation → multiple Stays for multi-room bookings)
- **Folio** — unified financial accumulator (guest or group master), holds Charges + Payments
- **Charge** — any financial transaction (lodging, F&B, spa, rental, etc.)
- **Payment** — payment with method, status, linked to Receipt (fiscal)
- **Document** — invoices, acts, ESF (faktura.uz), contracts — polymorphic via `type` field

### 2.5 Backend Module Map (40+ modules)

| Module | Purpose |
|--------|---------|
| `auth` | Login, JWT, 2FA (TOTP), role decorators/guards |
| `database` | Multi-tenancy: control Prisma, tenant client manager, middleware |
| `hotels` | Property CRUD, configuration |
| `rooms` | Room CRUD, status management |
| `guests` | Guest digital twin, PII consent |
| `reservations` | Booking CRUD, availability |
| `stays` | Stay entity, check-in/out logic |
| `payments` | Payment processing, reconcilliation |
| `pricing` | Rate plans, BAR, derived rates, promos, AI dynamic pricing (DeepSeek) |
| `tapechart` | Room grid (шахматка) — drag-move, blocks, OOO, rate hints |
| `groups` | Group/MICE bookings, rooming lists with GroupBlock |
| `companies` | Corporate clients, contacts, receivables |
| `crm` | Marketing campaigns, RFM segmentation, templates |
| `operations` | Housekeeping, maintenance, tasks, night audit, daily ops |
| `emehmon` | Foreigner registration gateway (mock adapter) |
| `channel-manager` | Channex adapter, rate/availability sync, mapping |
| `booking-engine` | Direct booking widget API |
| `telegram` | Bot integration, messaging |
| `inbox` | Unified inbox (multi-channel messaging) |
| `notifications` | In-app notifications + Telegram/SMS delivery |
| `analytics` | Revenue analytics, guest analytics, marketing analytics |
| `finance` | Financial close (1C integration), reporting |
| `compliance` | Backup management, restore testing, P12.1 compliance |
| `approvals` | Above-limit action approval workflow |
| `antifraud` | Fraud detection |
| `wristband` | QR/RFID wristband for cashless spending |
| `prediction` | AI risk prediction |
| `corporate` | Corporate CRM |
| `mice` | MICE event management (canvas, costs, scheduling) |
| `proposals` | Auto-generated proposals (multi-lang, digital signing) |
| `outlets` | F&B outlet management (orders, fiscalization) |
| `spa` | Spa scheduling, therapist/treatment management |
| `rentals` | Equipment rental catalog + bookings |
| `upsell` | AI upsell propensity scoring |
| `offline` | Offline action queue + sync for disconnected operation |
| `portfolio` | Multi-property portfolio (owner view) |
| `owner` | Owner dashboard data |
| `reputation` | Platform review management, AI reply drafting |
| `marketing` | Marketing scenarios, automation triggers |
| `leads` | Lead management pipeline |
| `deals` | Deal pipeline with stages, probability |
| `events` | Event emitter backbone |
| `audit` | Immutable audit log (append-only) |
| `bootstrap` | Seed data, demo setup |
| `dbops` | Database operations, migration management |
| `access` | Lego access builder (custom permissions) |
| `workspace` | Shift-based operational workspace (widgets, layouts) |
| `concierge` | AI concierge service |
| `documents` | Document generation/management |
| `onboarding` | Property onboarding wizard |
| `payme` | Payme payment gateway integration |
| `stats` | Statistics snapshots |
| `revenue` | Revenue management, AI pricing recommendations |

### 2.6 Key Design Patterns

- **Per-domain module**: Each feature follows NestJS `Module → Controller → Service` pattern with DTOs
- **Event-driven**: `EventEmitterModule` — each step emits events triggering next steps
- **Offline-first**: `OfflineAction` queue + `SyncLog` journal; SQLite edge store
- **Compliance adapters**: E-Mehmon, OFD fiscalization, faktura.uz ESF — all behind swappable adapters (currently mocked)

## 3. Frontend Architecture (`packages/web/`)

### 3.1 Stack
| Layer | Technology |
|-------|-----------|
| Framework | React 18 |
| Build | Vite 6 |
| Styling | Tailwind CSS 4 |
| UI Kit | Radix UI primitives + shadcn/ui components |
| Icons | lucide-react |
| i18n | Custom typed translations (RU + EN) |
| Auth | JWT stored in localStorage, `auth.tsx` context |

### 3.2 Frontend Structure
```
src/
├── main.tsx              # Entry point
├── App.tsx               # Hub-based nav + routing (722 lines)
├── api.ts                # API client (~2500 lines, all endpoints typed)
├── auth.tsx              # Auth context/provider
├── theme.tsx             # Theme provider (dark/light)
├── index.css             # Global styles
├── vite-env.d.ts         # Type declarations
├── components/           # Reusable UI components
│   ├── ui/               # shadcn primitives (button, dialog, input, etc.)
│   ├── AlertsBell.tsx
│   ├── BookingCardPopover.tsx
│   ├── BookingWidget.tsx
│   ├── Combobox.tsx
│   ├── CommandPalette.tsx
│   ├── ContextMenu.tsx
│   ├── EmptyState.tsx
│   ├── LanguageToggle.tsx
│   ├── Logo.tsx
│   ├── ReservationPanel.tsx
│   ├── SkeletonRows.tsx
│   ├── StatusDot.tsx
│   └── ThemeToggle.tsx
├── i18n/                 # Internationalization
│   ├── index.tsx
│   └── translations.ts  # Typed RU + EN keys
├── lib/                  # Utilities
│   ├── emehmon.ts
│   ├── labels.ts
│   ├── permissions.ts   # Nav permission checks
│   └── utils.ts         # cn() helper
└── screens/              # 50+ screen pages
    ├── Login.tsx
    ├── Dashboard.tsx
    ├── FrontDesk.tsx
    ├── TapeChart.tsx
    ├── Rooms.tsx
    ├── Guests.tsx
    ├── ...               # One per backend module
    └── AccessBuilder.tsx
```

### 3.3 Navigation Architecture

Hub-based sidebar navigation (not a flat list of routes):
- **Rail** (leftmost) — icon-only hub groups: Front Office, Housekeeping, Revenue, Sales, F&B, SPA & Wellness, Rentals, Marketing, Analytics, System, Finance
- **Hub panel** (second column) — screen buttons for selected hub
- **User** — top-right: hotel selector, theme toggle, language toggle, alerts bell, user menu

Navigation hierarchy:
```
Departments → Front Office → Front Desk, New Reservation, Tape Chart, Rooms, Daily Ops, Guests, Groups, Wristband, Approvals
Departments → Housekeeping → Housekeeping, HK Supervisor, Maintenance, Tasks
Departments → Revenue → Revenue, Pricing, Upsell, Recovery Engine
Departments → Sales → CRM, Leads, Deals, Corporate, MICE, Proposals
Departments → F&B → Outlets
Departments → SPA → SPA Scheduler
Departments → Rentals → Rental Catalog
Marketing → Marketing, Marketing Analytics, Reputation
Analytics → Stats, Guest Analytics, Revenue Dashboard
System → Staff, Hotel Settings, Onboarding, Integrations, Compliance, DBOps, Notifications, Access Builder
Finance → Finance Close, Night Audit, Sync Center
General → Housekeeping Dashboard, Front Office Dashboard, Antifraud, Inbox, Owner Dashboard, Portfolio, Recovery Engine, Tasks
```

## 4. Data Flow

```
User Action → React Screen → api.ts (fetch) → Backend Controller → Service → PrismaService → SQLite
                                                                                         ↓
                                                                                    EventEmitter
                                                                                         ↓
                                                                               Event handlers (compliance,
                                                                               notifications, sync, etc.)
```

## 5. Compliance & Security (P12.1)

- **Data residency**: Organization stores `dataResidency`, `backupResidency`, `piiRegistryId`
- **PII consent**: Guest has `pdnConsent`, `consentAt`, `consentSource`, `anonymizedAt` (right-to-erasure)
- **Audit**: `AuditLog` on every privileged/financial/PII action (immutable)
- **Backups**: `BackupRun` + `RestoreTest` tables, geo-replica tracking
- **Approval chains**: `ApprovalRule` (per-trigger thresholds + approver roles) + `ApprovalRequest`
- **RBAC**: Lego access builder with `AccessRole` → `PermissionGrant` → `AccessPolicy` + `RoleInheritance`

## 6. Offline & Sync

- `OfflineAction` queue captures operations when disconnected
- `SyncLog` journals replay outcomes on reconnect
- Designed for mountain resorts with unreliable internet

## 7. Integrations (Swappable Adapters)

| Integration | Status |
|-------------|--------|
| E-Mehmon (foreigner registration) | Mock adapter |
| OFD fiscalization (receipt QR) | Mock adapter |
| faktura.uz ESF (VAT invoices) | Mock adapter |
| Payme payment gateway | Module exists |
| Channex channel manager | Adapter exists |
| DeepSeek AI pricing | Active (or heuristic fallback) |
| Telegram bot | Active |
| 1C accounting | Configurable |
| Passport OCR | Mock adapter |

## 8. Key Conventions

- **Module naming**: Files follow `<name>.controller.ts`, `<name>.service.ts`, `<name>.dto.ts`, `<name>.module.ts`
- **Prisma Service**: Operational data → `PrismaService` (auto-routes to tenant DB)
- **Control Prisma Service**: Registry data → `ControlPrismaService` (control DB)
- **DTOs**: Validation via `class-validator` decorators
- **Permissions**: `NavKey` type + `canAccess()` function in `lib/permissions.ts`
- **i18n**: Every translation key must exist in BOTH `ru` and `en` (build fails otherwise)
- **Build**: `npm run build` must pass in both packages before commit