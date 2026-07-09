import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { Difficulty } from '@prisma/client';
import { ConversationTurn } from '../follow-up-engine.service';

export class NextTurnDto {
  @IsString() jobRole!: string;
  @IsString() category!: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsString() resumeSummary?: string;
  @IsOptional() @IsArray() skills?: string[];
  @IsOptional() @IsArray() projects?: string[];
  @IsArray() transcript!: ConversationTurn[];
  @IsEnum(Difficulty) currentDifficulty!: Difficulty;
  // If proctoring flagged something, the interviewer can address it politely.
  @IsOptional() @IsString() proctoringNotice?: string;
}

export class IntroDto {
  @IsString() jobRole!: string;
  @IsString() category!: string;
  @IsOptional() @IsString() language?: string;
}
