import { Controller, Get, Param } from "@nestjs/common";
import { DriverQrService } from "./driver-qr.service";

@Controller("driver-qr")
export class DriverQrPublicController {
  constructor(private readonly qr: DriverQrService) {}

  @Get("resolve/:publicIdentifier")
  resolve(@Param("publicIdentifier") publicIdentifier: string) {
    return this.qr.resolve(publicIdentifier);
  }
}
