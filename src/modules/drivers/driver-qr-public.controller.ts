import { Controller, Get, Param } from "@nestjs/common";
import { DriverQrService } from "./driver-qr.service";

import { Public } from "../../common/decorators/public.decorator";

// مسارات عامة مقصودة (الحارس العالمي يحمي كل ما عداها).
@Public()
@Controller("driver-qr")
export class DriverQrPublicController {
  constructor(private readonly qr: DriverQrService) {}

  @Get("resolve/:publicIdentifier")
  resolve(@Param("publicIdentifier") publicIdentifier: string) {
    return this.qr.resolve(publicIdentifier);
  }
}
