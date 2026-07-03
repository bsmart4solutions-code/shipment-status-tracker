import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RateCustomerDto, RateVendorDto } from './ratings.dto';
import { RatingsService } from './ratings.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('ratings')
export class RatingsController {
  constructor(private ratings: RatingsService) {}

  @Post('vendor') @RequirePermission('ratings.write')
  rateVendor(@Body() dto: RateVendorDto, @CurrentUser() user: { id: string }) {
    return this.ratings.rateVendor(dto, user.id);
  }

  @Post('customer') @RequirePermission('ratings.write')
  rateCustomer(@Body() dto: RateCustomerDto, @CurrentUser() user: { id: string }) {
    return this.ratings.rateCustomer(dto, user.id);
  }

  @Get('vendor/:vendorId') @RequirePermission('ratings.read')
  vendorRatings(@Param('vendorId') vendorId: string) { return this.ratings.vendorRatings(vendorId); }

  @Get('customer/:customerId') @RequirePermission('ratings.read')
  customerRatings(@Param('customerId') customerId: string) { return this.ratings.customerRatings(customerId); }
}
