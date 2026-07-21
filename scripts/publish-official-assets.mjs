import { Storage } from "@google-cloud/storage";
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { resolve } from "path";
const name = process.env.GCS_BUCKET;
if (!name) throw Error("GCS_BUCKET is required");
const bucket = new Storage(
    process.env.GCP_PROJECT_ID ? { projectId: process.env.GCP_PROJECT_ID } : {},
  ).bucket(name),
  prisma = new PrismaClient(),
  defs = [
    {
      key: "brand.logo.master",
      kind: "BRAND",
      file: "brand-master-logo.png",
      type: "image/png",
      width: 3712,
      height: 4512,
    },
    {
      key: "brand.logo.3d",
      kind: "BRAND",
      file: "brand-logo.glb",
      type: "model/gltf-binary",
    },
  ];
try {
  for (const d of defs) {
    const data = await readFile(resolve("official-assets", d.file)),
      hash = createHash("sha256").update(data).digest("hex"),
      objectPath = `mobile-assets/ALL/${d.key}/${hash}.${d.file.split(".").pop()}`;
    await bucket
      .file(objectPath)
      .save(data, {
        contentType: d.type,
        resumable: false,
        metadata: { cacheControl: "public,max-age=31536000,immutable" },
      });
    await prisma.managedAsset.upsert({
      where: { key: d.key },
      create: {
        key: d.key,
        kind: d.kind,
        audience: "ALL",
        objectPath,
        contentType: d.type,
        etag: hash,
        bytes: data.length,
        width: d.width,
        height: d.height,
      },
      update: {
        objectPath,
        contentType: d.type,
        etag: hash,
        bytes: data.length,
        width: d.width,
        height: d.height,
        version: { increment: 1 },
        isActive: true,
      },
    });
  }
} finally {
  await prisma.$disconnect();
}
