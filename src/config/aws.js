import { S3Client } from '@aws-sdk/client-s3';

// validate env (important)
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.warn('⚠️ AWS credentials missing. S3 uploads may fail.');
}

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined, // fallback to IAM role (best for production)
});

const bucketName =
  process.env.AWS_BUCKET_NAME || 'safe-delivery-photos';

export { s3Client, bucketName };