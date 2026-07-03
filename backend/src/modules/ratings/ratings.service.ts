import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { RateCustomerDto, RateVendorDto } from './ratings.dto';

/** KPI-based weighted rating. Weights live in settings so the business can retune them anytime. */
@Injectable()
export class RatingsService {
  constructor(private prisma: PrismaService, private settings: SettingsService) {}

  private weighted(scores: Record<string, number>, weights: Record<string, number>): number {
    let sum = 0;
    let weightSum = 0;
    for (const [key, score] of Object.entries(scores)) {
      const w = Number(weights[key] ?? 0);
      sum += score * w;
      weightSum += w;
    }
    return weightSum > 0 ? Math.round((sum / weightSum) * 100) / 100 : 0;
  }

  async rateVendor(dto: RateVendorDto, userId?: string) {
    const weights = await this.settings.get('rating.vendor.weights', {
      price: 25, serviceQuality: 20, communication: 10, deliveryPerformance: 20, reliability: 15, responseSpeed: 10,
    });
    const { vendorId, comment, ...scores } = dto;
    const overallScore = this.weighted(scores, weights);
    return this.prisma.vendorRating.create({ data: { vendorId, comment, ...scores, overallScore, ratedById: userId } });
  }

  async rateCustomer(dto: RateCustomerDto, userId?: string) {
    const weights = await this.settings.get('rating.customer.weights', {
      paymentSpeed: 25, profitability: 25, repeatBusiness: 15, communication: 10, complaintHistory: 10, businessPotential: 15,
    });
    const { customerId, comment, ...scores } = dto;
    const overallScore = this.weighted(scores, weights);
    return this.prisma.customerRating.create({ data: { customerId, comment, ...scores, overallScore, ratedById: userId } });
  }

  vendorRatings(vendorId: string) {
    return this.prisma.vendorRating.findMany({ where: { vendorId }, orderBy: { createdAt: 'desc' }, include: { ratedBy: { select: { fullName: true } } } });
  }

  customerRatings(customerId: string) {
    return this.prisma.customerRating.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, include: { ratedBy: { select: { fullName: true } } } });
  }
}
