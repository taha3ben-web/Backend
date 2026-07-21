import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import {
  FinalizeManagedAssetDto,
  PrepareManagedAssetDto,
  UpdateManagedAssetDto,
} from "./dto/managed-assets.dto";

@Injectable()
export class ManagedAssetsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async prepare(dto: PrepareManagedAssetDto) {
    if (!this.storage.isEnabled())
      throw new BadRequestException("File storage is not configured");
    const audience = dto.audience ?? "PASSENGER";
    const objectPath = `${this.prefix(audience, dto.key)}${Date.now()}.${this.ext(dto.contentType)}`;
    return {
      objectPath,
      uploadUrl: await this.storage.signedUploadUrl(
        objectPath,
        dto.contentType,
      ),
    };
  }

  async finalize(dto: FinalizeManagedAssetDto, userId: string) {
    const audience = dto.audience ?? "PASSENGER";
    if (!dto.objectPath.startsWith(this.prefix(audience, dto.key))) {
      throw new BadRequestException(
        "Object path does not match asset key and audience",
      );
    }
    const metadata = await this.storage.objectMetadata(dto.objectPath);
    if (metadata.contentType !== dto.contentType)
      throw new BadRequestException("Content type mismatch");
    if (metadata.bytes <= 0) throw new BadRequestException("Asset is empty");
    const etag =
      metadata.etag ||
      createHash("sha256")
        .update(`${dto.objectPath}:${metadata.bytes}`)
        .digest("hex");
    const old = await this.prisma.managedAsset.findUnique({
      where: { key: dto.key },
    });
    if (
      old?.etag === etag &&
      old.contentType === metadata.contentType &&
      old.isActive
    ) {
      if (old.objectPath !== dto.objectPath)
        await this.storage.delete(dto.objectPath).catch(() => undefined);
      return old;
    }
    const row = await this.prisma.managedAsset.upsert({
      where: { key: dto.key },
      create: {
        key: dto.key,
        kind: dto.kind,
        audience,
        objectPath: dto.objectPath,
        contentType: metadata.contentType,
        etag,
        bytes: metadata.bytes,
        width: dto.width,
        height: dto.height,
        createdById: userId,
        updatedById: userId,
      },
      update: {
        kind: dto.kind,
        audience,
        objectPath: dto.objectPath,
        contentType: metadata.contentType,
        etag,
        bytes: metadata.bytes,
        width: dto.width,
        height: dto.height,
        version: { increment: 1 },
        isActive: true,
        updatedById: userId,
      },
    });
    if (old && old.objectPath !== row.objectPath)
      await this.storage.delete(old.objectPath).catch(() => undefined);
    return row;
  }

  list() {
    return this.prisma.managedAsset.findMany({
      orderBy: [{ kind: "asc" }, { key: "asc" }],
    });
  }

  async update(id: string, dto: UpdateManagedAssetDto, userId: string) {
    const current = await this.prisma.managedAsset.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException("Asset not found");
    if (dto.isActive === undefined || dto.isActive === current.isActive)
      return current;
    return this.prisma.managedAsset.update({
      where: { id },
      data: {
        isActive: dto.isActive,
        version: { increment: 1 },
        updatedById: userId,
      },
    });
  }

  async manifest(base: string) {
    const rows = await this.prisma.managedAsset.findMany({
      where: { isActive: true, audience: { in: ["PASSENGER", "ALL"] } },
      orderBy: { key: "asc" },
    });
    const assets = rows.map((asset) => ({
      key: asset.key,
      kind: asset.kind,
      contentType: asset.contentType,
      version: asset.version,
      etag: asset.etag,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      url: `${base}/api/managed-assets/file/${encodeURIComponent(asset.key)}?v=${asset.version}`,
    }));
    const etag = createHash("sha256")
      .update(
        assets
          .map((asset) => `${asset.key}:${asset.version}:${asset.etag}`)
          .join("|"),
      )
      .digest("hex");
    return { etag, assets };
  }

  async file(key: string) {
    const asset = await this.prisma.managedAsset.findFirst({
      where: { key, isActive: true, audience: { in: ["PASSENGER", "ALL"] } },
    });
    if (!asset) throw new NotFoundException("Asset not found");
    return { ...asset, stream: this.storage.readStream(asset.objectPath) };
  }

  private prefix(audience: string, key: string) {
    return `mobile-assets/${audience}/${key}/`;
  }
  private ext(type: string) {
    const extensions: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/avif": "avif",
      "image/svg+xml": "svg",
      "application/json": "json",
      "model/gltf-binary": "glb",
    };
    const value = extensions[type];
    if (!value) throw new BadRequestException("Unsupported content type");
    return value;
  }
}
