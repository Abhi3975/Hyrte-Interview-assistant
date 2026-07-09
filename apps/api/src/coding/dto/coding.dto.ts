import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class RunCodeDto {
  @IsString() sessionId!: string;
  @IsString() questionId!: string;
  @IsString() language!: string;
  @IsString() code!: string;
  // run = sample tests only (no persistence); submit = all tests + graded.
  @IsOptional() @IsBoolean() submit?: boolean;
}
