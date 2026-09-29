import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import type { DatabaseExecutor } from '../../database/executor.js';
import { profilePhotos } from '../../database/schema.js';

export type ProfilePhotoRow = typeof profilePhotos.$inferSelect;

export interface NewProfilePhoto {
  userId: string;
  mediaType: string;
  sizeBytes: number;
  checksumSha256: string;
  content: Buffer;
}

@Injectable()
export class ProfilePhotosRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** One photo per user: uploading a new one replaces the old, it does not accumulate versions. */
  async upsert(
    photo: NewProfilePhoto,
    executor: DatabaseExecutor = this.database,
  ): Promise<ProfilePhotoRow> {
    const [row] = await executor
      .insert(profilePhotos)
      .values(photo)
      .onConflictDoUpdate({
        target: profilePhotos.userId,
        set: {
          mediaType: photo.mediaType,
          sizeBytes: photo.sizeBytes,
          checksumSha256: photo.checksumSha256,
          content: photo.content,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('Upsert of a profile photo returned no row');
    return row;
  }

  async find(userId: string): Promise<ProfilePhotoRow | null> {
    const [row] = await this.database
      .select()
      .from(profilePhotos)
      .where(eq(profilePhotos.userId, userId));
    return row ?? null;
  }

  /** Metadata without the bytes, so a user list can show who has a photo cheaply. */
  async exists(userId: string): Promise<boolean> {
    const [row] = await this.database
      .select({ userId: profilePhotos.userId })
      .from(profilePhotos)
      .where(eq(profilePhotos.userId, userId));
    return row !== undefined;
  }
}
