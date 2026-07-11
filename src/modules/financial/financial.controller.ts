import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard"; import { RolesGuard } from "../../common/guards/roles.guard"; import { Roles } from "../../common/decorators/roles.decorator"; import { FinancialService } from "./financial.service";
@UseGuards(JwtAuthGuard, RolesGuard) @Roles("STAFF") @Controller("financial")
export class FinancialController { constructor(private readonly financial: FinancialService) {}
@Get("accounts") accounts(@Query("page") page="1", @Query("limit") limit="20", @Query("search") search?:string){ return this.financial.listAccounts(Math.max(1,Number(page)||1),Math.min(100,Math.max(1,Number(limit)||20)),search); }
@Get("transactions") transactions(@Query("page") page="1",@Query("limit") limit="20",@Query("status") status?: "PENDING"|"POSTED"|"FAILED"|"REVERSED"|"CANCELLED"){ return this.financial.listTransactions(Math.max(1,Number(page)||1),Math.min(100,Math.max(1,Number(limit)||20)),status); } }
