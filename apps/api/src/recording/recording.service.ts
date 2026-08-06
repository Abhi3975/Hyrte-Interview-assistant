import { Injectable, Logger } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * P4 — session recording storage. Presigned S3 URLs both directions: the
 * candidate's browser PUTs the recorded blob directly to S3 (never routes
 * large binary data through this API server), and the recruiter's browser
 * GETs it directly too. This service never touches the actual video bytes.
 *
 * Gracefully degrades exactly like OtpService's smsConfigured()/
 * emailConfigured() — if RECORDINGS_S3_BUCKET isn't set, every method
 * returns null and callers skip recording/playback entirely rather than
 * erroring. The bucket itself (hyrte-recordings-<account>) is private,
 * SSE-S3 encrypted at rest, with a 90-day lifecycle expiry — provisioned
 * once, out of band, not something this code creates.
 */
@Injectable()
export class RecordingService {
  private readonly logger = new Logger(RecordingService.name);
  private readonly s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });

  configured(): boolean {
    return Boolean(process.env.RECORDINGS_S3_BUCKET);
  }

  private key(sessionId: string): string {
    return `recordings/${sessionId}.webm`;
  }

  /** The candidate's browser PUTs its recorded blob straight to this URL. */
  async getUploadUrl(sessionId: string): Promise<string | null> {
    if (!this.configured()) return null;
    try {
      const cmd = new PutObjectCommand({
        Bucket: process.env.RECORDINGS_S3_BUCKET!,
        Key: this.key(sessionId),
        ContentType: 'video/webm',
      });
      return await getSignedUrl(this.s3, cmd, { expiresIn: 3600 });
    } catch (e) {
      this.logger.warn(`getUploadUrl failed for ${sessionId}: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  /** The recruiter's browser GETs the recording directly from this URL — regenerated fresh each request, never a long-lived link. */
  async getPlaybackUrl(sessionId: string): Promise<string | null> {
    if (!this.configured()) return null;
    try {
      const cmd = new GetObjectCommand({ Bucket: process.env.RECORDINGS_S3_BUCKET!, Key: this.key(sessionId) });
      return await getSignedUrl(this.s3, cmd, { expiresIn: 3600 });
    } catch (e) {
      this.logger.warn(`getPlaybackUrl failed for ${sessionId}: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  /** The stable key persisted on InterviewSession.recordingUrl once upload succeeds — a key, not a URL, since presigned URLs expire. */
  recordingKey(sessionId: string): string {
    return this.key(sessionId);
  }
}
