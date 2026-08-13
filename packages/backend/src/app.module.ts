import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { CommonModule } from './common/common.module';
import { TenantMiddleware } from './database/tenant.middleware';
import { RoomsModule } from './rooms/rooms.module';
import { GuestsModule } from './guests/guests.module';
import { ReservationsModule } from './reservations/reservations.module';
import { PaymentsModule } from './payments/payments.module';
import { PricingModule } from './pricing/pricing.module';
import { HotelsModule } from './hotels/hotels.module';
import { StatsModule } from './stats/stats.module';
import { CrmModule } from './crm/crm.module';
import { AuthModule } from './auth/auth.module';
import { OperationsModule } from './operations/operations.module';
import { TapeChartModule } from './tapechart/tapechart.module';
import { StaysModule } from './stays/stays.module';
import { EmehmonModule } from './emehmon/emehmon.module';
import { CompaniesModule } from './companies/companies.module';
import { GroupsModule } from './groups/groups.module';
import { DealsModule } from './deals/deals.module';
import { SalesModule } from './sales/sales.module';
import { RevenueModule } from './revenue/revenue.module';
import { RevenueExtModule } from './revenue-ext/revenue-ext.module';
import { AuditModule } from './audit/audit.module';
import { EventsModule } from './events/events.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { ChannelManagerModule } from './channel-manager/channel-manager.module';
import { BookingEngineModule } from './booking-engine/booking-engine.module';
import { LeadsModule } from './leads/leads.module';
import { MarketingModule } from './marketing/marketing.module';
import { TelegramModule } from './telegram/telegram.module';
import { PaymeModule } from './payme/payme.module';
import { ReputationModule } from './reputation/reputation.module';
import { InboxModule } from './inbox/inbox.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { FrontDeskModule } from './frontdesk/frontdesk.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { DocumentsModule } from './documents/documents.module';
import { AntifraudModule } from './antifraud/antifraud.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WristbandModule } from './wristband/wristband.module';
import { PredictionModule } from './prediction/prediction.module';
import { CorporateModule } from './corporate/corporate.module';
import { ProposalModule } from './proposals/proposal.module';
import { OutletModule } from './outlets/outlet.module';
import { RentalModule } from './rentals/rental.module';
import { GuestModule } from './guest/guest.module';
// Was never imported: P&L, reconciliation, night audit, 1C export and the
// day-close endpoint all 404'd, and Integrations.tsx's live 1C buttons with
// them. See PRODUCTION-READINESS.md §2.
import { FinanceModule } from './finance/finance.module';
// SpaModule existed but was never imported here, so every /api/spa/* route
// 404'd and the two SPA screens silently showed empty state.
import { SpaModule } from './spa/spa.module';
import { UpsellModule } from './upsell/upsell.module';
import { OwnerModule } from './owner/owner.module';
import { OfflineModule } from './offline/offline.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { ComplianceModule } from './compliance/compliance.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { DbOpsModule } from './dbops/dbops.module';
import { AccessModule } from './access/access.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { CardsModule } from './cards/cards.module';
import { AssistantModule } from './assistant/assistant.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { PermissionsGuard } from './access/permissions.guard';

const JWT_SECRET = process.env.ATLAS_JWT_SECRET ?? 'atlas-suite-dev-secret';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    JwtModule.register({ global: true, secret: JWT_SECRET, signOptions: { expiresIn: '12h' } }),
    CommonModule, DatabaseModule, AuditModule, EventsModule, BootstrapModule, HotelsModule, RoomsModule,
    GuestsModule, ReservationsModule, PaymentsModule, PricingModule, StatsModule, CrmModule,
    AuthModule, OperationsModule, TapeChartModule, StaysModule, EmehmonModule, CompaniesModule,
    GroupsModule, DealsModule, SalesModule, RevenueModule, RevenueExtModule, ChannelManagerModule, BookingEngineModule,
    LeadsModule, MarketingModule, TelegramModule, PaymeModule, ReputationModule, InboxModule,
    AnalyticsModule, FrontDeskModule, OnboardingModule, DocumentsModule, AntifraudModule,
    NotificationsModule, WristbandModule, PredictionModule, CorporateModule,
    ProposalModule, OutletModule, RentalModule, SpaModule, GuestModule, FinanceModule, UpsellModule, OwnerModule, OfflineModule, PortfolioModule,
    ComplianceModule, ApprovalsModule, DbOpsModule, AccessModule, WorkspaceModule, CardsModule,
    AssistantModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(TenantMiddleware).forRoutes('*'); }
}