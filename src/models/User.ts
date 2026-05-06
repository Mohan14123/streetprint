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
