import { Injectable, NotFoundException } from '@nestjs/common';
import { FxService } from '../../common/fx.service';
import { PrismaService } from '../../common/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { evaluateCredit, effectiveLimit, CreditDecision } from './credit.logic';

export interface CustomerCreditView {
  customerId: string;
  customerName: string;
  baseCurrency: string;
  exposure: number;
  creditLimit: number | null;
  outstandingLimit: number | null;
  effectiveLimit: number | null;
  limitSource: CreditDecision['limitSource'];
  headroom: number | null;
  creditHold: boolean;
  /** Outcome for a hypothetical additional invoice (0 by default). */
  outcome: CreditDecision['outcome'];
  reason: CreditDecision['reason'];
  fxWarning: string | null;
}

/**
 * Customer credit standing (Sprint 04, P0-7).
 *
 * Exposure is NOT recalculated here — it is read from InvoicesService, the
 * single owner of "what does this customer owe us" (approved D-3). This
 * service only combines that figure with the customer's limits and runs the
 * pure decision logic.
 */
@Injectable()
export class CreditService {
  constructor(
    private prisma: PrismaService,
    private invoices: InvoicesService,
    private fx: FxService,
  ) {}

  /** Credit standing for one customer, optionally for a hypothetical invoice. */
  async creditFor(customerId: string, prospectiveInvoiceBase = 0): Promise<CustomerCreditView> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, companyName: true, creditLimit: true, outstandingLimit: true, creditHold: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const { exposure, fxWarning } = await this.invoices.customerExposure(customerId);
    const creditLimit = customer.creditLimit === null ? null : Number(customer.creditLimit);
    const outstandingLimit = customer.outstandingLimit === null ? null : Number(customer.outstandingLimit);

    const decision = evaluateCredit({
      exposure: fxWarning ? null : exposure,
      creditLimit,
      outstandingLimit,
      creditHold: customer.creditHold,
      newInvoiceBase: prospectiveInvoiceBase,
    });

    return {
      customerId: customer.id,
      customerName: customer.companyName,
      baseCurrency: this.fx.baseCurrency(),
      exposure: decision.exposure,
      creditLimit,
      outstandingLimit,
      effectiveLimit: decision.effectiveLimit,
      limitSource: decision.limitSource,
      headroom: decision.headroom,
      creditHold: customer.creditHold,
      outcome: decision.outcome,
      reason: decision.reason,
      fxWarning,
    };
  }

  /**
   * Dry-run report: every customer whose CURRENT exposure already exceeds their
   * effective limit, or who is on credit hold.
   *
   * This exists because the approved policy is a per-customer hard block with no
   * global switch — so the only safe way to enable enforcement is to see, first,
   * exactly who it would stop.
   */
  async overLimitReport() {
    const customers = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [{ creditHold: true }, { creditLimit: { not: null } }, { outstandingLimit: { not: null } }],
      },
      select: { id: true, code: true, companyName: true, creditLimit: true, outstandingLimit: true, creditHold: true },
    });
    if (!customers.length) {
      return { baseCurrency: this.fx.baseCurrency(), rows: [], totalAffected: 0, fxWarning: null };
    }

    const { exposures, fxWarning } = await this.invoices.customerExposures(customers.map((c) => c.id));

    const rows = customers.map((c) => {
      const creditLimit = c.creditLimit === null ? null : Number(c.creditLimit);
      const outstandingLimit = c.outstandingLimit === null ? null : Number(c.outstandingLimit);
      const { limit, source } = effectiveLimit(creditLimit, outstandingLimit);
      const exposure = exposures.get(c.id) ?? 0;
      const overBy = limit === null ? null : Math.round((exposure - limit) * 100) / 100;
      // A limit of exactly 0 is a real ceiling, so ANY invoice is refused —
      // but such a customer never shows as "over limit" (0 is not > 0). They
      // must still appear here, because the report exists to answer "who would
      // enforcement stop", not merely "who is over their limit".
      const zeroLimit = limit === 0;
      const overLimit = limit !== null && exposure > limit;
      const reason = c.creditHold ? 'CREDIT_HOLD' : overLimit ? 'OVER_LIMIT' : zeroLimit ? 'ZERO_LIMIT' : null;
      return {
        customerId: c.id,
        code: c.code,
        customerName: c.companyName,
        exposure,
        creditLimit,
        outstandingLimit,
        effectiveLimit: limit,
        limitSource: source,
        creditHold: c.creditHold,
        overBy,
        reason,
        // Would an invoice be refused today?
        wouldBlock: c.creditHold || overLimit || zeroLimit,
      };
    }).filter((r) => r.wouldBlock)
      .sort((a, b) => (b.overBy ?? 0) - (a.overBy ?? 0));

    return { baseCurrency: this.fx.baseCurrency(), rows, totalAffected: rows.length, fxWarning };
  }
}
