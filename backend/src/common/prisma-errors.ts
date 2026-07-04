import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Translate Prisma write errors into meaningful HTTP errors instead of
 * blanket-catching everything as "not found" (which masks FK violations
 * as missing records and turns data-integrity refusals into lies).
 *
 * - P2025: record does not exist            -> 404
 * - P2003: foreign key constraint violated  -> 409 with an actionable message
 */
export function rethrowPrisma(e: unknown, entity: string, conflictMessage?: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2025') throw new NotFoundException(`${entity} not found`);
    if (e.code === 'P2003') {
      throw new ConflictException(
        conflictMessage ?? `${entity} has related records and cannot be deleted — deactivate it instead`,
      );
    }
  }
  throw e;
}
