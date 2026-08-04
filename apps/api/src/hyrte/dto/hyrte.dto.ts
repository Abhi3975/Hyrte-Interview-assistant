import { IsArray, IsBoolean, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import {
  Difficulty,
  EvidenceLinkKind,
  EvidenceSource,
  EvidenceType,
  HiringOutcomeEventType,
  HyrteSessionType,
  PerformanceRating,
} from '@prisma/client';

export class CreateHyrteSessionDto {
  @IsString() role!: string;
  @IsString() experienceLevel!: string;
  @IsString() industry!: string;
  @IsString() companyType!: string;
  @IsEnum(Difficulty) difficulty!: Difficulty;
  @IsString() culture!: string;
  @IsOptional() @IsEnum(HyrteSessionType) sessionType?: HyrteSessionType;
}

export class ReplyInboxDto {
  @IsString() body!: string;
}

export class SendSlackMessageDto {
  @IsString() channel!: string;
  @IsString() body!: string;
}

export class UpdateTaskDto {
  @IsOptional() @IsString() status?: string;
}

export class MarkInboxReadDto {
  @IsOptional() @IsBoolean() read?: boolean;
}

export class InterviewTurnDto {
  @IsString() message!: string;
}

export class StartInterviewDto {
  /** §5.9 Boss Level — explicit opt-in only, never defaulted on. */
  @IsOptional() @IsBoolean() bossMode?: boolean;
}

export class AskDecisionCortexDto {
  @IsString() question!: string;
}

export class RecordHiringOutcomeDto {
  @IsEnum(HiringOutcomeEventType) eventType!: HiringOutcomeEventType;
  @IsOptional() @IsEnum(PerformanceRating) performanceRating?: PerformanceRating;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
}

export class CreateEvidenceDto {
  @IsEnum(EvidenceSource) source!: EvidenceSource;
  @IsEnum(EvidenceType) type!: EvidenceType;
  @IsString() rawText!: string;
  @IsOptional() @IsBoolean() needsInvestigation?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) probeCandidates?: string[];
}

export class IngestResumeDto {
  @IsString() resumeText!: string;
}

export class IngestLinkedInDto {
  @IsString() linkedinSummary!: string;
}

export class IngestGitHubDto {
  @IsString() username!: string;
}

export class IngestJobDescriptionDto {
  @IsString() jobDescriptionText!: string;
  @IsOptional() @IsString() companyContext?: string;
  @IsOptional() @IsString() sessionId?: string;
}

export class LinkEvidenceDto {
  @IsString() toId!: string;
  @IsEnum(EvidenceLinkKind) kind!: EvidenceLinkKind;
  @IsOptional() @IsString() note?: string;
}

export class SubmitBaselineChallengeDto {
  @IsString() optionId!: string;
  @IsString() reasoning!: string;
  @IsString() roleKnowledgeAnswer!: string;
  @IsString() toolsAnswer!: string;
}

// Upgrade §1 — entry point. Preview never persists; create does, with
// whatever the recruiter ended up with after reviewing the preview
// (defaults or edited).
export class PreviewSimulationRequestDto {
  @IsString() jobDescriptionText!: string;
  @IsOptional() @IsString() companyContext?: string;
}

class CapabilityRequirementDto {
  @IsString() skill!: string;
  @IsString() importance!: string;
  @IsOptional() @IsString() depth?: string;
}

export class CreateSimulationRequestDto {
  @IsString() jobDescriptionText!: string;
  @IsOptional() @IsString() companyContext?: string;

  @IsString() role!: string;
  @IsArray() @IsString({ each: true }) coreOutcomes!: string[];
  @IsArray() capabilityRequirements!: CapabilityRequirementDto[];
  @IsArray() @IsString({ each: true }) industryProbeThemes!: string[];

  @IsString() experienceLevel!: string;
  @IsString() industry!: string;
  @IsString() companyType!: string;
  @IsEnum(Difficulty) difficulty!: Difficulty;
  @IsString() culture!: string;
}
