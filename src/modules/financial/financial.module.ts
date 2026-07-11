import { Module } from "@nestjs/common";
import { FinancialService } from "./financial.service";

@Module({ providers: [FinancialService], exports: [FinancialService] })
export class FinancialModule {}
