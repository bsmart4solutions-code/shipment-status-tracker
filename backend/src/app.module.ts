import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
})
export class AppModule {}
