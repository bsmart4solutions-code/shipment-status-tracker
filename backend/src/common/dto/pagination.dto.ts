import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationDto {
  @IsOptional() @IsInt() @Min(1)
  page = 1;

  @IsOptional() @IsInt() @Min(1) @Max(200)
  pageSize = 20;

  @IsOptional() @IsString()
  search?: string;
}

export function paged<T>(items: T[], total: number, dto: PaginationDto) {
  return { items, total, page: dto.page, pageSize: dto.pageSize, pageCount: Math.ceil(total / dto.pageSize) };
}
