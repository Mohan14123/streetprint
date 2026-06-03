/**
 * src/models/User.ts
 * User schema — authentication credentials and profile.
 * Rule 2.2: syncIndexes() called at startup; indexes declared here in schema.
 * Rule 9.2: Never log passwords or JWT tokens.
 */
import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  displayName: string;
  isEmailVerified: boolean;
  emailVerificationToken?: string;
  emailVerificationExpiry?: Date;
  passwordResetToken?: string;
  passwordResetExpiry?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // Never returned in queries by default
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
      select: false,
    },
    emailVerificationExpiry: {
      type: Date,
      select: false,
    },
    passwordResetToken: {
      type: String,
      select: false,
    },
    passwordResetExpiry: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Compound index for login lookup
UserSchema.index({ email: 1 }, { unique: true });

const User: Model<IUser> = mongoose.model<IUser>('User', UserSchema);

export default User;
