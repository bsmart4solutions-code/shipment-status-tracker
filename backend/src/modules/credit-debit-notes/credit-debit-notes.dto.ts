import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsPositive,
  IsString, IsUUID, Min, ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

// The global ValidationPipe runs with forbidNonWhitelisted, so list filters
// must be declared on the DTO — extra @Query() params would be rejected.
export class ListNotesDto extends PaginationDto {
  @IsOptional() @IsIn(['CREDIT', 'DEBIT']) type?: 'CREDIT' | 'DEBIT';
  @IsOptional() @IsIn(['DRAFT', 'ISSUED', 'CANCELLED']) status?: string;
}

export class NoteItemDto {
  @IsString() description: string;
  @IsNumber() @Min(0) unitPrice: number;
  @IsOptional() @IsString() unit?: string;
  @IsNumber() @IsPositive() quantity: number;
  @IsOptional() @IsString() lineCurrency?: string;
  @IsOptional() @IsNumber() @IsPositive() fxRate?: number;
  @IsOptional() @IsBoolean() taxExempt?: boolean;
  @IsOptional() @IsString() accNo?: string;
}

export class CreateNoteDto {
  @IsIn(['CREDIT', 'DEBIT']) type: 'CREDIT' | 'DEBIT';
  // CREDIT requires an invoice; DEBIT may be standalone (customerId then required).
  @IsOptional() @IsUUID() invoiceId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsNumber() @Min(0) taxPct?: number;
  @IsString() reason: string; // mandatory business reason
  @IsOptional() @IsDateString() issueDate?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ArrayMinSize(1, { message: 'Add at least one line before saving the note' })
  @ValidateNested({ each: true }) @Type(() => NoteItemDto)
  items: NoteItemDto[];
}

export class UpdateNoteDto {
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsNumber() @Min(0) taxPct?: number;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsDateString() issueDate?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => NoteItemDto)
  items?: NoteItemDto[];
}
