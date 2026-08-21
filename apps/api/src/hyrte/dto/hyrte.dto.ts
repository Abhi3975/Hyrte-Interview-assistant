import { IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import {
  Difficulty,
  EvidenceLinkKind,
  EvidenceSource,
  EvidenceType,
  HiringOutcomeEventType,
  HyrteSessionType,
  PerformanceRating,
  WorkItemStage,
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
  // Refinements doc §3 — CC on reply: real, not cosmetic — each CC'd
  // stakeholder gets a genuine chance to respond via the same agent
  // pipeline as the primary recipient.
  @IsOptional() @IsArray() @IsString({ each: true }) ccStakeholderIds?: string[];
}

export class ForwardInboxDto {
  @IsString() toStakeholderId!: string;
  @IsOptional() @IsString() note?: string;
}

export class FlagInboxDto {
  @IsOptional() @IsBoolean() flagged?: boolean;
}

export class ArchiveInboxDto {
  @IsOptional() @IsBoolean() archived?: boolean;
}

export class AddInboxNoteDto {
  @IsString() text!: string;
}

export class ScheduleReminderDto {
  @IsOptional() @IsDateString() remindAt?: string;
}

export class SendSlackMessageDto {
  @IsString() channel!: string;
  @IsString() body!: string;
}

export class SendMeetingMessageDto {
  @IsString() body!: string;
}

export class UpdateWorkItemDto {
  @IsOptional() @IsEnum(WorkItemStage) stage?: WorkItemStage;
}

// Master Build Prompt Part F6 — Command bar pipeline.
export class CommandBarDto {
  @IsString() instruction!: string;
}

// Master Build Prompt Part F5 — Needs Review, both directions.
export class WorkItemReviewDto {
  @IsIn(['approve', 'request_changes', 'reject', 'reassign']) decision!: 'approve' | 'request_changes' | 'reject' | 'reassign';
  @IsOptional() @IsString() note?: string;
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
  // Optional — recruiter doc §1: a recruiter can define an assessment from
  // customRequirements alone, no full JD paste required.
  @IsOptional() @IsString() jobDescriptionText?: string;
  @IsOptional() @IsString() companyContext?: string;
  // Recruiter doc §1 "Recruiter Custom Questions" — free-text business
  // requirements, each converted into a real embedded scenario, never
  // literal question text (see SimulationGeneratorService.groundingNote).
  @IsOptional() @IsArray() @IsString({ each: true }) customRequirements?: string[];
}

class CapabilityRequirementDto {
  @IsString() skill!: string;
  @IsString() importance!: string;
  @IsOptional() @IsString() depth?: string;
}

export class CreateSimulationRequestDto {
  @IsOptional() @IsString() jobDescriptionText?: string;
  @IsOptional() @IsString() companyContext?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) customRequirements?: string[];

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
