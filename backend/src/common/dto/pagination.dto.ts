import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize: number = 20;

  @IsOptional() @IsString()
  search?: string;
}

export function paged<T>(items: T[], total: number, dto: PaginationDto) {
  return { items, total, page: dto.page, pageSize: dto.pageSize, pageCount: Math.ceil(total / dto.pageSize) };
}
