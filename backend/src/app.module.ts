import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './common/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { CustomersModule } from './modules/customers/customers.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { ServicesCatalogModule } from './modules/services-catalog/services.module';
import { RatesModule } from './modules/rates/rates.module';
import { QuotationsModule } from './modules/quotations/quotations.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { FxModule } from './modules/fx/fx.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PnlModule } from './modules/pnl/pnl.module';
import { ReportsModule } from './modules/reports/reports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SettingsApiModule } from './modules/settings/settings.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { MetricsMiddleware } from './common/middleware/metrics.middleware';
import { CustomThrottlerGuard } from './common/guards/rate-limit.guard';
import { HealthModule } from './modules/health/health.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { CreditDebitNotesModule } from './modules/credit-debit-notes/credit-debit-notes.module';
import { RecycleBinModule } from './modules/recycle-bin/recycle-bin.module';
import { ImportsModule } from './modules/imports/imports.module';
import { DocumentsModule } from './modules/documents/documents.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Single default throttler: 100 req/min per IP for every route.
    // Stricter limits are set per-route via @Throttle (e.g. auth login:
    // 5 attempts / 15 min), and @SkipThrottle exempts health checks.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    CustomersModule,
    VendorsModule,
    ServicesCatalogModule,
    RatesModule,
    QuotationsModule,
    JobsModule,
    RatingsModule,
    FxModule,
    DashboardModule,
    PnlModule,
    ReportsModule,
    NotificationsModule,
    SettingsApiModule,
    HealthModule,
    InvoicesModule,
    CreditDebitNotesModule,
    RecycleBinModule,
    ImportsModule,
    DocumentsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // RequestContext first so IP/UA are available to everything downstream.
    consumer.apply(RequestContextMiddleware, RequestLoggerMiddleware, MetricsMiddleware).forRoutes('*');
  }
}
