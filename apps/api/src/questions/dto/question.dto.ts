import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Category, Difficulty, QuestionType } from '@prisma/client';

export class SubmitQuestionDto {
  @IsString() title!: string;
  @IsString() prompt!: string;
  @IsEnum(Category) category!: Category;
  @IsString() topic!: string;
  @IsEnum(Difficulty) difficulty!: Difficulty;
  @IsEnum(QuestionType) type!: QuestionType;
  @IsOptional() @IsString() expectedAnswer?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsArray() followUps?: string[];
  // Submitter must affirm they grant HYRTE a license to use it.
  @IsOptional() licenseGranted?: boolean;
}

export class GenerateQuestionDto {
  @IsEnum(Category) category!: Category;
  @IsString() topic!: string;
  @IsEnum(Difficulty) difficulty!: Difficulty;
  @IsOptional() @IsEnum(QuestionType) type?: QuestionType;
  @IsOptional() @IsString() jobRole?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10) count?: number;
}

export class QuestionQueryDto {
  @IsOptional() @IsEnum(Category) category?: Category;
  @IsOptional() @IsEnum(Difficulty) difficulty?: Difficulty;
  @IsOptional() @IsString() topic?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) take?: number;
  @IsOptional() @IsInt() @Min(0) skip?: number;
}

export class ModerateQuestionDto {
  @IsEnum(['APPROVED', 'REJECTED'] as const) decision!: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() note?: string;
}

export class AggregateDto {
  @IsEnum(Category) category!: Category;
  @IsOptional() @IsInt() @Min(1) @Max(500) limit?: number;
  @IsOptional() generateVariations?: boolean;
}
