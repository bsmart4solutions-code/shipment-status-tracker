import { Module } from '@nestjs/common';
import { RatesController } from './rates.controller';
import { RatesService } from './rates.service';
import { ExcelImporterService } from './excel-importer.service';

@Module({
  controllers: [RatesController],
  providers: [RatesService, ExcelImporterService],
  exports: [RatesService, ExcelImporterService],
})
export class RatesModule {}
