import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { ProctorEventType, ProctorSeverity } from '@prisma/client';

export class IngestEventDto {
  @IsString() sessionId!: string;
  @IsEnum(ProctorEventType) type!: ProctorEventType;
  @IsOptional() @IsEnum(ProctorSeverity) severity?: ProctorSeverity;
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
  @IsOptional() @IsString() evidenceUrl?: string;
  // "internal" | external proctor provider name
  @IsOptional() @IsString() provider?: string;
}

/** Batched ingestion for high-frequency client telemetry. */
export class IngestBatchDto {
  events!: IngestEventDto[];
}
