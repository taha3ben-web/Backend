import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { UpdateTranslationBundleDto, UpsertTranslationBundleDto } from "./dto/translations.dto";
@Injectable() export class TranslationsService {
 constructor(private readonly prisma: PrismaService) {}
 async publicBundle(locale:string, knownVersion?:number){
  const row=await this.prisma.translationBundle.findUnique({where:{locale:locale.toLowerCase()}});
  if(!row||!row.isActive) throw new NotFoundException("Translation bundle not found");
  if(knownVersion===row.version) return {locale:row.locale,version:row.version,notModified:true};
  return {locale:row.locale,version:row.version,notModified:false,messages:row.messages};
 }
 list(){return this.prisma.translationBundle.findMany({orderBy:{locale:"asc"}})}
 async upsert(dto:UpsertTranslationBundleDto,userId:string){return this.prisma.translationBundle.upsert({where:{locale:dto.locale.toLowerCase()},create:{locale:dto.locale.toLowerCase(),messages:dto.messages as Prisma.InputJsonValue,isActive:dto.isActive??true,createdById:userId,updatedById:userId},update:{messages:dto.messages as Prisma.InputJsonValue,isActive:dto.isActive,version:{increment:1},updatedById:userId}})}
 async update(id:string,dto:UpdateTranslationBundleDto,userId:string){const found=await this.prisma.translationBundle.findUnique({where:{id}});if(!found)throw new NotFoundException("Translation bundle not found");return this.prisma.translationBundle.update({where:{id},data:{messages:dto.messages as Prisma.InputJsonValue|undefined,isActive:dto.isActive,version:{increment:1},updatedById:userId}})}
}
